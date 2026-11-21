/**
 * browse server — persistent Chromium daemon, one per project.
 *
 *   Bun.serve on 127.0.0.1 (random port) → commands → Playwright
 *   Auth: bearer token from the 0600 state file
 *   Config: BROWSE_CONFIG (paths) + BROWSE_LAUNCH (headed/profile/proxy), from the CLI
 *   Idle shutdown after BROWSE_IDLE_TIMEOUT ms (default 30 min; never during a handoff)
 *
 * Responses: 200 text on success; on error JSON {error, hint?, code} with
 * code usage (400) | needs_user (409) | failed (500).
 */

import { BrowserManager } from './browser-manager';
import { runOne } from './meta-commands';
import { handleCookiePickerRoute } from './cookie-picker-routes';
import { generateHelpText } from './commands';
import { SNAPSHOT_FLAGS } from './snapshot';
import { resolveConfig, ensureStateDir, type LaunchConfig } from './config';
import { BrowseError } from './errors';
import { requestContext } from './request-context';
import { stopDisplay } from './launch';
import { consoleBuffer, networkBuffer, dialogBuffer } from './buffers';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const config = resolveConfig();
ensureStateDir(config);

const launch: LaunchConfig = process.env.BROWSE_LAUNCH
  ? JSON.parse(process.env.BROWSE_LAUNCH)
  : { headed: false, profileDir: null, proxy: null, proxyBypass: null };

const AUTH_TOKEN = crypto.randomUUID();
const BROWSE_PORT = parseInt(process.env.BROWSE_PORT || '0', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.BROWSE_IDLE_TIMEOUT || '1800000', 10);
const SERVER_VERSION = '3';

// ─── Log flushing ──────────────────────────────────────────────
let lastConsoleFlushed = 0;
let lastNetworkFlushed = 0;
let lastDialogFlushed = 0;

function flushBuffers(): void {
  try {
    const nc = consoleBuffer.totalAdded - lastConsoleFlushed;
    if (nc > 0) {
      const lines = consoleBuffer.last(Math.min(nc, consoleBuffer.length))
        .map(e => `[${new Date(e.timestamp).toISOString()}] [${e.level}] ${e.text}`).join('\n') + '\n';
      fs.appendFileSync(config.consoleLog, lines);
      lastConsoleFlushed = consoleBuffer.totalAdded;
    }
    const nn = networkBuffer.totalAdded - lastNetworkFlushed;
    if (nn > 0) {
      const lines = networkBuffer.last(Math.min(nn, networkBuffer.length))
        .map(e => `[${new Date(e.timestamp).toISOString()}] ${e.method} ${e.url} → ${e.status || 'pending'} (${e.duration ?? '?'}ms, ${e.size ?? '?'}B)`).join('\n') + '\n';
      fs.appendFileSync(config.networkLog, lines);
      lastNetworkFlushed = networkBuffer.totalAdded;
    }
    const nd = dialogBuffer.totalAdded - lastDialogFlushed;
    if (nd > 0) {
      const lines = dialogBuffer.last(Math.min(nd, dialogBuffer.length))
        .map(e => `[${new Date(e.timestamp).toISOString()}] [${e.type}] "${e.message}" → ${e.action}${e.response ? ` "${e.response}"` : ''}`).join('\n') + '\n';
      fs.appendFileSync(config.dialogLog, lines);
      lastDialogFlushed = dialogBuffer.totalAdded;
    }
  } catch {
    // Non-fatal: buffers stay in memory.
  }
}
const flushInterval = setInterval(flushBuffers, 1000);

// ─── Idle timer ────────────────────────────────────────────────
let lastActivity = Date.now();
let inFlight = 0;
const idleCheckInterval = setInterval(() => {
  if (inFlight === 0 && !browserManager.isHandoffActive() && Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    console.log(`[browse] Idle for ${IDLE_TIMEOUT_MS / 1000}s, shutting down`);
    shutdown();
  }
}, 60_000);

// ─── Server ────────────────────────────────────────────────────
const browserManager = new BrowserManager(launch);
browserManager.importManifest = path.join(config.stateDir, 'copied-cookies.json');
let isShuttingDown = false;

async function findPort(): Promise<number> {
  if (BROWSE_PORT) return BROWSE_PORT;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 10000 + Math.floor(Math.random() * 50000);
    try {
      const probe = Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('ok') });
      probe.stop(true);
      return port;
    } catch {}
  }
  throw new Error('[browse] No free port after 5 attempts');
}

