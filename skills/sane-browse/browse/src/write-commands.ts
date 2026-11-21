/**
 * Write commands — navigate and interact (side effects).
 * Element commands act inside the selected frame (see `frame`).
 */

import type { Locator } from 'playwright';
import type { BrowserManager } from './browser-manager';
import { validateNavigationUrl } from './url-validation';
import { resolveInputPath } from './paths';
import { currentRequest } from './request-context';
import { BrowseError, usage } from './errors';
import type { BrowseConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';

const ACTION_TIMEOUT = 5000;

/**
 * Run an element action; on timeout, explain whether nothing matched or the
 * match was not actionable, instead of a bare Playwright timeout.
 */
async function act(bm: BrowserManager, selector: string, verb: string, fn: (l: Locator) => Promise<unknown>): Promise<Locator> {
  const loc = await bm.locator(selector);
  try {
    await fn(loc);
    return loc;
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/strict mode violation|resolved to \d+ elements/.test(msg)) {
      const n = await loc.count().catch(() => 0);
      throw usage(`'${selector}' matched ${n} elements; ${verb} needs exactly one.`, "Use a more specific selector, or an @ref from 'snapshot -i'.");
    }
    if (err?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(msg)) {
      const n = await loc.count().catch(() => 0);
      if (n === 0) {
        const inFrame = bm.getTarget() !== bm.getPage().mainFrame();
        const frames = bm.getPage().frames().length - 1;
        const hint = !inFrame && frames > 0
          ? `The page has ${frames} iframe(s); the element may be inside one ('snapshot' lists them, 'frame <sel>' enters one).`
          : "Run 'snapshot -i' to see the available elements.";
        throw new BrowseError(`No element matches '${selector}' (waited ${ACTION_TIMEOUT / 1000}s).`, 'failed', hint);
      }
      const visible = await loc.first().isVisible().catch(() => false);
      const enabled = await loc.first().isEnabled().catch(() => true);
      const why = !visible ? 'it is not visible' : !enabled ? 'it is disabled' : 'another element covers it or it keeps moving';
      throw new BrowseError(`Could not ${verb} '${selector}': ${why}.`, 'failed', "Check 'snapshot -i' or 'screenshot', or scroll it into view first.");
    }
    throw err;
  }
}

async function pointFor(bm: BrowserManager, args: string[]): Promise<{ x: number; y: number; rest: string[] }> {
  if (args.length >= 2 && /^-?\d+(\.\d+)?$/.test(args[0]) && /^-?\d+(\.\d+)?$/.test(args[1])) {
    return { x: Number(args[0]), y: Number(args[1]), rest: args.slice(2) };
  }
  if (!args[0]) throw usage('Need a selector, @ref, or x y');
  const loc = await bm.locator(args[0]);
  await loc.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT }).catch(() => {});
  const box = await loc.boundingBox({ timeout: ACTION_TIMEOUT });
  if (!box) throw new BrowseError(`'${args[0]}' has no box (not visible).`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, rest: args.slice(1) };
}

function numFlag(args: string[], name: string, dflt: number): number {
  const i = args.indexOf(name);
  if (i === -1) return dflt;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v)) throw usage(`${name} needs a number`);
  args.splice(i, 2);
  return v;
}

