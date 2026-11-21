/**
 * Cookie picker: an interactive page, opened in the user's own browser, for
 * choosing which domains to copy into the browse session.
 *
 * Access control (the picker can decrypt real cookies, so it is not open):
 *   - `cookies picker` mints a one-use link token, valid for 5 minutes.
 *   - GET /cookie-picker?t=<link token> consumes it and embeds a session
 *     token (valid 30 minutes) in the page.
 *   - Every API call must send X-Picker-Token: <session token>, and any
 *     request carrying a foreign Origin header is rejected.
 *
 * Routes
 *   GET  /cookie-picker?t=…          picker HTML
 *   GET  /cookie-picker/browsers     detected sources ("Chrome · Work", "Firefox · default-release")
 *   GET  /cookie-picker/domains      hosts + counts for one source
 *   POST /cookie-picker/import       copy cookies for domains into the session
 *   POST /cookie-picker/remove       clear those domains from the session
 *   GET  /cookie-picker/imported     domains imported through the picker
 */

import * as crypto from 'crypto';
import type { BrowserManager } from './browser-manager';
import { listSources, listDomains, importFromSource, normalizeDomain, type CookieSource } from './cookie-import-browser';
import { getCookiePickerHTML } from './cookie-picker-ui';
import { BrowseError } from './errors';

const importedCounts = new Map<string, number>();
let linkToken: { value: string; expires: number } | null = null;
let sessionToken: { value: string; expires: number } | null = null;

const LINK_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;

function sourceLabels(): Map<string, CookieSource> {
  const sources = listSources();
  const map = new Map<string, CookieSource>();
  for (const s of sources) {
    let label = `${s.browserName} · ${s.profileLabel}`;
    if (map.has(label)) label = `${label} [${s.profile}]`;
    map.set(label, s);
  }
  return map;
}

export function openPicker(bm: BrowserManager): string {
  const port = bm.serverPort;
  if (!port) throw new BrowseError('Server port not available');
  if (listSources().length === 0) throw new BrowseError('No supported browsers with cookie databases were found.');
  linkToken = { value: crypto.randomBytes(24).toString('hex'), expires: Date.now() + LINK_TTL_MS };
  const url = `http://127.0.0.1:${port}/cookie-picker?t=${linkToken.value}`;
  const opener = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try { Bun.spawn(opener, { stdout: 'ignore', stderr: 'ignore' }); } catch {}
  return [
    `Cookie picker opened in the user's browser (link valid for 5 minutes, one use):`,
    url,
    'Ask the user to pick domains there, then continue.',
  ].join('\n');
}

function json(data: unknown, port: number, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': `http://127.0.0.1:${port}` },
  });
}

function fail(message: string, code: string, port: number, status = 400): Response {
  return json({ error: message, code }, port, status);
}

export async function handleCookiePickerRoute(url: URL, req: Request, bm: BrowserManager): Promise<Response> {
  const port = parseInt(url.port, 10) || bm.serverPort;
  const origin = req.headers.get('origin');
  if (origin && origin !== `http://127.0.0.1:${port}`) return fail('Forbidden origin', 'forbidden', port, 403);

  try {
    if (url.pathname === '/cookie-picker' && req.method === 'GET') {
      const t = url.searchParams.get('t');
      if (!linkToken || t !== linkToken.value || Date.now() > linkToken.expires) {
        return new Response("This picker link is invalid or expired. Run 'browse cookies picker' again.", { status: 403 });
      }
      linkToken = null;
      sessionToken = { value: crypto.randomBytes(24).toString('hex'), expires: Date.now() + SESSION_TTL_MS };
      return new Response(getCookiePickerHTML(port, sessionToken.value), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      });
    }

    const token = req.headers.get('x-picker-token');
    if (!sessionToken || token !== sessionToken.value || Date.now() > sessionToken.expires) {
      return fail('Picker session missing or expired', 'unauthorized', port, 401);
    }

    if (url.pathname === '/cookie-picker/browsers' && req.method === 'GET') {
      return json({ browsers: [...sourceLabels().keys()].map(name => ({ name })) }, port);
    }

    if (url.pathname === '/cookie-picker/domains' && req.method === 'GET') {
      const src = sourceLabels().get(url.searchParams.get('browser') || '');
      if (!src) return fail('Unknown source', 'missing_param', port);
      return json({ browser: src.browserName, domains: listDomains(src) }, port);
    }

    if (url.pathname === '/cookie-picker/import' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { browser?: string; domains?: string[] } | null;
      const src = body?.browser ? sourceLabels().get(body.browser) : undefined;
      if (!src || !Array.isArray(body?.domains) || body!.domains.length === 0) {
        return fail("Body needs 'browser' and a non-empty 'domains' array", 'bad_request', port);
      }
      const domains = body!.domains.map(normalizeDomain);
      const result = await importFromSource(src, domains);
      if (result.cookies.length > 0) {
        await bm.getContext().addCookies(result.cookies);
        if (bm.cfg.profileDir) await bm.trackImported(result.cookies);
      }
      for (const [d, n] of Object.entries(result.domainCounts)) importedCounts.set(d, (importedCounts.get(d) || 0) + n);
      const failed = Object.values(result.failures).reduce((a, b) => a + b, 0);
      return json({
        imported: result.cookies.length, failed, domainCounts: result.domainCounts,
        ...(result.cookies.length === 0 ? { message: failed ? `All ${failed} cookies failed to decrypt` : 'No cookies found for that domain' } : {}),
      }, port);
    }

    if (url.pathname === '/cookie-picker/remove' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { domains?: string[] } | null;
      if (!Array.isArray(body?.domains) || body!.domains.length === 0) return fail("Missing 'domains'", 'bad_request', port);
      for (const d of body!.domains) {
        await bm.getContext().clearCookies({ domain: d });
        importedCounts.delete(d);
      }
      return json({ removed: body!.domains.length, domains: body!.domains }, port);
    }

    if (url.pathname === '/cookie-picker/imported' && req.method === 'GET') {
      const domains = [...importedCounts.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count);
      return json({ domains, totalDomains: domains.length, totalCookies: domains.reduce((s, e) => s + e.count, 0) }, port);
    }

    return new Response('Not found', { status: 404 });
  } catch (err: any) {
    return fail(err?.message || 'Internal error', err instanceof BrowseError ? err.code : 'internal_error', port, err instanceof BrowseError ? 400 : 500);
  }
}
