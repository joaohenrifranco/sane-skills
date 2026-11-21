/**
 * browse CLI — thin client for the per-project browser server.
 *
 *   browse [global options] <command> [args]
 *
 * Flow: resolve config + launch options → reuse the running server if its
 * launch options match (or none were requested explicitly) → otherwise start
 * one → POST the command → print the result, exit with the error's code.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  resolveConfig, ensureStateDir, resolveProfileDir, resolveProxy, describeLaunch,
  type LaunchConfig, type BrowseConfig,
} from './config';
import { generateHelpText, LOCAL_COMMANDS } from './commands';
import { SNAPSHOT_FLAGS } from './snapshot';
import { EXIT_CODES, type ErrorCode } from './errors';

const MAX_START_WAIT = process.platform === 'win32' ? 20000 : 15000;
const DEFAULT_REQUEST_TIMEOUT = 90_000; // covers a 60s Keychain wait
const SERVER_VERSION = '3';

interface ServerState {
  pid: number;
  port: number;
  token: string;
  serverVersion?: string;
  launch?: LaunchConfig;
}

export interface GlobalOptions {
  headed?: boolean;
  profile?: string;
  ephemeral?: boolean;
  proxy?: string;
  session?: string;
  timeoutMs?: number;
  json: boolean;
  /** Launch fields set by a flag or env var; only these are checked against a running browser. */
  explicit: { headed: boolean; profile: boolean; proxy: boolean };
}

const truthy = (v: string | undefined) => !!v && !['0', 'false', 'no', 'off', ''].includes(v.toLowerCase());

export function parseGlobalOptions(argv: string[], env = process.env): { opts: GlobalOptions; rest: string[] } {
  const opts: GlobalOptions = { json: false, explicit: { headed: false, profile: false, proxy: false } };
  const rest = [...argv];
  while (rest.length && rest[0].startsWith('--')) {
    const flag = rest[0];
    const needValue = () => {
      const v = rest[1];
      if (v === undefined) fail('usage', `${flag} needs a value`);
      rest.splice(0, 2);
      return v!;
    };
    if (flag === '--headed') { opts.headed = true; rest.shift(); }
    else if (flag === '--headless') { opts.headed = false; rest.shift(); }
    else if (flag === '--ephemeral') { opts.ephemeral = true; rest.shift(); }
    else if (flag === '--json') { opts.json = true; rest.shift(); }
    else if (flag === '--profile') opts.profile = needValue();
    else if (flag === '--proxy') opts.proxy = needValue();
    else if (flag === '--session') opts.session = needValue();
    else if (flag === '--timeout') {
      const v = Number(needValue());
      if (!Number.isFinite(v) || v <= 0) fail('usage', '--timeout needs a positive number of milliseconds');
      opts.timeoutMs = v;
    }
    else if (flag === '--help') { rest.splice(0, 1, 'help'); break; }
    else break; // a command flag such as --version is not ours
  }
  if (opts.headed === undefined && env.BROWSE_HEADED !== undefined) opts.headed = truthy(env.BROWSE_HEADED);
  if (opts.ephemeral === undefined && env.BROWSE_EPHEMERAL !== undefined) opts.ephemeral = truthy(env.BROWSE_EPHEMERAL);
  if (opts.profile === undefined && env.BROWSE_PROFILE) opts.profile = env.BROWSE_PROFILE;
  if (opts.session === undefined && env.BROWSE_SESSION) opts.session = env.BROWSE_SESSION;
  if (opts.profile && opts.ephemeral) fail('usage', 'Use --profile or --ephemeral, not both');
  opts.explicit = {
    headed: opts.headed !== undefined,
    profile: opts.ephemeral !== undefined || opts.profile !== undefined,
    proxy: opts.proxy !== undefined || env.BROWSE_PROXY_URL !== undefined,
  };
  return { opts, rest };
}

export function launchFrom(opts: GlobalOptions, config: BrowseConfig, env = process.env): LaunchConfig {
  const { proxy, bypass } = resolveProxy(opts.proxy, env);
  return {
    headed: !!opts.headed,
    profileDir: resolveProfileDir(config, opts.profile, !!opts.ephemeral),
    proxy,
    proxyBypass: bypass,
  };
}

let jsonMode = false;

function fail(code: ErrorCode, message: string, hint?: string): never {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, code, error: message, ...(hint ? { hint } : {}) }));
  } else {
    console.error(message);
    if (hint) console.error(hint);
  }
  process.exit(EXIT_CODES[code]);
}

// ─── Server lifecycle ──────────────────────────────────────────

