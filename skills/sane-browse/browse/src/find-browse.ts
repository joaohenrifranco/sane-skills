/**
 * find-browse — print the absolute path of the browse launcher.
 * Looks for skills/sane-browse/browse/bin/browse in project-local, then
 * user-global agent skill directories. Exits 1 if not found.
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { getGitRoot } from './config';

export function locateBinary(): string | null {
  const adjacent = resolve(import.meta.dir, '..', 'bin', 'browse');
  if (existsSync(adjacent)) return adjacent;
  const root = getGitRoot();
  const markers = ['.agents', '.claude', '.codex'];
  const bases = [...(root ? markers.map(m => join(root, m)) : []), ...markers.map(m => join(homedir(), m))];
  for (const base of bases) {
    const candidate = join(base, 'skills', 'sane-browse', 'browse', 'bin', 'browse');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

if (import.meta.main) {
  const bin = locateBinary();
  if (!bin) {
    process.stderr.write('browse launcher not found. Install the sane-browse skill, then use <skill-dir>/browse/bin/browse.\n');
    process.exit(1);
  }
  console.log(bin);
}
