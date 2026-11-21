/**
 * Chromium launch options: stealth basics, a consistent user agent, proxy,
 * profile locks, and a virtual display for headed runs on Linux.
 *
 * Stealth here is deliberately small (adapted from gstack's "Layer C"):
 *   - drop --enable-automation and disable the AutomationControlled feature,
 *     so navigator.webdriver is false;
 *   - report the same plain Chrome UA in headless and headed mode, so a
 *     clearance cookie earned during handoff stays valid afterwards;
 *   - restore window.chrome and hide the HeadlessChrome UA-CH brand.
 * It does not spoof plugins, WebGL or hardware; deep fingerprinting and the
 * Sec-CH-UA request header can still reveal headless Chromium.
 * BROWSE_STEALTH=off disables all of it.
 */

import { chromium, type LaunchOptions } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import type { LaunchConfig } from './config';
import { usage, needsUser } from './errors';

export const stealthEnabled = () => (process.env.BROWSE_STEALTH || '').toLowerCase() !== 'off';

export const STEALTH_ARGS = ['--disable-blink-features=AutomationControlled'];
export const STEALTH_IGNORE_DEFAULT_ARGS = ['--enable-automation'];

export const STEALTH_INIT_SCRIPT = `(() => {
  try {
    if (navigator.webdriver) {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    }
  } catch {}
  try {
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        value: { runtime: {}, app: { isInstalled: false }, csi() { return {}; }, loadTimes() { return {}; } },
        configurable: true, writable: true,
      });
    }
  } catch {}
  try {
    const uad = navigator.userAgentData;
    if (uad && uad.brands && uad.brands.some(b => /Headless/i.test(b.brand))) {
      const brands = uad.brands.map(b => ({ brand: b.brand.replace(/HeadlessChrome/i, 'Chromium'), version: b.version }));
      Object.defineProperty(Object.getPrototypeOf(uad), 'brands', { get: () => brands, configurable: true });
    }
  } catch {}
})();`;

let cachedUA: string | null | undefined;

/** A plain Chrome UA for the bundled Chromium's major version (reduced UA format). */
export function chromeUserAgent(): string | null {
  if (cachedUA !== undefined) return cachedUA;
  cachedUA = null;
  try {
    const exe = chromium.executablePath();
    const out = Bun.spawnSync([exe, '--version'], { stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
    const m = out.stdout.toString().match(/(\d+)\.\d+\.\d+\.\d+/);
    if (m) {
      const platform = process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
      cachedUA = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${m[1]}.0.0.0 Safari/537.36`;
    }
  } catch {}
  return cachedUA;
}

export function proxyOption(cfg: LaunchConfig): LaunchOptions['proxy'] | undefined {
  if (!cfg.proxy) return undefined;
  let u: URL;
  try { u = new URL(cfg.proxy); } catch { throw usage(`Invalid proxy URL: ${cfg.proxy}`); }
  const scheme = u.protocol.replace(':', '');
  if (!['http', 'https', 'socks5', 'socks4'].includes(scheme)) {
    throw usage(`Unsupported proxy scheme '${scheme}'. Use http, https, socks5 or socks4.`);
  }
  const user = decodeURIComponent(u.username) || process.env.BROWSE_PROXY_USER || '';
  const pass = decodeURIComponent(u.password) || process.env.BROWSE_PROXY_PASS || '';
  if (u.username && process.env.BROWSE_PROXY_USER) {
    throw usage('Proxy credentials given twice (URL and BROWSE_PROXY_USER). Use one.');
  }
  if (scheme.startsWith('socks') && (user || pass)) {
    throw usage('Chromium cannot authenticate to SOCKS proxies.', 'Use an HTTP proxy with credentials, or an unauthenticated SOCKS proxy.');
  }
  return {
    server: `${scheme}://${u.hostname}${u.port ? `:${u.port}` : ''}`,
    ...(user ? { username: user } : {}),
    ...(pass ? { password: pass } : {}),
    ...(cfg.proxyBypass ? { bypass: cfg.proxyBypass } : {}),
  };
}

/** Linux/Docker as root, or without user namespaces, cannot use the Chromium sandbox. */
export function sandboxArgs(): string[] {
  if (process.platform !== 'linux') return [];
  if (process.getuid?.() === 0) return ['--no-sandbox'];
  try {
    if (fs.readFileSync('/proc/sys/kernel/unprivileged_userns_clone', 'utf-8').trim() === '0') return ['--no-sandbox'];
  } catch {}
  return [];
}

/**
 * Remove a Chromium SingletonLock left by a crashed browser. The lock is a
 * symlink to "<hostname>-<pid>"; it is stale when that pid is gone.
 * Throws when a live process still holds the profile.
 */
export function clearStaleProfileLock(profileDir: string): void {
  const lock = path.join(profileDir, 'SingletonLock');
  let target: string;
  try { target = fs.readlinkSync(lock); } catch { return; }
  const pid = parseInt(target.split('-').pop() || '', 10);
  let alive = false;
  if (pid) { try { process.kill(pid, 0); alive = true; } catch {} }
  if (alive) {
    throw usage(
      `Profile ${profileDir} is in use by another browser (pid ${pid}).`,
      'Stop the other browse session (browse stop in that project), use --profile <other>, or --ephemeral.',
    );
  }
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch {}
  }
}

// ─── Virtual display (Linux headed without a display) ─────────────

let xvfb: { proc: ReturnType<typeof Bun.spawn>; display: string } | null = null;

export async function ensureDisplay(): Promise<Record<string, string> | undefined> {
  if (process.platform !== 'linux') return undefined;
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return undefined;
  if (xvfb) return { DISPLAY: xvfb.display };
  const which = Bun.spawnSync(['sh', '-c', 'command -v Xvfb'], { stdout: 'pipe' });
  if (which.exitCode !== 0) {
    throw needsUser('Headed mode needs a display, and Xvfb is not installed.', 'Install it (e.g. apt-get install xvfb) or run headless.');
  }
  for (let n = 99; n < 120; n++) {
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)) continue;
    const display = `:${n}`;
    const proc = Bun.spawn(['Xvfb', display, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdout: 'ignore', stderr: 'ignore' });
    await Bun.sleep(400);
    if (proc.exitCode === null) {
      xvfb = { proc, display };
      console.log(`[browse] Started Xvfb on ${display} (window is not visible to a human)`);
      return { DISPLAY: display };
    }
  }
  throw needsUser('Could not start Xvfb on displays :99-:119.');
}

export function stopDisplay(): void {
  if (xvfb) { try { xvfb.proc.kill(); } catch {} xvfb = null; }
}

export function isVirtualDisplay(): boolean {
  return xvfb !== null;
}