function readState(config: BrowseConfig): ServerState | null {
  try { return JSON.parse(fs.readFileSync(config.stateFile, 'utf-8')); } catch { return null; }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 'healthy' | 'unhealthy' when /health answers, 'down' when it does not. */
async function health(state: ServerState): Promise<'healthy' | 'unhealthy' | 'down'> {
  try {
    const r = await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return 'down';
    return (await r.json() as any).status === 'healthy' ? 'healthy' : 'unhealthy';
  } catch {
    return 'down';
  }
}
const healthy = async (state: ServerState) => (await health(state)) !== 'down';

async function killServer(pid: number): Promise<void> {
  if (!isAlive(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline && isAlive(pid)) await Bun.sleep(100);
  if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

function serverScript(): string {
  if (process.env.BROWSE_SERVER_SCRIPT) return process.env.BROWSE_SERVER_SCRIPT;
  const direct = path.resolve(import.meta.dir, 'server.ts');
  if (fs.existsSync(direct)) return direct;
  fail('failed', 'Cannot find server.ts next to the CLI. Set BROWSE_SERVER_SCRIPT or run from the browse source tree.');
}

async function startServer(config: BrowseConfig, launch: LaunchConfig): Promise<ServerState> {
  ensureStateDir(config);
  try { fs.unlinkSync(config.stateFile); } catch {}
  const errFile = `${config.stateFile}.error`;
  try { fs.unlinkSync(errFile); } catch {}
  const logFd = fs.openSync(path.join(config.stateDir, 'server.log'), 'a', 0o600);
  const proc = Bun.spawn(['bun', 'run', serverScript()], {
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, BROWSE_CONFIG: JSON.stringify(config), BROWSE_LAUNCH: JSON.stringify(launch) },
  });
  proc.unref();
  fs.closeSync(logFd);

  const start = Date.now();
  while (Date.now() - start < MAX_START_WAIT) {
    const state = readState(config);
    if (state && isAlive(state.pid)) return state;
    if (fs.existsSync(errFile)) {
      const e = JSON.parse(fs.readFileSync(errFile, 'utf-8'));
      fail(e.code || 'failed', `Browser failed to start: ${e.error}`, e.hint);
    }
    if (proc.exitCode !== null) break;
    await Bun.sleep(100);
  }
  fail('failed', `Browser server did not start within ${MAX_START_WAIT / 1000}s.`, `See ${path.join(config.stateDir, 'server.log')}`);
}

function acquireLock(config: BrowseConfig): (() => void) | null {
  const lockPath = `${config.stateFile}.lock`;
  try {
    const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    return () => { try { fs.unlinkSync(lockPath); } catch {} };
  } catch {
    try {
      const holder = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
      if (holder && isAlive(holder)) return null;
      fs.unlinkSync(lockPath);
      return acquireLock(config);
    } catch {
      return null;
    }
  }
}

function conflicts(running: LaunchConfig, wanted: LaunchConfig, explicit: GlobalOptions['explicit']): boolean {
  return (explicit.headed && running.headed !== wanted.headed)
    || (explicit.profile && running.profileDir !== wanted.profileDir)
    || (explicit.proxy && (running.proxy !== wanted.proxy || running.proxyBypass !== wanted.proxyBypass));
}

async function ensureServer(config: BrowseConfig, launch: LaunchConfig, explicit: GlobalOptions['explicit']): Promise<ServerState> {
  const state = readState(config);
  if (state && isAlive(state.pid)) {
    if (state.serverVersion !== SERVER_VERSION) {
      console.error('[browse] Browser server is from another version; restarting it...');
      await killServer(state.pid);
    } else if (state.launch && conflicts(state.launch, launch, explicit)) {
      fail('usage',
        `The running browser uses: ${describeLaunch(state.launch)}\nThis call asks for: ${describeLaunch(launch)}`,
        "Run 'browse stop' first, or drop the conflicting options. (The running browser keeps its tabs and cookies until stopped.)");
    } else {
      // Never kill a live server on our own: it may hold a handoff or tabs.
      if (await healthy(state)) return state;
      fail('failed', `The browser server (pid ${state.pid}) is running but not responding.`,
        "Run 'browse stop' to end it (tabs are lost; the profile keeps cookies), then retry.");
    }
  }

  ensureStateDir(config);
  const release = acquireLock(config);
  if (!release) {
    const start = Date.now();
    while (Date.now() - start < MAX_START_WAIT) {
      const fresh = readState(config);
      if (fresh && isAlive(fresh.pid) && await healthy(fresh)) return fresh;
      await Bun.sleep(200);
    }
    fail('failed', 'Timed out waiting for another browse call to start the browser.');
  }
  try {
    const fresh = readState(config);
    if (fresh && isAlive(fresh.pid) && await healthy(fresh)) return fresh;
    if (fresh?.pid) await killServer(fresh.pid);
    else if (state?.pid) await killServer(state.pid);
    console.error(`[browse] Starting browser (${describeLaunch(launch)})...`);
    return await startServer(config, launch);
  } finally {
    release();
  }
}

// ─── Command dispatch ──────────────────────────────────────────

function requestTimeout(command: string, args: string[], opts: GlobalOptions): number {
  if (opts.timeoutMs) return opts.timeoutMs + 15_000;
  if (command === 'handoff' && args.includes('--until')) return 600_000 + 15_000;
  if (command === 'wait' && args[1] && /^\d+$/.test(args[1])) return parseInt(args[1], 10) + 15_000;
  return DEFAULT_REQUEST_TIMEOUT;
}

async function sendCommand(state: ServerState, command: string, args: string[], opts: GlobalOptions): Promise<void> {
  const timeout = requestTimeout(command, args, opts);
  let resp: Response;
  try {
    resp = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ command, args, cwd: process.cwd(), session: opts.session, timeoutMs: opts.timeoutMs }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      fail('failed', `No reply from the browser after ${Math.round(timeout / 1000)}s.`, 'Pass --timeout <ms> for long operations.');
    }
    fail('failed', `Lost connection to the browser server: ${err?.message || err}`, 'Run the command again; the server restarts automatically.');
  }

  const text = await resp.text();
  if (resp.ok) {
    if (opts.json) console.log(JSON.stringify({ ok: true, command, output: text }));
    else process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    return;
  }
  let err: { error?: string; hint?: string; code?: ErrorCode } = {};
  try { err = JSON.parse(text); } catch { err = { error: text }; }
  fail(err.code && err.code in EXIT_CODES ? err.code : 'failed', err.error || `HTTP ${resp.status}`, err.hint);
}

