/**
 * Headed mode and handoff. Needs a display (macOS desktop, or Linux with
 * Xvfb installed). Skipped when BROWSE_TEST_HEADED=0.
 *
 * The "user" is simulated by a second CLI call that navigates while
 * `handoff --until` is blocking.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startFixtureServer, makeSandbox, type Sandbox } from './helpers';

const enabled = process.env.BROWSE_TEST_HEADED !== '0';

describe.skipIf(!enabled)('handoff on a shared profile', () => {
  let site: { url: string; stop: () => void };
  let sb: Sandbox;
  beforeAll(() => { site = startFixtureServer(); sb = makeSandbox(); });
  afterAll(async () => { await sb.stop(); site.stop(); });

  test('handoff --until blocks, keeps cookies, and returns to headless', async () => {
    await sb.run(['goto', `${site.url}/`]);
    await sb.run(['js', "document.cookie='before=1'; 'ok'"]);
    const waiting = sb.run(['--timeout', '60000', 'handoff', 'please sign in', '--until', 'url:/secret']);
    // Wait until the headed browser is up, then act as the user.
    for (let i = 0; i < 60; i++) {
      const s = await sb.run(['status']);
      if (s.out.includes('Mode: headed')) break;
      await Bun.sleep(500);
    }
    expect((await sb.run(['status'])).out).toContain('handoff in progress');
    await sb.run(['goto', `${site.url}/secret.html`]);
    const r = await waiting;
    expect(r.code).toBe(0);
    expect(r.out).toContain('DONE: url matched');
    expect(r.out).toContain('Back to headless');
    expect((await sb.run(['status'])).out).toContain('Mode: headless');
    await sb.run(['goto', `${site.url}/echo-cookies`]);
    expect((await sb.run(['text'])).out).toContain('before=1');
  });

  test('handoff --until times out with exit 3 and leaves the window open', async () => {
    const r = await sb.run(['--timeout', '1500', 'handoff', 'never done', '--until', 'selector:#never']);
    expect(r.code).toBe(3);
    expect(r.err).toContain('Timed out');
    expect((await sb.run(['status'])).out).toContain('Mode: headed');
    const resumed = await sb.run(['resume']);
    expect(resumed.out).toContain('Back to headless');
  });

  test('--headed starts visible; resume keeps it visible', async () => {
    await sb.run(['stop']);
    expect((await sb.run(['--headed', 'goto', `${site.url}/`])).code).toBe(0);
    expect((await sb.run(['status'])).out).toContain('Mode: headed');
    await sb.run(['handoff', 'look']);
    expect((await sb.run(['resume'])).out).toContain('stays visible');
    await sb.run(['stop']);
  });
});
