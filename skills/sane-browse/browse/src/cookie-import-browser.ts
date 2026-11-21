/**
 * Copy cookies from the user's installed browsers.
 *
 * Sources
 *   Chromium family (macOS): Chrome, Chromium, Brave, Edge, Arc, Comet.
 *     Cookies are AES-128-CBC "v10" values; the key comes from the macOS
 *     Keychain ("<Browser> Safe Storage") via PBKDF2(sha1, "saltysalt", 1003).
 *     DB schema version >= 24 prefixes each plaintext with SHA256(host_key),
 *     which is stripped. Other prefixes (v11 Linux, v20 Windows App-Bound) are
 *     reported as unsupported_encryption.
 *   Firefox (macOS, Linux, Windows): cookies.sqlite stores plain values.
 *     Only the default container is read (originAttributes = ''); container,
 *     private and partitioned cookies are skipped.
 *
 * Databases are always read from a private temp copy (plus -wal), so the
 * source browser can stay open and its DB is never written.
 *
 * Domain matching: "example.com" selects example.com, .example.com and every
 * subdomain. Values are never logged or returned to the CLI.
 */

import { Database } from 'bun:sqlite';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BrowseError, usage, needsUser } from './errors';

// ─── Types ──────────────────────────────────────────────────────

export type SourceKind = 'chromium' | 'firefox';

export interface CookieSource {
  browser: string;        // canonical id: chrome, brave, firefox, ...
  browserName: string;    // display: Chrome, Firefox
  kind: SourceKind;
  profile: string;        // profile directory name (pass to --profile)
  profileLabel: string;   // human name from Local State / profiles.ini
  dbPath: string;
  keychainService?: string;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface ImportResult {
  source: CookieSource;
  cookies: PlaywrightCookie[];
  failures: Record<string, number>;
  domainCounts: Record<string, number>;
}

interface ChromiumBrowser {
  id: string;
  name: string;
  dataDir: string;
  keychainService: string;
  aliases: string[];
}

// Hardcoded — never interpolate user input into shell commands.
const CHROMIUM_MAC: ChromiumBrowser[] = [
  { id: 'chrome',   name: 'Chrome',   dataDir: 'Google/Chrome',               keychainService: 'Chrome Safe Storage',         aliases: ['chrome', 'google-chrome'] },
  { id: 'chromium', name: 'Chromium', dataDir: 'Chromium',                    keychainService: 'Chromium Safe Storage',       aliases: ['chromium'] },
  { id: 'brave',    name: 'Brave',    dataDir: 'BraveSoftware/Brave-Browser', keychainService: 'Brave Safe Storage',          aliases: ['brave'] },
  { id: 'edge',     name: 'Edge',     dataDir: 'Microsoft Edge',              keychainService: 'Microsoft Edge Safe Storage', aliases: ['edge', 'msedge'] },
  { id: 'arc',      name: 'Arc',      dataDir: 'Arc/User Data',               keychainService: 'Arc Safe Storage',            aliases: ['arc'] },
  { id: 'comet',    name: 'Comet',    dataDir: 'Comet',                       keychainService: 'Comet Safe Storage',          aliases: ['comet', 'perplexity'] },
];
const FIREFOX_ALIASES = ['firefox', 'ff', 'mozilla'];

export const SUPPORTED_BROWSERS = [...CHROMIUM_MAC.map(b => b.id), 'firefox'];

// ─── Roots (overridable for tests) ─────────────────────────────

function chromiumRoot(b: ChromiumBrowser): string {
  const base = process.env.BROWSE_CHROMIUM_ROOT || path.join(os.homedir(), 'Library', 'Application Support');
  return path.join(base, b.dataDir);
}

export function firefoxRoots(): string[] {
  if (process.env.BROWSE_FIREFOX_ROOT) return [process.env.BROWSE_FIREFOX_ROOT];
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin': return [path.join(home, 'Library', 'Application Support', 'Firefox')];
    case 'win32':  return [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox')];
    default: return [
      path.join(home, '.mozilla', 'firefox'),
      path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
      path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
    ];
  }
}

// ─── Source discovery ──────────────────────────────────────────

export function resolveBrowserId(arg: string): string {
  const needle = arg.toLowerCase().trim();
  if (FIREFOX_ALIASES.includes(needle)) return 'firefox';
  const b = CHROMIUM_MAC.find(x => x.aliases.includes(needle) || x.id === needle);
  if (!b) throw usage(`Unknown browser '${arg}'.`, `Supported: ${SUPPORTED_BROWSERS.join(', ')}`);
  if (process.platform !== 'darwin' && !process.env.BROWSE_CHROMIUM_ROOT) {
    throw usage(`${b.name} cookie import is macOS-only in this version.`, "Use 'firefox', or sign in once with 'handoff' (the profile keeps the session).");
  }
  return b.id;
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1]; out[section] = out[section] || {}; continue; }
    const eq = line.indexOf('=');
    if (eq > 0 && section) out[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function chromiumSources(b: ChromiumBrowser): CookieSource[] {
  const root = chromiumRoot(b);
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EACCES') blocked.add(`${b.name} (${root})`);
    return [];
  }
  let names: Record<string, string> = {};
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf-8'));
    for (const [dir, info] of Object.entries<any>(ls?.profile?.info_cache || {})) names[dir] = info?.name || dir;
  } catch {}
  const out: CookieSource[] = [];
  for (const dir of entries.sort()) {
    if (dir === 'System Profile' || dir === 'Guest Profile') continue;
    const candidates = [path.join(root, dir, 'Network', 'Cookies'), path.join(root, dir, 'Cookies')];
    const dbPath = candidates.find(p => fs.existsSync(p));
    if (!dbPath) continue;
    out.push({
      browser: b.id, browserName: b.name, kind: 'chromium', profile: dir,
      profileLabel: names[dir] || dir, dbPath, keychainService: b.keychainService,
    });
  }
  return out;
}

