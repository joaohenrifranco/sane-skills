/**
 * Shared config for the browse CLI and server.
 *
 * Nothing is written inside the user's repository. Everything lives under a
 * per-user cache root:
 *
 *   <home>/projects/<slug>/browse.json      server state (port, token, pid)
 *   <home>/projects/<slug>/*.log            console/network/dialog logs
 *   <home>/projects/<slug>/states/*.json    named `state save` snapshots
 *   <home>/profiles/<slug>/                 persistent Chromium profile
 *
 * <home>  = BROWSE_HOME, else $XDG_CACHE_HOME/sane-browse, else ~/.cache/sane-browse
 * <slug>  = <basename of project root>-<8 hex of its absolute path>
 * project = git root of the CLI's cwd, else the cwd itself
 *
 * The CLI resolves the config and hands it to the server through
 * BROWSE_CONFIG (JSON), so both sides agree on every path.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

export interface LaunchConfig {
  /** Start with a visible window. */
  headed: boolean;
  /** Absolute profile directory, or null for an in-memory (ephemeral) context. */
  profileDir: string | null;
  /** Proxy URL handed to Chromium, or null for a direct connection. */
  proxy: string | null;
  /** Comma-separated hosts that bypass the proxy (from NO_PROXY). */
  proxyBypass: string | null;
}

export interface BrowseConfig {
  home: string;
  projectDir: string;
  slug: string;
  stateDir: string;
  stateFile: string;
  statesDir: string;
  consoleLog: string;
  networkLog: string;
  dialogLog: string;
  /** Default directory for screenshots, PDFs and downloads. */
  outputDir: string;
}

export function getGitRoot(cwd: string = process.cwd()): string | null {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      cwd, stdout: 'pipe', stderr: 'pipe', timeout: 2_000,
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

export function browseHome(env: Record<string, string | undefined> = process.env): string {
  if (env.BROWSE_HOME) return path.resolve(env.BROWSE_HOME);
  const xdg = env.XDG_CACHE_HOME;
  return path.join(xdg ? path.resolve(xdg) : path.join(os.homedir(), '.cache'), 'sane-browse');
}

export function projectSlug(projectDir: string): string {
  const base = path.basename(projectDir).replace(/[^A-Za-z0-9._-]/g, '_') || 'root';
  const hash = crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

/** Real path of the system temp dir (macOS: /tmp → /private/tmp, $TMPDIR → /private/var/...). */
export function realTempDir(): string {
  try { return fs.realpathSync(os.tmpdir()); } catch { return os.tmpdir(); }
}

export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): BrowseConfig {
  if (env.BROWSE_CONFIG) {
    return JSON.parse(env.BROWSE_CONFIG) as BrowseConfig;
  }
  const home = browseHome(env);
  const projectDir = getGitRoot(cwd) || cwd;
  const slug = projectSlug(projectDir);
  const stateDir = path.join(home, 'projects', slug);
  return {
    home,
    projectDir,
    slug,
    stateDir,
    stateFile: path.join(stateDir, 'browse.json'),
    statesDir: path.join(stateDir, 'states'),
    consoleLog: path.join(stateDir, 'browse-console.log'),
    networkLog: path.join(stateDir, 'browse-network.log'),
    dialogLog: path.join(stateDir, 'browse-dialog.log'),
    outputDir: path.join(realTempDir(), 'sane-browse', slug),
  };
}

export function ensureStateDir(config: BrowseConfig): void {
  try {
    fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(config.statesDir, { recursive: true, mode: 0o700 });
  } catch (err: any) {
    if (err.code === 'EACCES') {
      throw new Error(`Cannot create state directory ${config.stateDir}: permission denied. Set BROWSE_HOME to a writable directory.`);
    }
    throw err;
  }
}

const PROFILE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Resolve the profile directory for a run.
 *   ephemeral → null
 *   name      → <home>/profiles/<name>
 *   path      → that absolute path (anything containing a separator)
 *   default   → <home>/profiles/<project slug>
 */
export function resolveProfileDir(config: BrowseConfig, profile: string | undefined, ephemeral: boolean): string | null {
  if (ephemeral) return null;
  if (!profile) return path.join(config.home, 'profiles', config.slug);
  if (profile.includes('/') || profile.includes('\\')) return path.resolve(profile);
  if (!PROFILE_NAME.test(profile)) {
    throw new Error(`Invalid profile name '${profile}'. Use letters, digits, '.', '_' or '-', or an absolute path.`);
  }
  return path.join(config.home, 'profiles', profile);
}

/**
 * Proxy resolution, first match wins:
 *   --proxy, BROWSE_PROXY_URL ('direct' disables the env fallbacks),
 *   HTTPS_PROXY/https_proxy, HTTP_PROXY/http_proxy, ALL_PROXY/all_proxy.
 */
export function resolveProxy(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): { proxy: string | null; bypass: string | null } {
  const bypass = env.NO_PROXY || env.no_proxy || null;
  const pick = flag
    ?? env.BROWSE_PROXY_URL
    ?? env.HTTPS_PROXY ?? env.https_proxy
    ?? env.HTTP_PROXY ?? env.http_proxy
    ?? env.ALL_PROXY ?? env.all_proxy;
  if (!pick || pick === 'direct') return { proxy: null, bypass: null };
  return { proxy: pick, bypass };
}

export function describeLaunch(cfg: LaunchConfig): string {
  const parts = [cfg.headed ? 'headed' : 'headless'];
  parts.push(cfg.profileDir ? `profile ${cfg.profileDir}` : 'ephemeral');
  if (cfg.proxy) parts.push(`proxy ${redactProxy(cfg.proxy)}`);
  return parts.join(', ');
}

export function redactProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) { u.username = '***'; u.password = ''; }
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function sameLaunch(a: LaunchConfig, b: LaunchConfig): boolean {
  return a.headed === b.headed && a.profileDir === b.profileDir
    && a.proxy === b.proxy && a.proxyBypass === b.proxyBypass;
}
