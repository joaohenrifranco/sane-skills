/**
 * Cookie import: Firefox end-to-end through the CLI (fake profile), Chromium
 * decryption + discovery through the module (fake profile, injected key, so
 * no Keychain prompt), and the picker's access control.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startFixtureServer, makeSandbox, type Sandbox } from './helpers';
import {
  listSources, importFromSource, countCookies, decryptChromiumValue, encryptChromiumValueForTest,
  deriveChromiumKey, firefoxExpiry, normalizeDomain,
} from '../src/cookie-import-browser';
import { textSeparator } from '../src/cookie-commands';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sane-cookies-')));
const future = Math.floor(Date.now() / 1000) + 3600;
const U = '--unsafe-copy-browser-cookies';

function makeFirefoxRoot(): string {
  const root = tmp();
  const prof = path.join(root, 'Profiles', 'abcd.default-release');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(root, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abcd.default-release\n');
  fs.writeFileSync(path.join(root, 'installs.ini'), '[ABC123]\nDefault=Profiles/abcd.default-release\n');
  const db = new Database(path.join(prof, 'cookies.sqlite'));
  db.run(`CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '', name TEXT, value TEXT,
    host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER, isHttpOnly INTEGER,
    inBrowserElement INTEGER DEFAULT 0, sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0)`);
  const ins = db.prepare('INSERT INTO moz_cookies (originAttributes,name,value,host,path,expiry,isSecure,isHttpOnly,sameSite,rawSameSite) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run('', 'ff_seconds', 'a', 'localhost', '/', future, 0, 0, 1, 1);
  ins.run('', 'ff_millis', 'b', 'localhost', '/', future * 1000, 0, 1, 0, 0);
  ins.run('^userContextId=2', 'ff_container', 'c', 'localhost', '/', future, 0, 0, 1, 1);
  ins.run('', 'ff_expired', 'd', 'localhost', '/', 1000, 0, 0, 1, 1);
  ins.run('', 'ff_other', 'e', 'example.org', '/', future, 0, 0, 1, 1);
  db.close();
  return root;
}

describe('firefox import through the CLI', () => {
  let site: { url: string; stop: () => void };
  let sb: Sandbox;
  let ffRoot: string;
  beforeAll(() => {
    site = startFixtureServer();
    ffRoot = makeFirefoxRoot();
    sb = makeSandbox({ BROWSE_FIREFOX_ROOT: ffRoot });
  });
  afterAll(async () => { await sb.stop(); site.stop(); fs.rmSync(ffRoot, { recursive: true, force: true }); });

  test('sources lists the default profile', async () => {
    const r = await sb.run(['cookies', 'sources', 'firefox']);
    expect(r.out).toContain('--profile "default-release"');
  });

  test('imports only default-container, unexpired cookies for the domain', async () => {
    await sb.run(['goto', `${site.url}/`]);
    const r = await sb.run(['cookies', 'import', 'firefox', '--domain', 'localhost', U]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Imported 2 cookie(s)');
    expect(r.out).toContain('Auth: not checked');
    await sb.run(['goto', `${site.url}/echo-cookies`]);
    const text = (await sb.run(['text'])).out;
    expect(text).toContain('ff_seconds=a');
    expect(text).toContain('ff_millis=b');
    expect(text).not.toContain('ff_container');
    expect(text).not.toContain('ff_expired');
    expect(text).not.toContain('ff_other');
  });

  test('a domain with no cookies fails with a hint (exit 1)', async () => {
    const r = await sb.run(['cookies', 'import', 'firefox', '--domain', 'nothing.example', U]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('No cookies for nothing.example');
    expect(r.err).toContain('handoff');
  });

  test('--domain is required; unknown browsers are usage errors', async () => {
    expect((await sb.run(['cookies', 'import', 'firefox', U])).code).toBe(2);
    expect((await sb.run(['cookies', 'import', 'netscape', '--domain', 'x.com', U])).code).toBe(2);
  });

  test('--verify-auth checks a visible element after import', async () => {
    await sb.run(['goto', `${site.url}/secret.html`]);
    const ok = await sb.run(['cookies', 'import', 'firefox', '--domain', 'localhost', U, '--verify-auth', 'h1=Welcome human']);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('Auth: verified');
    const bad = await sb.run(['cookies', 'import', 'firefox', '--domain', 'localhost', U, '--verify-auth', 'h1=Someone else']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('Auth: NOT verified');
  });

  test('copying is refused without the unsafe flag, pointing to handoff', async () => {
    const r = await sb.run(['cookies', 'import', 'firefox', '--domain', 'localhost']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('handoff');
    expect(r.err).toContain(U);
    expect((await sb.run(['cookies', 'picker'])).code).toBe(2);
    expect((await sb.run(['cookie-import-browser', 'firefox', '--domain', 'localhost'])).code).toBe(2);
  });

  test('copied cookies are temporary: gone after stop', async () => {
    await sb.run(['goto', `${site.url}/`]);
    const r = await sb.run(['cookies', 'import', 'firefox', '--domain', 'localhost', U]);
    expect(r.out).toContain('UNSAFE');
    expect(r.out).toContain('Temporary');
    await sb.run(['stop']);
    await sb.run(['goto', `${site.url}/echo-cookies`]);
    expect((await sb.run(['text'])).out).not.toContain('ff_seconds');
  });

  test('copied cookies are removed at the next start after a crash', async () => {
    await sb.run(['goto', `${site.url}/`]);
    await sb.run(['cookies', 'import', 'firefox', '--domain', 'localhost', U]);
    const statesRoot = path.join(sb.home, 'projects');
    const dir = path.join(statesRoot, fs.readdirSync(statesRoot)[0]);
    expect(fs.existsSync(path.join(dir, 'copied-cookies.json'))).toBe(true);
    const manifest = fs.readFileSync(path.join(dir, 'copied-cookies.json'), 'utf-8');
    expect(manifest).not.toContain('"value"');
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'browse.json'), 'utf-8'));
    process.kill(state.pid, 'SIGKILL');
    await Bun.sleep(500);
    await sb.run(['goto', `${site.url}/echo-cookies`]);
    expect((await sb.run(['text'])).out).not.toContain('ff_seconds');
    expect(fs.existsSync(path.join(dir, 'copied-cookies.json'))).toBe(false);
  });

  test('--persist keeps copied cookies; clear --imported and purge remove state', async () => {
    await sb.run(['goto', `${site.url}/`]);
    const r = await sb.run(['cookies', 'import', 'firefox', '--domain', 'localhost', U, '--persist']);
    expect(r.out).toContain('PERSISTED');
    await sb.run(['stop']);
    await sb.run(['goto', `${site.url}/echo-cookies`]);
    expect((await sb.run(['text'])).out).toContain('ff_seconds=a');
    expect((await sb.run(['purge'])).code).toBe(2);
    const p = await sb.run(['purge', '--yes']);
    expect(p.code).toBe(0);
    expect(fs.existsSync(path.join(sb.home, 'profiles'))).toBe(true);
    expect(fs.readdirSync(path.join(sb.home, 'profiles'))).toEqual([]);
    await sb.run(['goto', `${site.url}/echo-cookies`]);
    expect((await sb.run(['text'])).out).toContain('(none)');
  });

  test('the picker refuses requests without its one-use token', async () => {
    const statesRoot = path.join(sb.home, 'projects');
    const state = JSON.parse(fs.readFileSync(path.join(statesRoot, fs.readdirSync(statesRoot)[0], 'browse.json'), 'utf-8'));
    const base = `http://127.0.0.1:${state.port}/cookie-picker`;
    expect((await fetch(base)).status).toBe(403);
    expect((await fetch(`${base}/browsers`)).status).toBe(401);
    expect((await fetch(`${base}/import`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
  });
});

describe('chromium import (module level, injected key)', () => {
  const key = deriveChromiumKey('test-password');
  let root: string;

  beforeAll(() => {
    root = tmp();
    const chrome = path.join(root, 'Google', 'Chrome');
    fs.mkdirSync(path.join(chrome, 'Default'), { recursive: true });
    fs.mkdirSync(path.join(chrome, 'Profile 1', 'Network'), { recursive: true });
    fs.writeFileSync(path.join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Default': { name: 'Personal' }, 'Profile 1': { name: 'Work' } } } }));
    const make = (dbPath: string, version: number, rows: Array<[string, string, string]>) => {
      const db = new Database(dbPath);
      db.run(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
      db.run(`INSERT INTO meta VALUES ('version', ?)`, [String(version)]);
      db.run(`CREATE TABLE cookies (creation_utc INTEGER, host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT,
        encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, last_access_utc INTEGER,
        has_expires INTEGER, is_persistent INTEGER, priority INTEGER, samesite INTEGER, source_scheme INTEGER)`);
      const exp = (BigInt(future) * 1000000n + 11644473600000000n).toString();
      for (const [host, name, value] of rows) {
        const enc = encryptChromiumValueForTest(value, host, key, version);
        db.run(`INSERT INTO cookies (host_key,name,value,encrypted_value,path,expires_utc,is_secure,is_httponly,has_expires,samesite)
          VALUES (?,?,'',?,'/',?,1,1,1,1)`, [host, name, enc, exp]);
      }
      db.close();
    };
    make(path.join(chrome, 'Default', 'Cookies'), 24, [['.github.com', 'logged_in', 'yes'], ['github.com', '_gh_sess', 'abc'], ['gist.github.com', 'g', '1'], ['notgithub.com', 'x', '1']]);
    make(path.join(chrome, 'Profile 1', 'Network', 'Cookies'), 18, [['.work.example', 'w', 'old-schema-value']]);
    process.env.BROWSE_CHROMIUM_ROOT = root;
  });
  afterAll(() => { delete process.env.BROWSE_CHROMIUM_ROOT; fs.rmSync(root, { recursive: true, force: true }); });

  test('discovers profiles in both DB locations with display names', () => {
    const chrome = listSources('chrome');
    expect(chrome.map(s => [s.profile, s.profileLabel])).toEqual([['Default', 'Personal'], ['Profile 1', 'Work']]);
  });

  test('domain matching covers the dotted parent and subdomains, not look-alikes', async () => {
    const src = listSources('chrome').find(s => s.profile === 'Default')!;
    expect(countCookies(src, ['github.com'])).toEqual({ '.github.com': 1, 'github.com': 1, 'gist.github.com': 1 });
    const result = await importFromSource(src, ['github.com'], { key });
    expect(result.cookies.map(c => `${c.name}=${c.value}`).sort()).toEqual(['_gh_sess=abc', 'g=1', 'logged_in=yes']);
  });

  test('the 32-byte hash prefix is stripped only for schema >= 24', async () => {
    const src = listSources('chrome').find(s => s.profile === 'Profile 1')!;
    const result = await importFromSource(src, ['work.example'], { key });
    expect(result.cookies[0].value).toBe('old-schema-value');
  });

  test('unsupported prefixes are reported, not crashed on', () => {
    expect(() => decryptChromiumValue({ value: '', encrypted_value: Buffer.from('v20xxxxxxxxxxxxxxxx') }, key, 24)).toThrow(/Unsupported/);
  });

  test('--verify-auth splits selector and text outside brackets and quotes', () => {
    expect(textSeparator('h1=Welcome')).toBe(2);
    expect(textSeparator('a[aria-label*="Google Account"]')).toBe(-1);
    expect(textSeparator('a[href="/me"]=Ada')).toBe(13);
  });

  test('helpers', () => {
    expect(firefoxExpiry(future)).toBe(future);
    expect(firefoxExpiry(future * 1000)).toBe(future);
    expect(firefoxExpiry(0)).toBe(-1);
    expect(normalizeDomain('https://Sub.Example.com/path')).toBe('sub.example.com');
    expect(normalizeDomain('.example.com')).toBe('example.com');
    expect(() => normalizeDomain("x%' OR 1=1")).toThrow();
  });
});