function toBrowseError(err: any): BrowseError {
  if (err instanceof BrowseError) return err;
  const msg = String(err?.message || err);
  const first = msg.split('\n')[0];
  if (err?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(msg)) {
    if (/page\.goto|navigat/i.test(msg)) return new BrowseError('Page navigation timed out after 15s.', 'failed', 'The URL may be unreachable or slow; check it, or wait --load.');
    return new BrowseError(`Operation timed out: ${first}`);
  }
  if (/net::ERR_/.test(msg)) return new BrowseError(first.replace(/^.*?(net::ERR_\w+)/, 'Network error $1'), 'failed');
  if (/Unexpected token|while parsing (css )?selector|is not a valid selector/i.test(msg)) {
    return new BrowseError(`Invalid selector: ${first}`, 'usage');
  }
  return new BrowseError(first);
}

const STATUS_FOR = { usage: 400, needs_user: 409, failed: 500 } as const;

async function handleCommand(body: any): Promise<Response> {
  const { command, args = [], cwd, session, timeoutMs } = body ?? {};
  if (!command || !Array.isArray(args)) {
    return Response.json({ error: 'Body needs "command" and an "args" array', code: 'usage' }, { status: 400 });
  }
  if (command === 'help') {
    return new Response(generateHelpText(SNAPSHOT_FLAGS), { headers: { 'Content-Type': 'text/plain' } });
  }
  inFlight++;
  try {
    const ctx = { cwd: typeof cwd === 'string' ? cwd : process.cwd(), session: session || undefined, timeoutMs: timeoutMs || undefined };
    const result = await requestContext.run(ctx, async () => {
      if (ctx.session) await browserManager.ensureSessionTab(ctx.session);
      return runOne(command, args.map(String), browserManager, config, shutdown);
    });
    browserManager.resetFailures();
    return new Response(result, { headers: { 'Content-Type': 'text/plain' } });
  } catch (err: any) {
    const e = toBrowseError(err);
    if (e.code === 'failed') browserManager.incrementFailures();
    const hint = [e.hint, e.code === 'failed' ? browserManager.getFailureHint() : null].filter(Boolean).join('\n') || undefined;
    return Response.json({ error: e.message, hint, code: e.code }, { status: STATUS_FOR[e.code] });
  } finally {
    inFlight--;
    lastActivity = Date.now();
  }
}

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[browse] Shutting down...');
  clearInterval(flushInterval);
  clearInterval(idleCheckInterval);
  flushBuffers();
  await browserManager.close();
  stopDisplay();
  try {
    const state = JSON.parse(fs.readFileSync(config.stateFile, 'utf-8'));
    if (state.pid === process.pid) fs.unlinkSync(config.stateFile);
  } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function start(): Promise<void> {
  for (const f of [config.consoleLog, config.networkLog, config.dialogLog]) {
    try { fs.unlinkSync(f); } catch {}
  }
  const port = await findPort();
  await browserManager.launch();
  const startTime = Date.now();

  Bun.serve({
    port,
    hostname: '127.0.0.1',
    idleTimeout: 0, // handoff --until and long waits hold the request open
    fetch: async (req) => {
      lastActivity = Date.now();
      const url = new URL(req.url);
      if (url.pathname.startsWith('/cookie-picker')) return handleCookiePickerRoute(url, req, browserManager);
      if (url.pathname === '/health') {
        const healthy = await browserManager.isHealthy();
        return Response.json({
          status: healthy ? 'healthy' : 'unhealthy',
          uptime: Math.floor((Date.now() - startTime) / 1000),
          mode: browserManager.getMode(),
          handoff: browserManager.isHandoffActive(),
          tabs: browserManager.getTabCount(),
        });
      }
      if (req.headers.get('authorization') !== `Bearer ${AUTH_TOKEN}`) {
        return Response.json({ error: 'Unauthorized', code: 'usage' }, { status: 401 });
      }
      if (url.pathname === '/command' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        return handleCommand(body);
      }
      return new Response('Not found', { status: 404 });
    },
  });

  const state = {
    pid: process.pid,
    port,
    token: AUTH_TOKEN,
    startedAt: new Date().toISOString(),
    serverVersion: SERVER_VERSION,
    serverPath: path.resolve(import.meta.dir, 'server.ts'),
    launch,
  };
  const tmp = `${config.stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, config.stateFile);

  browserManager.serverPort = port;
  console.log(`[browse] Server on http://127.0.0.1:${port} (PID ${process.pid}), state ${config.stateFile}`);
}

start().catch((err) => {
  const e = err instanceof BrowseError ? err : null;
  // Report launch failures through a file the CLI reads, then exit.
  try {
    fs.writeFileSync(`${config.stateFile}.error`, JSON.stringify({ error: e?.message ?? String(err?.message || err), hint: e?.hint, code: e?.code ?? 'failed' }), { mode: 0o600 });
  } catch {}
  console.error(`[browse] Failed to start: ${err?.message || err}`);
  process.exit(1);
});