export async function handleWriteCommand(
  command: string,
  args: string[],
  bm: BrowserManager,
  config: BrowseConfig,
): Promise<string> {
  const page = bm.getPage();
  const target = bm.getTarget();

  switch (command) {
    case 'goto': {
      const url = args[0];
      if (!url) throw usage('Usage: goto <url>');
      await validateNavigationUrl(url);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      return `Navigated to ${url} (${response?.status() ?? 'no response'})`;
    }

    case 'back': {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
      return `Back → ${page.url()}`;
    }

    case 'forward': {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
      return `Forward → ${page.url()}`;
    }

    case 'reload': {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      return `Reloaded ${page.url()}`;
    }

    case 'click': {
      const selector = args[0];
      if (!selector) throw usage('Usage: click <selector|@ref>');
      if (bm.getRefRole(selector) === 'option') {
        const loc = await bm.locator(selector);
        const info = await loc.evaluate(el => {
          if (el.tagName !== 'OPTION' || !el.closest('select')) return null;
          return { value: (el as HTMLOptionElement).value, text: (el as HTMLOptionElement).text };
        });
        if (info) {
          await loc.locator('xpath=ancestor::select').selectOption(info.value, { timeout: ACTION_TIMEOUT });
          return `Selected "${info.text}" (click on <option> routed to select)`;
        }
      }
      const loc = await bm.locator(selector);
      if (await loc.evaluate(el => el.tagName === 'OPTION').catch(() => false)) {
        throw usage("Cannot click <option> elements.", "Use 'select <parent-select> <value>'.");
      }
      await act(bm, selector, 'click', l => l.click({ timeout: ACTION_TIMEOUT }));
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return `Clicked ${selector} → now at ${page.url()}`;
    }

    case 'fill': {
      const [selector, ...valueParts] = args;
      if (!selector || valueParts.length === 0) throw usage('Usage: fill <selector|@ref> <value>');
      await act(bm, selector, 'fill', l => l.fill(valueParts.join(' '), { timeout: ACTION_TIMEOUT }));
      return `Filled ${selector}`;
    }

    case 'select': {
      const [selector, ...valueParts] = args;
      const value = valueParts.join(' ');
      if (!selector || !value) throw usage('Usage: select <selector|@ref> <value>');
      const loc = await act(bm, selector, 'select in', async l => {
        try {
          await l.selectOption(value, { timeout: ACTION_TIMEOUT });
        } catch (err: any) {
          if (/did not find some options/i.test(String(err?.message))) await l.selectOption({ label: value }, { timeout: ACTION_TIMEOUT });
          else throw err;
        }
      });
      const chosen = await loc.evaluate(el => (el as HTMLSelectElement).selectedOptions?.[0]?.text ?? '').catch(() => '');
      return `Selected "${chosen || value}" in ${selector}`;
    }

    case 'hover': {
      const selector = args[0];
      if (!selector) throw usage('Usage: hover <selector|@ref>');
      await act(bm, selector, 'hover', l => l.hover({ timeout: ACTION_TIMEOUT }));
      return `Hovered ${selector}`;
    }

    case 'type': {
      const text = args.join(' ');
      if (!text) throw usage('Usage: type <text>');
      await page.keyboard.type(text);
      return `Typed ${text.length} characters`;
    }

    case 'press': {
      const key = args[0];
      if (!key) throw usage('Usage: press <key> (e.g. Enter, Tab, Escape)');
      await page.keyboard.press(key);
      return `Pressed ${key}`;
    }

    case 'scroll': {
      const selector = args[0];
      if (selector) {
        await act(bm, selector, 'scroll to', l => l.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT }));
        return `Scrolled ${selector} into view`;
      }
      await target.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      return 'Scrolled to bottom';
    }

    case 'wait': {
      const what = args[0];
      if (!what) throw usage('Usage: wait <selector|@ref|--networkidle|--load|--domcontentloaded> [ms]');
      const timeout = args[1] ? parseInt(args[1], 10) : (currentRequest().timeoutMs ?? 15000);
      if (!Number.isFinite(timeout) || timeout <= 0) throw usage('Timeout must be a positive number of milliseconds');
      try {
        if (what === '--networkidle') { await page.waitForLoadState('networkidle', { timeout }); return 'Network idle'; }
        if (what === '--load') { await page.waitForLoadState('load', { timeout }); return 'Page loaded'; }
        if (what === '--domcontentloaded') { await page.waitForLoadState('domcontentloaded', { timeout }); return 'DOM content loaded'; }
        const loc = await bm.locator(what);
        await loc.first().waitFor({ state: 'visible', timeout });
        return `Element ${what} appeared`;
      } catch (err: any) {
        if (err?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(String(err?.message))) {
          throw new BrowseError(`Timed out after ${timeout}ms waiting for ${what}.`);
        }
        throw err;
      }
    }

    case 'viewport': {
      const m = (args[0] || '').match(/^(\d+)x(\d+)$/);
      if (!m) throw usage('Usage: viewport <WxH> (e.g. 375x812)');
      await bm.setViewport(Number(m[1]), Number(m[2]));
      return `Viewport set to ${m[1]}x${m[2]}`;
    }

    case 'cookie': {
      const cookieStr = args[0];
      if (!cookieStr || !cookieStr.includes('=')) throw usage('Usage: cookie <name>=<value>');
      const eq = cookieStr.indexOf('=');
      let host: string;
      try { host = new URL(page.url()).hostname; } catch { host = ''; }
      if (!host) throw usage('Navigate to a page first; the cookie is set on its domain.');
      await bm.getContext().addCookies([{ name: cookieStr.slice(0, eq), value: cookieStr.slice(eq + 1), domain: host, path: '/' }]);
      return `Cookie set: ${cookieStr.slice(0, eq)}=****`;
    }

    case 'header': {
      const headerStr = args.join(' ');
      if (!headerStr.includes(':')) throw usage('Usage: header <name>:<value>');
      const sep = headerStr.indexOf(':');
      const name = headerStr.slice(0, sep).trim();
      const value = headerStr.slice(sep + 1).trim();
      await bm.setExtraHeader(name, value);
      const sensitive = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization'];
      return `Header set: ${name}: ${sensitive.includes(name.toLowerCase()) ? '****' : value}`;
    }

    case 'useragent': {
      const ua = args.join(' ');
      if (!ua) throw usage('Usage: useragent <string>');
      bm.setUserAgent(ua);
      await bm.recreateContext();
      return `User agent set: ${ua} (tabs reopened; refs cleared)`;
    }

    case 'upload': {
      const [selector, ...files] = args;
      if (!selector || files.length === 0) throw usage('Usage: upload <selector|@ref> <file1> [file2...]');
      const cwd = currentRequest().cwd;
      const resolved = files.map(f => {
        const p = path.resolve(cwd, f);
        if (!fs.existsSync(p)) throw usage(`File not found: ${f}`);
        return p;
      });
      await act(bm, selector, 'upload to', l => l.setInputFiles(resolved, { timeout: ACTION_TIMEOUT }));
      return `Uploaded: ${resolved.map(p => `${path.basename(p)} (${fs.statSync(p).size}B)`).join(', ')}`;
    }

    case 'dialog-accept': {
      const text = args.length > 0 ? args.join(' ') : null;
      bm.setDialogAutoAccept(true);
      bm.setDialogPromptText(text);
      return text ? `Dialogs will be accepted with text: "${text}"` : 'Dialogs will be accepted';
    }

    case 'dialog-dismiss': {
      bm.setDialogAutoAccept(false);
      bm.setDialogPromptText(null);
      return 'Dialogs will be dismissed';
    }

    case 'cookie-import': {
      const file = args[0];
      if (!file) throw usage('Usage: cookie-import <file.json>');
      const real = resolveInputPath(file, config, currentRequest().cwd);
      let cookies: any[];
      try { cookies = JSON.parse(fs.readFileSync(real, 'utf-8')); } catch { throw usage(`Invalid JSON in ${file}`); }
      if (!Array.isArray(cookies)) throw usage('Cookie file must contain a JSON array');
      let host = '';
      try { host = new URL(page.url()).hostname; } catch {}
      for (const c of cookies) {
        if (!c.name || c.value === undefined) throw usage('Each cookie needs "name" and "value"');
        if (!c.domain && !c.url) {
          if (!host) throw usage('Cookies without "domain" need a page open on that domain first.');
          c.domain = host;
        }
        if (!c.path && !c.url) c.path = '/';
      }
      await bm.getContext().addCookies(cookies);
      return `Loaded ${cookies.length} cookies from ${file}`;
    }

    case 'tap': {
      const { x, y } = await pointFor(bm, args);
      await bm.touch('touchStart', [{ x, y }]);
      await bm.touch('touchEnd', []);
      return `Tapped at ${Math.round(x)},${Math.round(y)}`;
    }

    case 'swipe': {
      const rest = [...args];
      const distance = numFlag(rest, '--distance', 300);
      const ms = numFlag(rest, '--ms', 300);
      const { x, y, rest: tail } = await pointFor(bm, rest);
      const dir = tail[0];
      const vec = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir as 'up'];
      if (!vec) throw usage('Usage: swipe <sel|@ref|x y> <up|down|left|right> [--distance px] [--ms n]');
      const steps = Math.max(5, Math.round(ms / 16));
      await bm.touch('touchStart', [{ x, y }]);
      for (let i = 1; i <= steps; i++) {
        await bm.touch('touchMove', [{ x: x + vec[0] * distance * i / steps, y: y + vec[1] * distance * i / steps }]);
        await Bun.sleep(ms / steps);
      }
      await bm.touch('touchEnd', []);
      return `Swiped ${dir} ${distance}px from ${Math.round(x)},${Math.round(y)}`;
    }

    default:
      throw new Error(`Unknown write command: ${command}`);
  }
}