// ─── Local commands ────────────────────────────────────────────

async function doctor(config: BrowseConfig, launch: LaunchConfig, fix: boolean): Promise<void> {
  const lines: string[] = [];
  let ok = true;
  lines.push(`bun        ${Bun.version}`);
  let pw: typeof import('playwright') | null = null;
  try { pw = await import('playwright'); } catch {}
  if (!pw) { ok = false; lines.push('playwright MISSING (run: bun install in the browse directory)'); }
  else {
    let exe = '';
    try { exe = pw.chromium.executablePath(); } catch {}
    const has = !!exe && fs.existsSync(exe);
    if (!has && fix) {
      console.error('[browse] Installing Chromium (one time, ~150MB)...');
      const p = Bun.spawnSync(['bunx', 'playwright', 'install', 'chromium'], { cwd: path.resolve(import.meta.dir, '..'), stdout: 'inherit', stderr: 'inherit' });
      if (p.exitCode !== 0) ok = false;
    }
    const nowHas = !!exe && fs.existsSync(exe);
    if (!nowHas) ok = false;
    lines.push(`chromium   ${nowHas ? exe : 'MISSING (run: browse doctor --fix)'}`);
  }
  lines.push(`project    ${config.projectDir}`);
  lines.push(`state      ${config.stateDir}`);
  lines.push(`profile    ${launch.profileDir ?? '(ephemeral)'}`);
  lines.push(`output     ${config.outputDir}`);
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    const x = Bun.spawnSync(['sh', '-c', 'command -v Xvfb'], { stdout: 'pipe' }).exitCode === 0;
    lines.push(`display    none; headed mode ${x ? 'will use Xvfb' : 'unavailable (install xvfb)'}`);
  }
  try {
    const { listSources, blockedSources, BLOCKED_HINT } = await import('./cookie-import-browser');
    const sources = listSources();
    lines.push(`cookies    ${sources.length ? sources.map(s => `${s.browser}:"${s.profile}"`).join(', ') : 'no importable browser profiles found'}`);
    for (const b of blockedSources()) lines.push(`           blocked: ${b}. ${BLOCKED_HINT}`);
  } catch (err: any) {
    lines.push(`cookies    could not scan (${err?.message})`);
  }
  const state = readState(config);
  lines.push(`server     ${state && isAlive(state.pid) ? `running (pid ${state.pid}, ${state.launch ? describeLaunch(state.launch) : 'unknown launch'})` : 'not running'}`);
  console.log(lines.join('\n'));
  process.exit(ok ? 0 : 1);
}

// ─── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { opts, rest } = parseGlobalOptions(process.argv.slice(2));
  jsonMode = opts.json;
  const command = rest[0] ?? 'help';
  const args = rest.slice(1);
  const config = resolveConfig();
  let launch: LaunchConfig;
  try { launch = launchFrom(opts, config); } catch (err: any) { fail('usage', err.message); }

  if (command === 'help' || command === '-h') {
    console.log(generateHelpText(SNAPSHOT_FLAGS));
    return;
  }
  if (command === 'doctor') return doctor(config, launch, args.includes('--fix'));
  if (LOCAL_COMMANDS.has(command)) return;

  if (command === 'stop') {
    const state = readState(config);
    if (!state || !isAlive(state.pid)) {
      if (opts.json) console.log(JSON.stringify({ ok: true, command, output: 'No browser running' }));
      else console.log('No browser running');
      return;
    }
    // Short request; a hung server is terminated by signal instead.
    await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ command: 'stop', args: [], cwd: process.cwd() }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline && isAlive(state.pid)) await Bun.sleep(100);
    if (isAlive(state.pid)) await killServer(state.pid);
    if (opts.json) console.log(JSON.stringify({ ok: true, command, output: 'Server stopped' }));
    else console.log('Server stopped');
    return;
  }

  if (command === 'chain' && args.length === 0) args.push((await Bun.stdin.text()).trim());

  const state = await ensureServer(config, launch, opts.explicit);
  await sendCommand(state, command, args, opts);
}

if (import.meta.main) {
  main().catch((err) => fail('failed', `[browse] ${err?.message || err}`));
}
