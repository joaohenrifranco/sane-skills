/**
 * Browser lifecycle manager.
 *
 * Contexts:
 *   persistent (default) → chromium.launchPersistentContext(profileDir): cookies,
 *                          localStorage and IndexedDB survive restarts.
 *   ephemeral            → chromium.launch() + newContext(): nothing on disk.
 * Headless and headed runs use the same profile, user agent and stealth
 * settings, so a session or CAPTCHA clearance earned in one mode is valid in
 * the other.
 *
 * Handoff (headless → headed → headless):
 *   save tab URLs + sessionStorage (+ storageState when ephemeral) → close the
 *   headless context (releases the profile lock) → open a headed context on
 *   the same profile → restore tabs. If the headed launch fails, headless is
 *   reopened and restored. Back/forward history and in-page JS state do not
 *   survive the relaunch; tabs reached through a form POST reload as GET.
 *
 * Tabs carry their own refs, snapshot baseline and selected iframe. Sessions
 * (named via --session) map to their own tab, so parallel agents do not move
 * each other's active tab. Sessions share cookies and storage.
 *
 * Crash handling: if Chromium dies outside an intentional close, the server
 * exits and the CLI restarts it on the next command. The exception is a user
 * closing the window during handoff: that resumes headless on the profile.
 */

import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type Frame, type Locator, type CDPSession } from 'playwright';
import * as fs from 'fs';
import { addConsoleEntry, addNetworkEntry, addDialogEntry, networkBuffer, type DialogEntry } from './buffers';
import { validateNavigationUrl } from './url-validation';
import type { LaunchConfig } from './config';
import { BrowseError, usage, needsUser } from './errors';
import { currentRequest } from './request-context';
import {
  STEALTH_ARGS, STEALTH_IGNORE_DEFAULT_ARGS, STEALTH_INIT_SCRIPT, stealthEnabled, chromeUserAgent,
  proxyOption, sandboxArgs, clearStaleProfileLock, ensureDisplay, isVirtualDisplay,
} from './launch';

export interface RefEntry {
  locator: Locator;
  role: string;
  name: string;
}

interface TabState {
  page: Page;
  refs: Map<string, RefEntry>;
  lastSnapshot: string | null;
  frame: Frame | null;
  lastUrl: string;
  lastNavMethod: string;
  device: string | null;
  cdp: CDPSession | null;
}

interface SavedTab {
  id: number;
  url: string;
  active: boolean;
  origin: string | null;
  sessionStorage: Record<string, string> | null;
  wasPost: boolean;
}

interface SavedState {
  tabs: SavedTab[];
  storage?: BrowserContextOptions['storageState'];
  sessions: Array<[string, number]>;
}

interface HandoffState {
  active: boolean;
  fromHeadless: boolean;
  closedByUser: boolean;
  urls: Map<number, string>;
  lastStorage?: BrowserContextOptions['storageState'];
  storageTimer?: ReturnType<typeof setInterval>;
  closedWaiters: Array<() => void>;
  recovering?: Promise<void>;
}

export type Until =
  | { kind: 'url'; raw: string; test: (url: string) => boolean }
  | { kind: 'selector'; raw: string; selector: string }
  | { kind: 'closed'; raw: string };

