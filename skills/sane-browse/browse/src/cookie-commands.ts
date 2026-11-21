/**
 * `cookies` command group.
 *
 *   cookies [--domain d] [--values]          list cookies (values redacted by default)
 *   cookies sources [browser]                detected browsers and profiles
 *   cookies import [browser] --domain d [--domain d2] [--profile P] [--verify-auth <sel>[=<text>]]
 *   cookies clear [--domain d]               remove cookies from this browser
 *   cookies picker                           open the interactive picker in the user's browser
 *
 * Imported cookies go into the current context. With a persistent profile
 * (the default) that means they are on disk and survive restarts.
 */

import type { BrowserManager } from './browser-manager';
import {
  listSources, resolveBrowserId, normalizeDomain, countCookies, importFromSource,
  blockedSources, BLOCKED_HINT, SUPPORTED_BROWSERS, type CookieSource, type PlaywrightCookie,
} from './cookie-import-browser';
import { BrowseError, usage, needsUser } from './errors';
import { openPicker } from './cookie-picker-routes';

function takeFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      const v = args[i + 1];
      if (!v || v.startsWith('--')) throw usage(`${name} needs a value`);
      values.push(v);
      args.splice(i, 2);
      i--;
    }
  }
  return values;
}

function takeBool(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

const describe = (s: CookieSource) => `${s.browserName} profile "${s.profile}"${s.profileLabel !== s.profile ? ` (${s.profileLabel})` : ''}`;

export async function handleCookiesCommand(argsIn: string[], bm: BrowserManager): Promise<string> {
  const args = [...argsIn];
  const sub = args[0] && !args[0].startsWith('--') ? args.shift()! : 'list';

  switch (sub) {
    case 'list': {
      const domains = takeFlag(args, '--domain').map(normalizeDomain);
      const showValues = takeBool(args, '--values');
      if (args.length) throw usage(`Unknown argument: ${args[0]}`, 'Usage: cookies [--domain d] [--values]');
      let cookies = await bm.getContext().cookies();
      if (domains.length) cookies = cookies.filter(c => domains.some(d => c.domain.replace(/^\./, '') === d || c.domain.endsWith(`.${d}`)));
      if (cookies.length === 0) return '(no cookies)';
      return JSON.stringify(cookies.map(c => ({ ...c, value: showValues ? c.value : `[${c.value.length} chars]` })), null, 2);
    }

    case 'sources': {
      const browserId = args[0] ? resolveBrowserId(args[0]) : undefined;
      const sources = listSources(browserId);
      const lines = sources.map(s => `${s.browser.padEnd(9)} --profile "${s.profile}"${s.profileLabel !== s.profile ? `  (${s.profileLabel})` : ''}`);
      for (const b of blockedSources()) lines.push(`blocked   ${b}: ${BLOCKED_HINT}`);
      if (lines.length === 0) {
        return `No cookie sources found. Supported: ${SUPPORTED_BROWSERS.join(', ')} (Chromium browsers on macOS; Firefox everywhere).`;
      }
      return lines.join('\n');
    }

    case 'import':
      return importCommand(args, bm);

    case 'clear': {
      const domains = takeFlag(args, '--domain').map(normalizeDomain);
      const ctx = bm.getContext();
      if (domains.length === 0) {
        await ctx.clearCookies();
        return 'Cleared all cookies';
      }
      for (const d of domains) {
        await ctx.clearCookies({ domain: d });
        await ctx.clearCookies({ domain: `.${d}` });
        await ctx.clearCookies({ domain: new RegExp(`(^|\\.)${d.replace(/\./g, '\\.')}$`) });
      }
      return `Cleared cookies for ${domains.join(', ')}`;
    }

    case 'picker':
      return openPicker(bm);

    default:
      throw usage(`Unknown cookies subcommand '${sub}'`, 'Use: cookies [list] | sources | import | clear | picker');
  }
}

async function importCommand(args: string[], bm: BrowserManager): Promise<string> {
  const domains = takeFlag(args, '--domain').map(normalizeDomain);
  const profile = takeFlag(args, '--profile')[0];
  const verify = takeFlag(args, '--verify-auth')[0];
  const browserArg = args[0] && !args[0].startsWith('--') ? args.shift() : undefined;
  if (args.length) throw usage(`Unknown argument: ${args[0]}`);
  if (domains.length === 0) {
    throw usage('cookies import needs --domain.', 'Example: cookies import chrome --domain github.com  (run "cookies sources" to list browsers)');
  }

  const browserId = browserArg ? resolveBrowserId(browserArg) : undefined;
  let sources = listSources(browserId);
  if (sources.length === 0 && blockedSources().length > 0) {
    throw needsUser(`Cannot read ${blockedSources().join(', ')}.`, BLOCKED_HINT);
  }
  if (sources.length === 0) {
    throw new BrowseError(
      browserId ? `No ${browserId} profiles with a cookie database were found.` : 'No supported browsers with cookie databases were found.',
      'failed',
      "Run 'cookies sources' to see what was detected, or sign in once with 'handoff'.",
    );
  }
  if (profile) {
    const match = sources.filter(s => s.profile === profile || s.profileLabel.replace(/ \(default\)$/, '') === profile);
    if (match.length === 0) {
      throw usage(`No profile '${profile}'.`, `Available: ${sources.map(s => `${s.browser} "${s.profile}"`).join(', ')}`);
    }
    sources = match;
  }

  const counted: Array<{ src: CookieSource; total: number }> = [];
  const unreadable: string[] = [];
  for (const src of sources) {
    try {
      const counts = countCookies(src, domains);
      counted.push({ src, total: Object.values(counts).reduce((a, b) => a + b, 0) });
    } catch (err: any) {
      if (sources.length === 1) throw err;
      unreadable.push(`${describe(src)}: ${err.message}`);
    }
  }
  const withCookies = counted.filter(c => c.total > 0);
  if (withCookies.length === 0) {
    const checked = counted.map(c => describe(c.src)).join(', ') || 'none readable';
    throw new BrowseError(
      `No cookies for ${domains.join(', ')} in ${checked}.${unreadable.length ? ` Unreadable: ${unreadable.join('; ')}` : ''}`,
      'failed',
      "The user is probably not signed in there. Sign in in that browser first, or sign in here with 'handoff' (the profile keeps the session).",
    );
  }
  if (withCookies.length > 1) {
    throw usage(
      `Several profiles have cookies for ${domains.join(', ')}; choose one.`,
      withCookies.map(c => `cookies import ${c.src.browser} --profile "${c.src.profile}" --domain ${domains[0]}   # ${c.total} cookies${c.src.profileLabel !== c.src.profile ? `, ${c.src.profileLabel}` : ''}`).join('\n'),
    );
  }

  const { src } = withCookies[0];
  const result = await importFromSource(src, domains);
  const failures = { ...result.failures };
  const applied = await addCookies(bm, result.cookies, failures);

  const lines: string[] = [];
  const hosts = Object.entries(result.domainCounts).map(([h, n]) => `${h}=${n}`).join(', ');
  lines.push(`Imported ${applied} cookie(s) for ${domains.join(', ')} from ${describe(src)}${hosts ? ` [${hosts}]` : ''}`);
  if (Object.keys(failures).length) {
    lines.push(`Failures: ${Object.entries(failures).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  lines.push(bm.cfg.profileDir
    ? `Saved in profile ${bm.cfg.profileDir}`
    : 'Ephemeral session: these cookies are lost when the browser stops.');

  if (applied === 0) {
    throw new BrowseError(lines.join('\n'), 'failed',
      failures.unsupported_encryption ? "These cookies use encryption this tool cannot read. Sign in with 'handoff' instead." : undefined);
  }

  if (!verify) {
    lines.push('Auth: not checked (cookies alone do not prove sign-in; add --verify-auth <selector>[=<text>])');
    return lines.join('\n');
  }
  const ok = await verifyAuth(bm, domains[0], verify);
  lines.push(ok.verified ? `Auth: verified (${ok.detail})` : `Auth: NOT verified (${ok.detail})`);
  if (!ok.verified) throw new BrowseError(lines.join('\n'), 'failed', 'Sign-in did not carry over. Try another profile, or sign in with handoff.');
  return lines.join('\n');
}

async function addCookies(bm: BrowserManager, cookies: PlaywrightCookie[], failures: Record<string, number>): Promise<number> {
  if (cookies.length === 0) return 0;
  const ctx = bm.getContext();
  try {
    await ctx.addCookies(cookies);
    return cookies.length;
  } catch {
    let ok = 0;
    for (const c of cookies) {
      try { await ctx.addCookies([c]); ok++; } catch { failures.rejected_by_browser = (failures.rejected_by_browser || 0) + 1; }
    }
    return ok;
  }
}

/** Index of the `=` separating selector from expected text, ignoring `=` inside [...] or quotes. */
export function textSeparator(spec: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === '=' && depth === 0) return i;
  }
  return -1;
}

async function verifyAuth(bm: BrowserManager, domain: string, spec: string): Promise<{ verified: boolean; detail: string }> {
  const eq = textSeparator(spec);
  const selector = eq > 0 ? spec.slice(0, eq) : spec;
  const expected = eq > 0 ? spec.slice(eq + 1).trim() : null;
  const page = bm.getPage();
  let host = '';
  try { host = new URL(page.url()).hostname; } catch {}
  if (host === domain || host.endsWith(`.${domain}`)) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  } else {
    await page.goto(`https://${domain}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  const loc = page.locator(selector).first();
  const visible = await loc.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  if (!visible) return { verified: false, detail: `${selector} not visible at ${page.url()}` };
  if (expected === null) return { verified: true, detail: `${selector} visible at ${page.url()}` };
  const text = (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  return text.includes(expected)
    ? { verified: true, detail: `${selector} shows the expected text` }
    : { verified: false, detail: `${selector} is visible but does not show the expected text` };
}