/** Browser data folders the OS refused to let us read (macOS privacy protection). */
const blocked = new Set<string>();
export function blockedSources(): string[] { return [...blocked]; }
export const BLOCKED_HINT = process.platform === 'darwin'
  ? 'macOS privacy protection blocked access. Give your terminal app Full Disk Access (System Settings → Privacy & Security → Full Disk Access), restart it, and retry.'
  : 'The OS denied read access to that browser data folder.';

function readable(file: string, label: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EACCES') blocked.add(label);
    return null;
  }
}

function firefoxSources(): CookieSource[] {
  const out: CookieSource[] = [];
  for (const root of firefoxRoots()) {
    const text = readable(path.join(root, 'profiles.ini'), `Firefox (${root})`);
    if (text === null) continue;
    const ini = parseIni(text);
    let installDefault: string | null = null;
    try {
      const inst = parseIni(fs.readFileSync(path.join(root, 'installs.ini'), 'utf-8'));
      installDefault = Object.values(inst).find(s => s.Default)?.Default ?? null;
    } catch {}
    const profiles: Array<CookieSource & { isDefault: boolean }> = [];
    for (const [section, s] of Object.entries(ini)) {
      if (!section.startsWith('Profile') || !s.Path) continue;
      const dir = s.IsRelative === '0' ? s.Path : path.join(root, s.Path);
      const dbPath = path.join(dir, 'cookies.sqlite');
      if (!fs.existsSync(dbPath)) continue;
      profiles.push({
        browser: 'firefox', browserName: 'Firefox', kind: 'firefox',
        profile: s.Name || path.basename(dir), profileLabel: s.Name || path.basename(dir), dbPath,
        isDefault: s.Path === installDefault || (!installDefault && s.Default === '1'),
      });
    }
    profiles.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    out.push(...profiles.map(({ isDefault, ...src }) => ({ ...src, profileLabel: isDefault ? `${src.profileLabel} (default)` : src.profileLabel })));
  }
  return out;
}

