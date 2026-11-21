/**
 * End-to-end CLI tests against a local fixture site. Each describe block gets
 * its own BROWSE_HOME, so profiles, state and servers never collide.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { startFixtureServer, makeSandbox, type Sandbox } from './helpers';

let site: { url: string; stop: () => void };
beforeAll(() => { site = startFixtureServer(); });
afterAll(() => site.stop());

describe('reading, frames, errors, exit codes', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = makeSandbox();
    const r = await sb.run(['--ephemeral', 'goto', `${site.url}/`]);
    expect(r.code).toBe(0);
  });
  afterAll(async () => sb.stop());

  test('text keeps one block per line', async () => {
    const r = await sb.run(['text']);
    expect(r.out).toContain('Fixture\nPara one.\nPara two.');
  });

  test('snapshot lists iframes and frame enters them', async () => {
    const snap = await sb.run(['snapshot', '-i']);
    expect(snap.out).toContain('frame --name inner');
    expect((await sb.run(['frame', '--name', 'inner'])).code).toBe(0);
    expect((await sb.run(['snapshot', '-i'])).out).toContain('"Frame btn"');
    expect((await sb.run(['click', 'text=Frame btn'])).code).toBe(0);
    expect((await sb.run(['js', "document.querySelector('button').textContent"])).out.trim()).toBe('frame ok');
    expect((await sb.run(['frame', 'main'])).code).toBe(0);
    expect((await sb.run(['js', 'document.title'])).out.trim()).toBe('Fixture');
  });

  test('missing element: exit 1 with an explanation, not a timeout', async () => {
    const r = await sb.run(['click', '#nope']);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No element matches '#nope'");
    expect(r.err).toContain('iframe');
  });

  test('usage errors exit 2', async () => {
    expect((await sb.run(['bogus'])).code).toBe(2);
    expect((await sb.run(['screenshot', '/etc/sane-browse-test.png'])).code).toBe(2);
    expect((await sb.run(['handoff', '--until', 'nonsense'])).code).toBe(2);
  });

  test('relative screenshot paths resolve against the caller cwd', async () => {
    const r = await sb.run(['screenshot', '.local/shot.png']);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(sb.cwd, '.local', 'shot.png'))).toBe(true);
    const el = await sb.run(['screenshot', '--selector', 'h1', '--out', 'h1.png']);
    expect(el.out).toContain('(element)');
    expect(fs.existsSync(path.join(sb.cwd, 'h1.png'))).toBe(true);
  });

  test('chain stops at the first error and exits non-zero', async () => {
    const r = await sb.run(['chain'], { stdin: JSON.stringify([['url'], ['click', '#nope'], ['text']]) });
    expect(r.code).toBe(1);
    expect(r.err).toContain('chain stopped at step 2 of 3');
    expect(r.err).not.toContain('[text]');
  });

  test('wait honors its timeout', async () => {
    const r = await sb.run(['wait', '#never', '1500']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Timed out after 1500ms');
    await sb.run(['click', '#delayed']);
    expect((await sb.run(['wait', '#late'])).code).toBe(0);
  });

  test('--json wraps output and errors', async () => {
    const ok = JSON.parse((await sb.run(['--json', 'url'])).out);
    expect(ok).toMatchObject({ ok: true, command: 'url' });
    const bad = await sb.run(['--json', 'click', '#nope']);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.out)).toMatchObject({ ok: false, code: 'failed' });
  });

  test('stealth basics: webdriver false, no Headless in UA or brands', async () => {
    const r = await sb.run(['js', 'JSON.stringify([navigator.webdriver, navigator.userAgent, navigator.userAgentData?.brands?.map(b=>b.brand)])']);
    const [webdriver, ua, brands] = JSON.parse(r.out);
    expect(webdriver).toBe(false);
    expect(ua).not.toContain('Headless');
    expect(JSON.stringify(brands)).not.toContain('Headless');
  });

  test('download uses the browser context and writes under cwd', async () => {
    const r = await sb.run(['download', `${site.url}/file.txt`, '--out', 'dl/file.txt']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(sb.cwd, 'dl', 'file.txt'), 'utf-8')).toBe('hello file');
  });

  test('sessions get their own tabs without moving the active tab', async () => {
    await sb.run(['--session', 'a', 'goto', `${site.url}/secret.html`]);
    expect((await sb.run(['--session', 'a', 'url'])).out).toContain('/secret.html');
    expect((await sb.run(['url'])).out).not.toContain('/secret.html');
    expect((await sb.run(['tabs'])).out).toContain('session:a');
  });

  test('device emulation and tap', async () => {
    expect((await sb.run(['device', 'iPhone 15'])).code).toBe(0);
    expect((await sb.run(['js', 'navigator.maxTouchPoints'])).out.trim()).toBe('5');
    expect((await sb.run(['tap', 'text=Div button'])).code).toBe(0);
    expect((await sb.run(['js', "document.querySelector('.fake-btn').textContent"])).out.trim()).toBe('div clicked');
    expect((await sb.run(['viewport', '800x600'])).code).toBe(2);
    expect((await sb.run(['device', 'off'])).code).toBe(0);
  });
});

describe('persistence, profiles and state', () => {
  let sb: Sandbox;
  beforeAll(() => { sb = makeSandbox(); });
  afterAll(async () => sb.stop());

  test('persistent and session cookies survive a restart', async () => {
    await sb.run(['goto', `${site.url}/`]);
    await sb.run(['js', "document.cookie='keep=1; max-age=3600'; document.cookie='sess=1'; 'ok'"]);
    expect((await sb.run(['stop'])).out).toContain('Server stopped');
    expect((await sb.run(['stop'])).out).toContain('No browser running');
    await sb.run(['goto', `${site.url}/echo-cookies`]);
    const r = await sb.run(['text']);
    expect(r.out).toContain('keep=1');
    expect(r.out).toContain('sess=1');
  });

  test('conflicting launch options are refused while a browser runs', async () => {
    const r = await sb.run(['--ephemeral', 'url']);
    expect(r.code).toBe(2);
    expect(r.err).toContain("browse stop");
  });

  test('cookies are listed with values redacted', async () => {
    const r = await sb.run(['cookies', '--domain', 'localhost']);
    expect(r.out).toContain('"keep"');
    expect(r.out).toContain('[1 chars]');
    expect(r.out).not.toContain('"value": "1"');
  });

  test('state save/load round-trips into an ephemeral browser', async () => {
    expect((await sb.run(['state', 'save', 'mystate'])).code).toBe(0);
    const file = fs.readdirSync(path.join(sb.home, 'projects')).map(d => path.join(sb.home, 'projects', d, 'states', 'mystate.json'))[0];
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
    await sb.run(['stop']);
    await sb.run(['--ephemeral', 'goto', `${site.url}/echo-cookies`]);
    expect((await sb.run(['text'])).out).toContain('(none)');
    expect((await sb.run(['state', 'load', 'mystate'])).code).toBe(0);
    await sb.run(['reload']);
    expect((await sb.run(['text'])).out).toContain('keep=1');
    await sb.run(['stop']);
  });

  test('nothing is written into the project directory', async () => {
    expect(fs.readdirSync(sb.cwd)).toEqual([]);
  });
});
