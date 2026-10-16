import { existsSync } from 'node:fs';
import path from 'node:path';

/** The nearest ancestor of `cwd` holding .git, else `cwd` itself. */
export const projectRoot = (cwd: string): string => {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return cwd;
  }
};