/** All readable cookie sources, optionally for one browser id. */
export function listSources(browserId?: string): CookieSource[] {
  blocked.clear();
  const out: CookieSource[] = [];
  const chromiumAvailable = process.platform === 'darwin' || !!process.env.BROWSE_CHROMIUM_ROOT;
  if (chromiumAvailable) {
    for (const b of CHROMIUM_MAC) if (!browserId || browserId === b.id) out.push(...chromiumSources(b));
  }
  if (!browserId || browserId === 'firefox') out.push(...firefoxSources());
  return out;
}

// ─── Domains ───────────────────────────────────────────────────

export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  if (/^[a-z]+:\/\//.test(d)) {
    try { d = new URL(d).hostname; } catch { throw usage(`Invalid domain: ${input}`); }
  }
  d = d.replace(/^\.+/, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(d)) throw usage(`Invalid domain: ${input}`, 'Use a host name like example.com');
  return d;
}

function hostMatchSql(column: string, domains: string[]): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  for (const d of domains) {
    parts.push(`${column} = ? OR ${column} = ? OR ${column} LIKE ?`);
    params.push(d, `.${d}`, `%.${d}`);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

// ─── DB access (always from a private copy) ────────────────────

function withDbCopy<T>(src: CookieSource, fn: (db: Database) => T): T {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sane-browse-cookies-'));
  const copy = path.join(dir, 'cookies.db');
  try {
    try {
      fs.copyFileSync(src.dbPath, copy);
      for (const ext of ['-wal', '-shm']) {
        if (fs.existsSync(src.dbPath + ext)) fs.copyFileSync(src.dbPath + ext, copy + ext);
      }
    } catch (err: any) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        throw needsUser(`Cannot read ${src.browserName}'s cookie database (permission denied).`,
          'On macOS, grant your terminal Full Disk Access in System Settings → Privacy & Security, then retry.');
      }
      throw err;
    }
    const db = new Database(copy, { readonly: true });
    try { return fn(db); } finally { db.close(); }
  } catch (err: any) {
    if (err instanceof BrowseError) throw err;
    if (/malformed|not a database|SQLITE_CORRUPT/i.test(String(err?.message))) {
      throw new BrowseError(`Cookie database for ${src.browserName} (${src.profile}) is unreadable.`);
    }
    throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CHROMIUM_EPOCH_OFFSET = 11644473600000000n;
const chromiumNow = () => BigInt(Date.now()) * 1000n + CHROMIUM_EPOCH_OFFSET;
const unixNow = () => Math.floor(Date.now() / 1000);

/** Non-expired cookie count per matching host, without decrypting anything. */
export function countCookies(src: CookieSource, domains: string[]): Record<string, number> {
  const m = hostMatchSql(src.kind === 'chromium' ? 'host_key' : 'host', domains);
  return withDbCopy(src, db => {
    const rows = src.kind === 'chromium'
      ? db.query(`SELECT host_key AS host, COUNT(*) AS n FROM cookies WHERE ${m.sql} AND (has_expires = 0 OR expires_utc > ?) GROUP BY host_key`).all(...m.params, chromiumNow() as any)
      : db.query(`SELECT host, COUNT(*) AS n FROM moz_cookies WHERE ${m.sql} AND ${firefoxDefaultContainer(db)} GROUP BY host`).all(...m.params);
    const out: Record<string, number> = {};
    for (const r of rows as Array<{ host: string; n: number }>) out[r.host] = r.n;
    return out;
  });
}

/** Every host in a source with its cookie count (picker UI). */
export function listDomains(src: CookieSource): Array<{ domain: string; count: number }> {
  return withDbCopy(src, db => {
    const rows = src.kind === 'chromium'
      ? db.query(`SELECT host_key AS domain, COUNT(*) AS count FROM cookies WHERE has_expires = 0 OR expires_utc > ? GROUP BY host_key ORDER BY count DESC`).all(chromiumNow() as any)
      : db.query(`SELECT host AS domain, COUNT(*) AS count FROM moz_cookies WHERE ${firefoxDefaultContainer(db)} GROUP BY host ORDER BY count DESC`).all();
    return rows as Array<{ domain: string; count: number }>;
  });
}

function firefoxColumns(db: Database): Set<string> {
  return new Set((db.query('PRAGMA table_info(moz_cookies)').all() as Array<{ name: string }>).map(c => c.name));
}

function firefoxDefaultContainer(db: Database): string {
  return firefoxColumns(db).has('originAttributes') ? "originAttributes = ''" : '1 = 1';
}

// ─── Import ────────────────────────────────────────────────────

export async function importFromSource(src: CookieSource, domains: string[], opts: { key?: Buffer } = {}): Promise<ImportResult> {
  return src.kind === 'chromium' ? importChromium(src, domains, opts.key) : importFirefox(src, domains);
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

async function importChromium(src: CookieSource, domains: string[], keyOverride?: Buffer): Promise<ImportResult> {
  const key = keyOverride ?? await getDerivedKey(src.keychainService!);
  const m = hostMatchSql('host_key', domains);
  return withDbCopy(src, db => {
    const meta = db.query(`SELECT value FROM meta WHERE key = 'version'`).get() as { value: string } | null;
    const version = meta ? parseInt(meta.value, 10) : 0;
    const rows = db.query(
      `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, samesite
       FROM cookies WHERE ${m.sql} AND (has_expires = 0 OR expires_utc > ?) ORDER BY host_key, name`,
    ).all(...m.params, chromiumNow() as any) as RawChromiumCookie[];

    const result: ImportResult = { source: src, cookies: [], failures: {}, domainCounts: {} };
    for (const row of rows) {
      let value: string;
      try {
        value = decryptChromiumValue(row, key, version);
      } catch (err: any) {
        bump(result.failures, err?.code === 'unsupported_encryption' ? 'unsupported_encryption' : 'decryption_failed');
        continue;
      }
      result.cookies.push(normalizeCookie({
        name: row.name, value, domain: row.host_key, path: row.path || '/',
        expires: chromiumExpiry(row.expires_utc, row.has_expires),
        secure: row.is_secure === 1, httpOnly: row.is_httponly === 1,
        sameSite: mapSameSite(row.samesite),
      }));
      bump(result.domainCounts, row.host_key);
    }
    return result;
  });
}

function importFirefox(src: CookieSource, domains: string[]): ImportResult {
  const m = hostMatchSql('host', domains);
  return withDbCopy(src, db => {
    const cols = firefoxColumns(db);
    const raw = cols.has('rawSameSite') ? ', rawSameSite' : '';
    const rows = db.query(
      `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite${raw}
       FROM moz_cookies WHERE ${m.sql} AND ${firefoxDefaultContainer(db)} ORDER BY host, name`,
    ).all(...m.params) as RawFirefoxCookie[];

    const now = unixNow();
    const result: ImportResult = { source: src, cookies: [], failures: {}, domainCounts: {} };
    for (const row of rows) {
      const expires = firefoxExpiry(row.expiry);
      if (expires !== -1 && expires <= now) continue;
      const sameSite = row.rawSameSite === 0 ? 'Lax' : mapSameSite(row.sameSite);
      result.cookies.push(normalizeCookie({
        name: row.name, value: row.value ?? '', domain: row.host, path: row.path || '/',
        expires, secure: row.isSecure === 1, httpOnly: row.isHttpOnly === 1, sameSite,
      }));
      bump(result.domainCounts, row.host);
    }
    return result;
  });
}

// ─── Value handling (exported for tests) ───────────────────────

interface RawChromiumCookie {
  host_key: string; name: string; value: string; encrypted_value: Uint8Array;
  path: string; expires_utc: number | bigint; is_secure: number; is_httponly: number;
  has_expires: number; samesite: number;
}

interface RawFirefoxCookie {
  host: string; name: string; value: string; path: string; expiry: number;
  isSecure: number; isHttpOnly: number; sameSite: number; rawSameSite?: number;
}

export function decryptChromiumValue(row: { value: string; encrypted_value: Uint8Array }, key: Buffer, dbVersion: number): string {
  if (row.value && row.value.length > 0) return row.value;
  const ev = Buffer.from(row.encrypted_value ?? []);
  if (ev.length === 0) return '';
  const prefix = ev.subarray(0, 3).toString('utf-8');
  if (prefix !== 'v10') {
    const e: any = new Error(`Unsupported encryption prefix ${prefix}`);
    e.code = 'unsupported_encryption';
    throw e;
  }
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  const plain = Buffer.concat([decipher.update(ev.subarray(3)), decipher.final()]);
  // Schema 24+ prepends SHA256(host_key) to the plaintext.
  const body = dbVersion >= 24 ? plain.subarray(32) : plain;
  return body.toString('utf-8');
}

export function encryptChromiumValueForTest(value: string, host: string, key: Buffer, dbVersion: number): Buffer {
  const prefix = dbVersion >= 24 ? crypto.createHash('sha256').update(host).digest() : Buffer.alloc(0);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from('v10'), cipher.update(Buffer.concat([prefix, Buffer.from(value)])), cipher.final()]);
}

