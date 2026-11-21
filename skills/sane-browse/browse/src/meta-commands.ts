/**
 * Meta commands — tabs, server control, visuals, chain, diff, snapshot,
 * frames, handoff, cookies, state, device emulation, downloads.
 */

import type { BrowserManager } from './browser-manager';
import { parseUntil } from './browser-manager';
import { handleSnapshot } from './snapshot';
import { getCleanText, handleReadCommand } from './read-commands';
import { handleWriteCommand } from './write-commands';
import { handleCookiesCommand } from './cookie-commands';
import { READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS } from './commands';
import { validateNavigationUrl } from './url-validation';
import { resolveOutputPath, resolveInputPath, defaultOutput, looksLikeOutputPath } from './paths';
import { currentRequest } from './request-context';
import { BrowseError, usage } from './errors';
import { describeLaunch, type BrowseConfig } from './config';
import * as Diff from 'diff';
import * as fs from 'fs';
import * as path from 'path';

function outPath(config: BrowseConfig, p: string | undefined, fallbackName: string): string {
  return p ? resolveOutputPath(p, config, currentRequest().cwd) : defaultOutput(config, fallbackName);
}

/** Pull `--out <path>` (or `-o <path>`) out of args. */
function takeOut(args: string[]): string | undefined {
  for (const flag of ['--out', '-o']) {
    const i = args.indexOf(flag);
    if (i !== -1) {
      const v = args[i + 1];
      if (!v) throw usage(`${flag} needs a path`);
      args.splice(i, 2);
      return v;
    }
  }
  return undefined;
}

export async function runOne(name: string, args: string[], bm: BrowserManager, config: BrowseConfig, shutdown: () => void): Promise<string> {
  if (READ_COMMANDS.has(name)) return handleReadCommand(name, args, bm, config);
  if (WRITE_COMMANDS.has(name)) return handleWriteCommand(name, args, bm, config);
  if (META_COMMANDS.has(name)) return handleMetaCommand(name, args, bm, config, shutdown);
  throw usage(`Unknown command: ${name}`, "Run 'browse help' for the command list.");
}