export function parseUntil(spec: string): Until {
  if (spec === 'closed') return { kind: 'closed', raw: spec };
  const m = spec.match(/^(url|selector):(.+)$/);
  if (!m) throw usage(`Invalid --until '${spec}'`, "Use url:<substring>, url:/<regex>/, selector:<css>, or closed");
  if (m[1] === 'selector') return { kind: 'selector', raw: spec, selector: m[2] };
  const pat = m[2];
  if (pat.length > 2 && pat.startsWith('/') && pat.endsWith('/')) {
    let re: RegExp;
    try { re = new RegExp(pat.slice(1, -1)); } catch { throw usage(`Invalid regex in --until: ${pat}`); }
    return { kind: 'url', raw: spec, test: u => re.test(u) };
  }
  return { kind: 'url', raw: spec, test: u => u.includes(pat) };
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private tabs = new Map<number, TabState>();
  private activeTabId = 0;
  private nextTabId = 1;
  private sessions = new Map<string, number>();
  private extraHeaders: Record<string, string> = {};
  private customUserAgent: string | null = null;
  private viewport = { ...DEFAULT_VIEWPORT };
  private intentionalClose = false;
  private mode: 'headless' | 'headed' = 'headless';
  private handoffState: HandoffState = this.freshHandoff();

  public serverPort = 0;
  /** Where copied-cookie keys are tracked so a crash cannot leave them behind. */
  public importManifest: string | null = null;
  private imported = new Map<string, { name: string; domain: string; path: string }>();

  private dialogAutoAccept = true;
  private dialogPromptText: string | null = null;
  private consecutiveFailures = 0;

  constructor(public readonly cfg: LaunchConfig) {}

  private freshHandoff(): HandoffState {
    return { active: false, fromHeadless: false, closedByUser: false, urls: new Map(), closedWaiters: [] };
  }

  // ─── Launch / close ───────────────────────────────────────

  async launch(): Promise<void> {
    await this.openContext(this.cfg.headed ? 'headed' : 'headless');
    await this.restoreSessionCookies();
    await this.removeLeftoverImports();
    await this.restoreState({ tabs: [], sessions: [] });
  }

  // ─── Copied (imported) cookies: temporary by default ─────

  async trackImported(cookies: Array<{ name: string; domain: string; path: string }>): Promise<void> {
    for (const c of cookies) this.imported.set(`${c.name}|${c.domain}|${c.path}`, { name: c.name, domain: c.domain, path: c.path });
    this.writeImportManifest();
  }

  private writeImportManifest(): void {
    if (!this.importManifest) return;
    try {
      if (this.imported.size === 0) { fs.rmSync(this.importManifest, { force: true }); return; }
      fs.writeFileSync(this.importManifest, JSON.stringify([...this.imported.values()]), { mode: 0o600 });
      fs.chmodSync(this.importManifest, 0o600);
    } catch {}
  }

  /** Remove every tracked copied cookie from the browser. Returns how many were tracked. */
  async forgetImported(): Promise<number> {
    const n = this.imported.size;
    if (this.context) {
      for (const c of this.imported.values()) {
        await this.context.clearCookies({ name: c.name, domain: c.domain, path: c.path }).catch(() => {});
      }
    }
    this.imported.clear();
    this.writeImportManifest();
    return n;
  }

  /** After a crash the manifest survives; remove what it lists before anything else runs. */
  private async removeLeftoverImports(): Promise<void> {
    if (!this.importManifest || !fs.existsSync(this.importManifest)) return;
    try {
      const keys = JSON.parse(fs.readFileSync(this.importManifest, 'utf-8'));
      if (Array.isArray(keys)) for (const k of keys) this.imported.set(`${k.name}|${k.domain}|${k.path}`, k);
    } catch {}
    const n = await this.forgetImported();
    if (n) console.log(`[browse] Removed ${n} copied cookie(s) left over from an earlier run.`);
  }

  // Chromium drops cookies without an expiry when the browser exits, even
  // with a persistent profile. Many sites keep sign-in in such cookies, so
  // they are carried across restarts in a 0600 file inside the profile.
  private sessionCookieFile(): string | null {
    return this.cfg.profileDir ? `${this.cfg.profileDir}/sane-browse-session-cookies.json` : null;
  }

  private async saveSessionCookies(): Promise<void> {
    const file = this.sessionCookieFile();
    if (!file || !this.context) return;
    try {
      const session = (await this.context.cookies()).filter(c => c.expires === -1);
      fs.writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
      fs.chmodSync(file, 0o600);
    } catch {}
  }

  private async restoreSessionCookies(): Promise<void> {
    const file = this.sessionCookieFile();
    if (!file || !this.context || !fs.existsSync(file)) return;
    try {
      const cookies = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(cookies) && cookies.length) await this.context.addCookies(cookies);
    } catch {
      try { fs.renameSync(file, `${file}.corrupt`); } catch {}
    }
  }

  private async openContext(mode: 'headless' | 'headed', storageState?: BrowserContextOptions['storageState']): Promise<void> {
    const headed = mode === 'headed';
    const stealth = stealthEnabled();
    const displayEnv = headed ? await ensureDisplay() : undefined;
    const ua = this.customUserAgent ?? (stealth ? chromeUserAgent() : null);

    const launchOpts = {
      headless: !headed,
      channel: 'chromium',
      args: [...(stealth ? STEALTH_ARGS : []), ...sandboxArgs()],
      ignoreDefaultArgs: stealth ? STEALTH_IGNORE_DEFAULT_ARGS : undefined,
      proxy: proxyOption(this.cfg),
      env: displayEnv ? { ...process.env, ...displayEnv } as Record<string, string> : undefined,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    };
    const contextOpts: BrowserContextOptions = {
      viewport: this.viewport,
      ...(ua ? { userAgent: ua } : {}),
    };

    try {
      if (this.cfg.profileDir) {
        fs.mkdirSync(this.cfg.profileDir, { recursive: true, mode: 0o700 });
        clearStaleProfileLock(this.cfg.profileDir);
        this.context = await chromium.launchPersistentContext(this.cfg.profileDir, { ...launchOpts, ...contextOpts });
        this.browser = null;
      } else {
        this.browser = await chromium.launch(launchOpts);
        this.context = await this.browser.newContext({ ...contextOpts, ...(storageState ? { storageState } : {}) });
      }
    } catch (err: any) {
      if (err instanceof BrowseError) throw err;
      const msg = String(err?.message || err).split('\n')[0];
      if (/Executable doesn't exist|install/i.test(msg)) {
        throw new BrowseError(`Chromium is not installed: ${msg}`, 'failed', 'Run: browse doctor --fix  (or: bunx playwright install chromium)');
      }
      if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(msg)) {
        throw usage(`Profile ${this.cfg.profileDir} is locked by another browser.`, 'Close it, or use --profile <other> / --ephemeral.');
      }
      throw new BrowseError(`Chromium failed to launch (${mode}): ${msg}`);
    }

    if (stealth) await this.context.addInitScript(STEALTH_INIT_SCRIPT);
    if (Object.keys(this.extraHeaders).length > 0) await this.context.setExtraHTTPHeaders(this.extraHeaders);
    const ctx = this.context;
    ctx.on('close', () => this.onContextClosed(ctx));
    this.mode = mode;
  }

  private async closeContext(): Promise<void> {
    await this.saveSessionCookies();
    this.intentionalClose = true;
    try {
      const ctx = this.context;
      const br = this.browser;
      this.context = null;
      this.browser = null;
      if (ctx) await Promise.race([ctx.close().catch(() => {}), Bun.sleep(5000)]);
      if (br) await Promise.race([br.close().catch(() => {}), Bun.sleep(5000)]);
    } finally {
      this.intentionalClose = false;
      for (const t of this.tabs.values()) { t.page = null as any; t.cdp = null; }
    }
  }

  async close(): Promise<void> {
    if (this.handoffState.storageTimer) clearInterval(this.handoffState.storageTimer);
    await this.forgetImported();
    await this.closeContext();
  }

  private onContextClosed(ctx: BrowserContext): void {
    if (this.intentionalClose || ctx !== this.context) return;
    if (this.handoffState.active && this.mode === 'headed') {
      this.onUserClosedWindow();
      return;
    }
    console.error('[browse] FATAL: Chromium closed or crashed. Server exiting; the next command restarts it.');
    process.exit(1);
  }

  /** The user closed the handoff window: resume headless on the same profile. */
  private onUserClosedWindow(): void {
    const h = this.handoffState;
    if (h.closedByUser) return;
    h.closedByUser = true;
    h.recovering = (async () => {
      const tabs: SavedTab[] = [...h.urls.entries()].map(([id, url], i) => ({
        id, url, active: i === 0, origin: null, sessionStorage: null, wasPost: false,
      }));
      await this.closeContext();
      this.tabs.clear();
      if (h.storageTimer) clearInterval(h.storageTimer);
      await this.openContext('headless', h.lastStorage);
      await this.restoreSessionCookies();
      await this.restoreState({ tabs, sessions: [...this.sessions.entries()] });
      console.log('[browse] Handoff window closed by user; resumed headless.');
    })().catch(err => {
      console.error(`[browse] FATAL: could not resume after the window closed: ${err?.message}`);
      process.exit(1);
    });
    for (const w of h.closedWaiters.splice(0)) w();
  }

  async isHealthy(): Promise<boolean> {
    if (this.relaunching) return true;
    if (!this.context) return this.handoffState.recovering !== undefined;
    try {
      const page = this.tabs.get(this.activeTabId)?.page;
      if (!page) return true;
      await Promise.race([
        page.evaluate('1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  getMode(): 'headless' | 'headed' { return this.mode; }
  isHandoffActive(): boolean { return this.handoffState.active; }

  // ─── State save / restore ─────────────────────────────────

  async saveState(): Promise<SavedState> {
    if (!this.context) throw new BrowseError('Browser not running');
    const tabs: SavedTab[] = [];
    for (const [id, t] of this.tabs) {
      let url = t.page?.url() || t.lastUrl;
      if (url === 'about:blank') url = '';
      let origin: string | null = null;
      let sessionStorage: Record<string, string> | null = null;
      try {
        const s = await t.page.evaluate(() => ({ origin: location.origin, data: { ...sessionStorage } }));
        origin = s.origin;
        sessionStorage = s.data;
      } catch {}
      tabs.push({ id, url, active: id === this.activeTabId, origin, sessionStorage, wasPost: t.lastNavMethod === 'POST' });
    }
    const storage = this.cfg.profileDir ? undefined : await this.context.storageState();
    return { tabs, storage, sessions: [...this.sessions.entries()] };
  }

  private async restoreState(saved: SavedState): Promise<void> {
    if (!this.context) throw new BrowseError('Browser not running');
    this.tabs.clear();
    const spare = [...this.context.pages()];
    const wanted = saved.tabs.length > 0 ? saved.tabs : [{ id: this.nextTabId++, url: '', active: true, origin: null, sessionStorage: null, wasPost: false }];
    let activeId: number | null = null;

    for (const s of wanted) {
      const page = spare.shift() ?? await this.context.newPage();
      const t = this.registerPage(s.id, page);
      if (s.sessionStorage && s.origin && Object.keys(s.sessionStorage).length > 0) {
        await page.addInitScript(({ origin, data }: { origin: string; data: Record<string, string> }) => {
          try {
            if (location.origin === origin && sessionStorage.length === 0) {
              for (const [k, v] of Object.entries(data)) sessionStorage.setItem(k, v);
            }
          } catch {}
        }, { origin: s.origin, data: s.sessionStorage }).catch(() => {});
      }
      if (s.url) await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      t.lastUrl = s.url;
      if (s.active) activeId = s.id;
      this.nextTabId = Math.max(this.nextTabId, s.id + 1);
    }
    for (const extra of spare) await extra.close().catch(() => {});

    this.activeTabId = activeId ?? wanted[0].id;
    this.sessions = new Map(saved.sessions.filter(([, id]) => this.tabs.has(id)));
  }

  private relaunching = false;

  private async relaunch(mode: 'headless' | 'headed'): Promise<SavedState> {
    this.relaunching = true;
    try {
      return await this.relaunchInner(mode);
    } finally {
      this.relaunching = false;
    }
  }

  private async relaunchInner(mode: 'headless' | 'headed'): Promise<SavedState> {
    const saved = await this.saveState();
    await this.closeContext();
    try {
      await this.openContext(mode, saved.storage);
      await this.restoreSessionCookies();
      await this.restoreState(saved);
    } catch (err: any) {
      const fallback = mode === 'headed' ? 'headless' : 'headed';
      await this.closeContext();
      await this.openContext(fallback, saved.storage);
      await this.restoreSessionCookies();
      await this.restoreState(saved);
      const msg = err instanceof BrowseError ? err.message : String(err?.message || err).split('\n')[0];
      throw new BrowseError(`Could not open a ${mode} browser: ${msg}. Still ${fallback}.`, err instanceof BrowseError ? err.code : 'failed', err?.hint);
    }
    return saved;
  }

  /** Recreate the context to apply a user-agent change. */
  async recreateContext(): Promise<void> {
    await this.relaunch(this.mode);
  }

  // ─── Handoff ──────────────────────────────────────────────

  async handoff(message: string): Promise<string[]> {
    const lines: string[] = [];
    if (this.mode === 'headed') {
      this.handoffState = { ...this.freshHandoff(), active: true, fromHeadless: false };
      await this.getPage().bringToFront().catch(() => {});
      lines.push(`HANDOFF: Browser window is at ${this.getCurrentUrl()}`);
    } else {
      const saved = await this.relaunch('headed');
      this.handoffState = { ...this.freshHandoff(), active: true, fromHeadless: true };
      await this.getPage().bringToFront().catch(() => {});
      lines.push(`HANDOFF: Visible browser opened at ${this.getCurrentUrl()}`);
      for (const t of saved.tabs.filter(t => t.wasPost)) {
        lines.push(`WARNING: tab ${t.id} came from a form submission and was reloaded with GET; resubmit it if needed.`);
      }
      if (saved.tabs.length > 0) lines.push('NOTE: back/forward history and unsaved in-page state were not carried over.');
    }
    if (isVirtualDisplay()) lines.push('WARNING: no physical display; the window runs under Xvfb and nobody can see it.');
    for (const [id, t] of this.tabs) this.handoffState.urls.set(id, t.page.url());
    if (!this.cfg.profileDir) {
      this.handoffState.storageTimer = setInterval(async () => {
        try { if (this.context) this.handoffState.lastStorage = await this.context.storageState(); } catch {}
      }, 2000);
    }
    lines.push(`MESSAGE: ${message}`);
    return lines;
  }

  /** Block until the handoff condition holds. Returns a description of what happened. */
  async waitForUser(until: Until, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    const h = this.handoffState;
    const closed = new Promise<void>(resolve => {
      if (h.closedByUser) resolve(); else h.closedWaiters.push(resolve);
    });
    let closedFlag = false;
    closed.then(() => { closedFlag = true; });

    while (Date.now() < deadline) {
      if (closedFlag) {
        await h.recovering;
        return until.kind === 'closed' ? 'window closed' : 'window closed before the condition was met';
      }
      if (until.kind === 'url') {
        for (const t of this.tabs.values()) {
          const u = t.page?.url();
          if (u && until.test(u)) {
            if (this.tabs.get(this.currentTabId()) !== t) this.focusTab(t);
            return `url matched (${u})`;
          }
        }
      } else if (until.kind === 'selector') {
        const visible = await this.getTarget().locator(until.selector).first().isVisible().catch(() => false);
        if (visible) return `selector visible (${until.selector})`;
      }
      await Promise.race([Bun.sleep(500), closed]);
    }
    throw needsUser(
      `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${until.raw}. The browser is still open for the user.`,
      "Ask the user to finish, then run 'resume' (or handoff --until again).",
    );
  }

  private focusTab(t: TabState): void {
    for (const [id, tab] of this.tabs) if (tab === t) this.switchTab(id);
  }

  /** End a handoff. Returns to headless unless the run started headed or stayHeaded is set. */
  async resume(stayHeaded: boolean): Promise<string> {
    const h = this.handoffState;
    this.clearRefs();
    this.resetFailures();
    if (!h.active) return 'Not in a handoff; refs cleared.';
    if (h.storageTimer) clearInterval(h.storageTimer);
    this.handoffState = this.freshHandoff();
    if (h.closedByUser) {
      await h.recovering;
      return 'Window was closed by the user; resumed headless.';
    }
    if (h.fromHeadless && !stayHeaded) {
      const saved = await this.relaunch('headless');
      const post = saved.tabs.filter(t => t.wasPost).map(t => t.id);
      return `Back to headless.${post.length ? ` WARNING: tab(s) ${post.join(', ')} came from a form submission and were reloaded with GET.` : ''}`;
    }
    return 'Resumed; browser stays visible.';
  }

  // ─── Tabs and sessions ────────────────────────────────────

  private registerPage(id: number, page: Page): TabState {
    const t: TabState = { page, refs: new Map(), lastSnapshot: null, frame: null, lastUrl: '', lastNavMethod: 'GET', device: null, cdp: null };
    this.tabs.set(id, t);
    this.wirePageEvents(id, t);
    return t;
  }

  private async createTab(): Promise<number> {
    if (!this.context) throw new BrowseError('Browser not running');
    const page = await this.context.newPage();
    const id = this.nextTabId++;
    this.registerPage(id, page);
    return id;
  }

  async ensureSessionTab(session: string): Promise<void> {
    if (this.handoffState.recovering) await this.handoffState.recovering;
    const id = this.sessions.get(session);
    if (id !== undefined && this.tabs.has(id)) return;
    const newId = await this.createTab();
    this.sessions.set(session, newId);
  }

  private currentTabId(): number {
    const s = currentRequest().session;
    if (s) {
      const id = this.sessions.get(s);
      if (id !== undefined && this.tabs.has(id)) return id;
    }
    return this.activeTabId;
  }

  private tab(): TabState {
    const t = this.tabs.get(this.currentTabId());
    if (!t || !t.page) throw new BrowseError('No active tab. Use "newtab" or "tab <id>".');
    return t;
  }

  async newTab(url?: string): Promise<number> {
    if (url) await validateNavigationUrl(url);
    const id = await this.createTab();
    this.switchTab(id);
    if (url) await this.tabs.get(id)!.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return id;
  }

  async closeTab(id?: number): Promise<void> {
    const tabId = id ?? this.currentTabId();
    const t = this.tabs.get(tabId);
    if (!t) throw usage(`Tab ${tabId} not found`, "Run 'tabs' to list open tabs.");
    this.intentionalClose = true;
    try { await t.page.close(); } finally { this.intentionalClose = false; }
    this.tabs.delete(tabId);
    for (const [s, sid] of this.sessions) if (sid === tabId) this.sessions.delete(s);
    if (tabId === this.activeTabId) {
      const remaining = [...this.tabs.keys()];
      this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : await this.createTab();
    }
  }

  switchTab(id: number): void {
    if (!this.tabs.has(id)) throw usage(`Tab ${id} not found`, "Run 'tabs' to list open tabs.");
    const s = currentRequest().session;
    if (s) this.sessions.set(s, id); else this.activeTabId = id;
  }

  getTabCount(): number { return this.tabs.size; }

  async getTabListWithTitles(): Promise<Array<{ id: number; url: string; title: string; active: boolean; owners: string[] }>> {
    const current = this.currentTabId();
    const out = [];
    for (const [id, t] of this.tabs) {
      const owners = [...this.sessions.entries()].filter(([, sid]) => sid === id).map(([s]) => `session:${s}`);
      out.push({ id, url: t.page.url(), title: await t.page.title().catch(() => ''), active: id === current, owners });
    }
    return out;
  }

  // ─── Page / frame access ──────────────────────────────────

  getPage(): Page { return this.tab().page; }

  /** The frame commands act on: the selected iframe, or the main frame. */
  getTarget(): Frame {
    const t = this.tab();
    if (t.frame && t.frame.isDetached()) t.frame = null;
    return t.frame ?? t.page.mainFrame();
  }

  setFrame(frame: Frame | null): void {
    const t = this.tab();
    t.frame = frame;
    t.refs.clear();
    t.lastSnapshot = null;
  }

  getCurrentUrl(): string {
    try { return this.getPage().url(); } catch { return 'about:blank'; }
  }

  getContext(): BrowserContext {
    if (!this.context) throw new BrowseError('Browser not running');
    return this.context;
  }

  // ─── Refs ─────────────────────────────────────────────────

  setRefMap(refs: Map<string, RefEntry>): void { this.tab().refs = refs; }
  clearRefs(): void { for (const t of this.tabs.values()) t.refs.clear(); }
  getRefCount(): number { return this.tab().refs.size; }

  async resolveRef(selector: string): Promise<{ locator: Locator } | { selector: string }> {
    if (/^@[ec]\d+$/.test(selector)) {
      const entry = this.tab().refs.get(selector.slice(1));
      if (!entry) throw usage(`Ref ${selector} not found.`, "Run 'snapshot -i' to get fresh refs.");
      if (await entry.locator.count() === 0) {
        throw new BrowseError(`Ref ${selector} (${entry.role} "${entry.name}") is stale: the element no longer exists.`, 'failed', "Run 'snapshot -i' for fresh refs.");
      }
      return { locator: entry.locator };
    }
    return { selector };
  }

  /** A Locator for a @ref or a selector, scoped to the selected frame. */
  async locator(selector: string): Promise<Locator> {
    const r = await this.resolveRef(selector);
    return 'locator' in r ? r.locator : this.getTarget().locator(r.selector);
  }

  getRefRole(selector: string): string | null {
    if (!/^@[ec]\d+$/.test(selector)) return null;
    return this.tab().refs.get(selector.slice(1))?.role ?? null;
  }

  setLastSnapshot(text: string | null): void { this.tab().lastSnapshot = text; }
  getLastSnapshot(): string | null { return this.tab().lastSnapshot; }

  // ─── Dialogs ──────────────────────────────────────────────

  setDialogAutoAccept(accept: boolean): void { this.dialogAutoAccept = accept; }
  getDialogAutoAccept(): boolean { return this.dialogAutoAccept; }
  setDialogPromptText(text: string | null): void { this.dialogPromptText = text; }
  getDialogPromptText(): string | null { return this.dialogPromptText; }

  // ─── Viewport / headers / UA ──────────────────────────────

  async setViewport(width: number, height: number): Promise<void> {
    if (this.tab().device) throw usage('A device is being emulated on this tab.', "Run 'device off' first.");
    this.viewport = { width, height };
    await this.getPage().setViewportSize({ width, height });
  }

  async setExtraHeader(name: string, value: string): Promise<void> {
    this.extraHeaders[name] = value;
    if (this.context) await this.context.setExtraHTTPHeaders(this.extraHeaders);
  }

  setUserAgent(ua: string): void { this.customUserAgent = ua; }
  getUserAgent(): string | null { return this.customUserAgent; }

  // ─── Device emulation (per tab, via CDP) ──────────────────

  getDevice(): string | null { return this.tab().device; }

  private async cdp(t: TabState): Promise<CDPSession> {
    if (!t.cdp) t.cdp = await this.getContext().newCDPSession(t.page);
    return t.cdp;
  }

  async setDevice(name: string | null, landscape: boolean): Promise<string> {
    const t = this.tab();
    const cdp = await this.cdp(t);
    if (name === null) {
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      const ua = this.customUserAgent ?? chromeUserAgent() ?? await t.page.evaluate(() => navigator.userAgent);
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua });
      t.device = null;
      return 'Device emulation off';
    }
    const { devices } = await import('playwright');
    const key = Object.keys(devices).find(k => k.toLowerCase() === name.toLowerCase());
    if (!key) {
      const sample = ['iPhone 15', 'iPhone 15 Pro Max', 'Pixel 7', 'iPad Pro 11', 'Galaxy S9+'].filter(k => k in devices);
      throw usage(`Unknown device '${name}'.`, `Examples: ${sample.join(', ')}. Run 'device --list' for all.`);
    }
    const d = devices[key];
    const w = landscape ? d.viewport.height : d.viewport.width;
    const h = landscape ? d.viewport.width : d.viewport.height;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: d.deviceScaleFactor, mobile: d.isMobile,
      screenOrientation: landscape ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: d.hasTouch, maxTouchPoints: d.hasTouch ? 5 : 0 });
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: d.userAgent });
    t.device = key;
    return `Emulating ${key}${landscape ? ' (landscape)' : ''}: ${w}x${h} @${d.deviceScaleFactor}x${d.hasTouch ? ', touch' : ''}. Reload to apply the user agent to the page.`;
  }

  async touch(type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ x: number; y: number }>): Promise<void> {
    const t = this.tab();
    if (!t.device) throw usage('Touch input needs device emulation.', "Run 'device <name>' first (e.g. device \"iPhone 15\").");
    const cdp = await this.cdp(t);
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
  }

  // ─── Failure hint ─────────────────────────────────────────

  incrementFailures(): void { this.consecutiveFailures++; }
  resetFailures(): void { this.consecutiveFailures = 0; }
  getFailureHint(): string | null {
    if (this.consecutiveFailures >= 3 && this.mode === 'headless') {
      return `HINT: ${this.consecutiveFailures} consecutive page failures. If a CAPTCHA, login or consent wall blocks progress, use 'handoff'.`;
    }
    return null;
  }

  // ─── Page events ──────────────────────────────────────────

  private wirePageEvents(id: number, t: TabState): void {
    const page = t.page;

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        t.refs.clear();
        t.frame = null;
        t.lastUrl = frame.url();
        if (this.handoffState.active) this.handoffState.urls.set(id, frame.url());
      }
    });

    page.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) t.lastNavMethod = req.method();
      addNetworkEntry({ timestamp: Date.now(), method: req.method(), url: req.url() });
    });

    page.on('close', () => {
      if (this.intentionalClose || t.page !== page) return;
      // The user closed a tab or the window (macOS keeps the app alive without windows).
      this.tabs.delete(id);
      if (this.handoffState.active && this.mode === 'headed' && this.tabs.size === 0) {
        this.onUserClosedWindow();
        return;
      }
      if (id === this.activeTabId && this.tabs.size > 0) this.activeTabId = [...this.tabs.keys()].pop()!;
    });

    page.on('dialog', async (dialog) => {
      const entry: DialogEntry = {
        timestamp: Date.now(),
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue() || undefined,
        action: this.dialogAutoAccept ? 'accepted' : 'dismissed',
        response: this.dialogAutoAccept ? (this.dialogPromptText ?? undefined) : undefined,
      };
      addDialogEntry(entry);
      try {
        if (this.dialogAutoAccept) await dialog.accept(this.dialogPromptText ?? undefined);
        else await dialog.dismiss();
      } catch {}
    });

    page.on('console', (msg) => {
      addConsoleEntry({ timestamp: Date.now(), level: msg.type(), text: msg.text() });
    });

    page.on('requestfinished', async (req) => {
      try {
        const res = await req.response();
        const sizes = await req.sizes();
        const url = req.url();
        for (let i = networkBuffer.length - 1; i >= 0; i--) {
          const e = networkBuffer.get(i);
          if (e && e.url === url && !e.status) {
            networkBuffer.set(i, { ...e, status: res?.status(), duration: Date.now() - e.timestamp, size: sizes.responseBodySize });
            break;
          }
        }
      } catch {}
    });

    page.on('requestfailed', (req) => {
      const url = req.url();
      for (let i = networkBuffer.length - 1; i >= 0; i--) {
        const e = networkBuffer.get(i);
        if (e && e.url === url && !e.status) {
          networkBuffer.set(i, { ...e, status: `failed: ${req.failure()?.errorText ?? 'unknown'}` as any, duration: Date.now() - e.timestamp });
          break;
        }
      }
    });
  }
}