export function deriveChromiumKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

function chromiumExpiry(epoch: number | bigint, hasExpires: number): number {
  if (hasExpires === 0 || epoch === 0 || epoch === 0n) return -1;
  return Number((BigInt(epoch) - CHROMIUM_EPOCH_OFFSET) / 1000000n);
}

/** Firefox stored seconds historically and milliseconds in newer releases. */
export function firefoxExpiry(expiry: number): number {
  if (!expiry || expiry <= 0) return -1;
  return expiry > 1e11 ? Math.floor(expiry / 1000) : expiry;
}

function mapSameSite(v: number): 'Strict' | 'Lax' | 'None' {
  return v === 2 ? 'Strict' : v === 1 ? 'Lax' : v === 0 ? 'None' : 'Lax';
}

/** Chromium rejects SameSite=None without Secure; fall back to the browser default. */
function normalizeCookie(c: PlaywrightCookie): PlaywrightCookie {
  if (c.sameSite === 'None' && !c.secure) return { ...c, sameSite: 'Lax' };
  return c;
}

// ─── Keychain (macOS) ──────────────────────────────────────────

const keyCache = new Map<string, Buffer>();
const KEYCHAIN_TIMEOUT_MS = 60_000;

async function getDerivedKey(service: string): Promise<Buffer> {
  const cached = keyCache.get(service);
  if (cached) return cached;
  const key = deriveChromiumKey(await getKeychainPassword(service));
  keyCache.set(service, key);
  return key;
}

async function getKeychainPassword(service: string): Promise<string> {
  const proc = Bun.spawn(['security', 'find-generic-password', '-s', service, '-w'], { stdout: 'pipe', stderr: 'pipe' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), KEYCHAIN_TIMEOUT_MS); });
  const exit = await Promise.race([proc.exited, timeout]);
  clearTimeout(timer);
  if (exit === 'timeout') {
    proc.kill();
    throw needsUser(`Timed out after 60s waiting for the macOS Keychain dialog for "${service}".`,
      'Ask the user to click Allow (or Always Allow) in the dialog, then retry the import.');
  }
  const stdout = await new Response(proc.stdout).text();
  const stderr = (await new Response(proc.stderr).text()).trim().toLowerCase();
  if (exit === 0) return stdout.trim();
  if (stderr.includes('user canceled') || stderr.includes('denied') || stderr.includes('interaction not allowed')) {
    throw needsUser(`Keychain access to "${service}" was denied.`, 'Ask the user to retry and click Allow in the macOS dialog.');
  }
  if (stderr.includes('could not be found')) {
    throw new BrowseError(`No Keychain entry "${service}"; the browser may never have stored cookies.`);
  }
  throw new BrowseError(`Could not read the Keychain: ${stderr}`);
}