export async function handleMetaCommand(
  command: string,
  argsIn: string[],
  bm: BrowserManager,
  config: BrowseConfig,
  shutdown: () => void,
): Promise<string> {
  const args = [...argsIn];
  switch (command) {
    // ─── Tabs ──────────────────────────────────────────
    case 'tabs': {
      const tabs = await bm.getTabListWithTitles();
      return tabs.map(t =>
        `${t.active ? '→ ' : '  '}[${t.id}] ${t.title || '(untitled)'} — ${t.url}${t.owners.length ? `  (${t.owners.join(', ')})` : ''}`
      ).join('\n');
    }

    case 'tab': {
      const id = parseInt(args[0], 10);
      if (isNaN(id)) throw usage('Usage: tab <id>');
      bm.switchTab(id);
      return `Switched to tab ${id}`;
    }

    case 'newtab': {
      const id = await bm.newTab(args[0]);
      return `Opened tab ${id}${args[0] ? ` → ${args[0]}` : ''}`;
    }

    case 'closetab': {
      const id = args[0] ? parseInt(args[0], 10) : undefined;
      if (args[0] && isNaN(id!)) throw usage('Usage: closetab [id]');
      await bm.closeTab(id);
      return `Closed tab${id ? ` ${id}` : ''}`;
    }

    // ─── Server control ────────────────────────────────
    case 'status': {
      const lines = [
        'Status: healthy',
        `Mode: ${bm.getMode()}${bm.isHandoffActive() ? ' (handoff in progress)' : ''}`,
        `Launch: ${describeLaunch(bm.cfg)}`,
        `URL: ${bm.getCurrentUrl()}`,
        `Tabs: ${bm.getTabCount()}`,
      ];
      const frame = bm.getTarget();
      if (frame !== bm.getPage().mainFrame()) lines.push(`Frame: ${frame.name() || frame.url()}`);
      if (bm.getDevice()) lines.push(`Device: ${bm.getDevice()}`);
      if (currentRequest().session) lines.push(`Session: ${currentRequest().session}`);
      lines.push(`PID: ${process.pid}`, `State: ${config.stateDir}`);
      return lines.join('\n');
    }

    case 'url':
      return bm.getCurrentUrl();

    case 'stop':
    case 'restart':
      // Reply first, then shut down: the CLI must not mistake this for a crash.
      setTimeout(shutdown, 50);
      return command === 'stop' ? 'Server stopped' : 'Restarting: the next command starts a fresh browser on the same profile';

    // ─── Visual ────────────────────────────────────────
    case 'screenshot': {
      const page = bm.getPage();
      let out = takeOut(args);
      let clip: { x: number; y: number; width: number; height: number } | undefined;
      let selector: string | undefined;
      let viewportOnly = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--viewport') viewportOnly = true;
        else if (a === '--clip') {
          const parts = (args[++i] || '').split(',').map(Number);
          if (parts.length !== 4 || parts.some(isNaN)) throw usage('Usage: screenshot --clip x,y,width,height');
          clip = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
        } else if (a === '--selector') {
          selector = args[++i];
          if (!selector) throw usage('--selector needs a value');
        } else if (a.startsWith('--')) throw usage(`Unknown screenshot flag: ${a}`);
        else if (/^@[ec]\d+$/.test(a)) selector = a;
        else if (looksLikeOutputPath(a)) out = a;
        else if (!selector) selector = a;
        else throw usage(`Unexpected argument '${a}'`, 'Paths need an image extension (.png/.jpg/.webp) or --out.');
      }
      if (clip && selector) throw usage('Use --clip or a selector, not both');
      if (viewportOnly && clip) throw usage('Use --viewport or --clip, not both');
      const file = outPath(config, out, 'screenshot.png');
      if (selector) {
        const loc = await bm.locator(selector);
        await loc.screenshot({ path: file, timeout: 5000 });
        return `Screenshot saved (element): ${file}`;
      }
      if (clip) {
        await page.screenshot({ path: file, clip });
        return `Screenshot saved (clip ${clip.x},${clip.y},${clip.width},${clip.height}): ${file}`;
      }
      await page.screenshot({ path: file, fullPage: !viewportOnly });
      return `Screenshot saved${viewportOnly ? ' (viewport)' : ''}: ${file}`;
    }

    case 'pdf': {
      const file = outPath(config, takeOut(args) ?? args[0], 'page.pdf');
      if (bm.getMode() === 'headed') throw usage('PDF export only works headless.', "Run 'resume' or restart without --headed.");
      await bm.getPage().pdf({ path: file, format: 'A4' });
      return `PDF saved: ${file}`;
    }

    case 'responsive': {
      const page = bm.getPage();
      const prefix = args[0] ? resolveOutputPath(args[0], config, currentRequest().cwd) : defaultOutput(config, 'responsive');
      const viewports = [
        { name: 'mobile', width: 375, height: 812 },
        { name: 'tablet', width: 768, height: 1024 },
        { name: 'desktop', width: 1280, height: 720 },
      ];
      const original = page.viewportSize();
      const results: string[] = [];
      try {
        for (const vp of viewports) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          const file = `${prefix}-${vp.name}.png`;
          await page.screenshot({ path: file, fullPage: true });
          results.push(`${vp.name} (${vp.width}x${vp.height}): ${file}`);
        }
      } finally {
        if (original) await page.setViewportSize(original);
      }
      return results.join('\n');
    }

    // ─── Chain ─────────────────────────────────────────
    case 'chain': {
      const jsonStr = args[0];
      if (!jsonStr) throw usage('Usage: echo \'[["goto","url"],["text"]]\' | browse chain');
      let commands: unknown;
      try { commands = JSON.parse(jsonStr); } catch { throw usage('Invalid JSON. Expected: [["command", "arg1"], ...]'); }
      if (!Array.isArray(commands) || !commands.every(c => Array.isArray(c) && c.length > 0 && c.every(x => typeof x === 'string'))) {
        throw usage('Expected a JSON array of string arrays: [["command", "arg1"], ...]');
      }
      const results: string[] = [];
      for (const [i, [name, ...cmdArgs]] of (commands as string[][]).entries()) {
        if (name === 'chain' || name === 'stop' || name === 'restart') throw usage(`'${name}' cannot run inside chain`);
        try {
          results.push(`[${name}] ${await runOne(name, cmdArgs, bm, config, shutdown)}`);
        } catch (err: any) {
          const e = err instanceof BrowseError ? err : new BrowseError(String(err?.message || err).split('\n')[0]);
          results.push(`[${name}] ERROR: ${e.message}`);
          throw new BrowseError(
            `${results.join('\n\n')}\n\nchain stopped at step ${i + 1} of ${(commands as string[][]).length}`,
            e.code, e.hint,
          );
        }
      }
      return results.join('\n\n');
    }

    // ─── Diff ──────────────────────────────────────────
    case 'diff': {
      const [url1, url2] = args;
      if (!url1 || !url2) throw usage('Usage: diff <url1> <url2>');
      const page = bm.getPage();
      await validateNavigationUrl(url1);
      await page.goto(url1, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const text1 = await getCleanText(page);
      await validateNavigationUrl(url2);
      await page.goto(url2, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const text2 = await getCleanText(page);
      const output: string[] = [`--- ${url1}`, `+++ ${url2}`, ''];
      for (const part of Diff.diffLines(text1, text2)) {
        const prefix = part.added ? '+' : part.removed ? '-' : ' ';
        for (const line of part.value.split('\n').filter(l => l.length > 0)) output.push(`${prefix} ${line}`);
      }
      return output.join('\n');
    }

    // ─── Snapshot / frames ─────────────────────────────
    case 'snapshot':
      return handleSnapshot(args, bm, config);

    case 'frame': {
      const page = bm.getPage();
      const how = args[0];
      if (!how) throw usage('Usage: frame <sel|@ref|--name n|--url pattern|main>');
      if (how === 'main' || how === 'top') {
        bm.setFrame(null);
        return 'Switched to the main page (refs cleared)';
      }
      let frame = null;
      if (how === '--name') {
        if (!args[1]) throw usage('frame --name needs a value');
        frame = page.frame({ name: args[1] });
      } else if (how === '--url') {
        if (!args[1]) throw usage('frame --url needs a pattern');
        frame = page.frames().find(f => f !== page.mainFrame() && f.url().includes(args[1])) ?? null;
      } else {
        const loc = await bm.locator(how);
        const handle = await loc.elementHandle({ timeout: 5000 }).catch(() => null);
        frame = handle ? await handle.contentFrame() : null;
        if (handle && !frame) throw usage(`'${how}' is not an iframe`);
      }
      if (!frame) {
        const list = page.frames().filter(f => f !== page.mainFrame()).map(f => `${f.name() || '(unnamed)'} ${f.url()}`);
        throw new BrowseError(`No matching frame for ${args.join(' ')}`, 'failed', list.length ? `Frames: ${list.join('; ')}` : 'This page has no iframes.');
      }
      bm.setFrame(frame);
      return `Switched to frame ${frame.name() || frame.url()} (refs cleared; run 'snapshot -i')`;
    }

    // ─── Handoff ───────────────────────────────────────
    case 'handoff': {
      let untilSpec: string | undefined;
      const ui = args.indexOf('--until');
      if (ui !== -1) {
        untilSpec = args[ui + 1];
        if (!untilSpec) throw usage('--until needs a condition');
        args.splice(ui, 2);
      }
      const stayHeaded = args.includes('--stay-headed');
      const message = args.filter(a => a !== '--stay-headed').join(' ') || 'User takeover requested';
      const until = untilSpec ? parseUntil(untilSpec) : undefined;
      const lines = await bm.handoff(message);
      if (!until) {
        lines.push("STATUS: Waiting for the user. Run 'resume' when they are done (or use handoff --until to block).");
        return lines.join('\n');
      }
      const timeoutMs = currentRequest().timeoutMs ?? 600_000;
      lines.push(`STATUS: Waiting up to ${Math.round(timeoutMs / 1000)}s for ${until.raw}...`);
      const met = await bm.waitForUser(until, timeoutMs);
      lines.push(`DONE: ${met}`);
      lines.push(await bm.resume(stayHeaded));
      lines.push('', await handleSnapshot(['-i'], bm, config));
      return lines.join('\n');
    }

    case 'resume': {
      const msg = await bm.resume(args.includes('--stay-headed'));
      return `RESUMED: ${msg}\n${await handleSnapshot(['-i'], bm, config)}`;
    }

    // ─── Cookies and state ─────────────────────────────
    case 'cookies':
      return handleCookiesCommand(args, bm);

    case 'cookie-import-browser': {
      if (args.includes('--domain')) return handleCookiesCommand(['import', ...args], bm);
      return handleCookiesCommand(['picker', ...args.filter(a => a.startsWith('--unsafe'))], bm);
    }

    case 'state': {
      const sub = args[0];
      const name = args[1];
      const fileFor = (n: string) => {
        if (n.includes('/') || n.endsWith('.json')) return n;
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(n)) throw usage(`Invalid state name '${n}'`);
        return path.join(config.statesDir, `${n}.json`);
      };
      if (sub === 'list') {
        const files = fs.existsSync(config.statesDir) ? fs.readdirSync(config.statesDir).filter(f => f.endsWith('.json')) : [];
        return files.length ? files.map(f => f.replace(/\.json$/, '')).join('\n') : '(no saved states)';
      }
      if (!name || !['save', 'load', 'rm'].includes(sub)) throw usage('Usage: state save|load <name|file.json> | list | rm <name>');
      const cwd = currentRequest().cwd;
      if (sub === 'save') {
        const file = resolveOutputPath(fileFor(name), config, cwd);
        const state = await bm.getContext().storageState();
        fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
        fs.chmodSync(file, 0o600);
        return `Saved ${state.cookies.length} cookies and storage for ${state.origins.length} origin(s) to ${file}`;
      }
      if (sub === 'rm') {
        const file = resolveInputPath(fileFor(name), config, cwd);
        fs.unlinkSync(file);
        return `Removed ${file}`;
      }
      const file = resolveInputPath(fileFor(name), config, cwd);
      let state: { cookies?: any[]; origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> };
      try { state = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { throw usage(`Invalid state file ${file}`); }
      const ctx = bm.getContext();
      if (state.cookies?.length) await ctx.addCookies(state.cookies);
      let origins = 0;
      for (const o of state.origins || []) {
        if (!o.localStorage?.length) continue;
        const temp = await ctx.newPage();
        try {
          await temp.goto(o.origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await temp.evaluate((items: Array<{ name: string; value: string }>) => {
            for (const { name, value } of items) localStorage.setItem(name, value);
          }, o.localStorage);
          origins++;
        } catch {} finally {
          await temp.close().catch(() => {});
        }
      }
      return `Loaded ${state.cookies?.length ?? 0} cookies and localStorage for ${origins} origin(s) from ${file}`;
    }

    // ─── Device emulation ──────────────────────────────
    case 'device': {
      if (args[0] === '--list') {
        const { devices } = await import('playwright');
        return Object.keys(devices).filter(k => !k.endsWith(' landscape')).join('\n');
      }
      if (!args[0]) return bm.getDevice() ? `Emulating ${bm.getDevice()}` : 'No device emulation';
      if (args[0] === 'off') return bm.setDevice(null, false);
      const landscape = args.includes('--landscape');
      return bm.setDevice(args.filter(a => a !== '--landscape').join(' '), landscape);
    }

    // ─── Download ──────────────────────────────────────
    case 'download': {
      const out = takeOut(args);
      const what = args[0];
      if (!what) throw usage('Usage: download <url|sel|@ref> [--out <path>]');
      if (/^https?:\/\//.test(what)) {
        await validateNavigationUrl(what);
        const resp = await bm.getContext().request.get(what, { timeout: currentRequest().timeoutMs ?? 60_000 });
        if (!resp.ok()) throw new BrowseError(`Download failed: HTTP ${resp.status()} for ${what}`);
        const body = await resp.body();
        const name = path.basename(new URL(what).pathname) || 'download.bin';
        const file = outPath(config, out, name);
        fs.writeFileSync(file, body);
        return `Downloaded ${body.length}B (${resp.headers()['content-type'] ?? 'unknown type'}) to ${file}`;
      }
      const page = bm.getPage();
      const loc = await bm.locator(what);
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: currentRequest().timeoutMs ?? 30_000 }),
        loc.click({ timeout: 5000 }),
      ]);
      const file = outPath(config, out, dl.suggestedFilename() || 'download.bin');
      await dl.saveAs(file);
      return `Downloaded ${dl.suggestedFilename()} (${fs.statSync(file).size}B) to ${file}`;
    }

    default:
      throw new Error(`Unknown meta command: ${command}`);
  }
}
