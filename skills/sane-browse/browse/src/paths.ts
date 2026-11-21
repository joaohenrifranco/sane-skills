/**
 * File path policy for commands that read or write local files.
 *
 * Relative paths resolve against the CLI caller's cwd (sent with every
 * request), not the server's cwd. Paths must stay inside an allowed root:
 * the project, the caller's cwd, the system temp dir, or the browse home.
 * Symlinks are resolved on the nearest existing ancestor, so a link cannot
 * smuggle a write outside those roots.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { usage } from './errors';
import { realTempDir, type BrowseConfig } from './config';

function realish(p: string): string {
  // realpath of the nearest existing ancestor + the remaining tail
  let cur = path.resolve(p);
  const tail: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  let base = cur;
  try { base = fs.realpathSync(cur); } catch {}
  return path.join(base, ...tail);
}

function within(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

export function allowedRoots(config: BrowseConfig, cwd: string): string[] {
  const roots = [config.projectDir, cwd, realTempDir(), config.home];
  if (process.platform !== 'win32') roots.push('/tmp');
  return [...new Set(roots.map(realish))];
}

export function resolveUserPath(p: string, config: BrowseConfig, cwd: string): string {
  if (!p) throw usage('Missing path');
  const expanded = p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
  const abs = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  const real = realish(abs);
  const roots = allowedRoots(config, cwd);
  if (!roots.some(r => within(real, r))) {
    throw usage(`Path ${p} is outside the allowed directories`, `Use a path inside: ${roots.join(', ')}`);
  }
  return real;
}

/** Resolve an output path and create its parent directory. */
export function resolveOutputPath(p: string, config: BrowseConfig, cwd: string): string {
  const out = resolveUserPath(p, config, cwd);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  return out;
}

export function defaultOutput(config: BrowseConfig, name: string): string {
  fs.mkdirSync(config.outputDir, { recursive: true });
  return path.join(config.outputDir, name);
}

/** The installed skills directory (…/skills), so sibling skills' scripts can be read. */
const SKILLS_ROOT = realish(path.resolve(import.meta.dir, '..', '..', '..'));

/** Resolve an input path that must exist. Reads may also come from the installed skills directory. */
export function resolveInputPath(p: string, config: BrowseConfig, cwd: string): string {
  const expanded = p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
  const abs = realish(path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded));
  const real = within(abs, SKILLS_ROOT) ? abs : resolveUserPath(p, config, cwd);
  if (!fs.existsSync(real)) throw usage(`File not found: ${p}`);
  return real;
}

const OUTPUT_EXT = /\.(png|jpe?g|webp|pdf|json|bin|zip|html|mhtml|txt|csv)$/i;
export function looksLikeOutputPath(arg: string): boolean {
  return OUTPUT_EXT.test(arg);
}
