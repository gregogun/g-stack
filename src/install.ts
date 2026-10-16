/**
 * Installing content into a harness, independent of which harness.
 *
 * An adapter says where the install goes (`root`) and which files it
 * consists of; this module lays content out with its relative links
 * rewritten, compares the result with what is on disk, and writes only what
 * changed. A manifest in the root records the files g-stack wrote, so a
 * re-install can update and remove them and never touches anything else.
 */
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { ConfigError, type Context } from './command.ts';

export type Scope = 'user' | 'project';

/** A file to install: its path relative to the install root, and its text. */
export type InstallFile = { path: string; text: string };

export type Adapter = {
  /** The name passed to `--harness`. */
  harness: string;
  /** The absolute directory this adapter installs into for `scope`. */
  root: (scope: Scope, context: Context) => string;
  /** Every file the install consists of. */
  files: () => Promise<InstallFile[]>;
};

type Action = 'create' | 'update' | 'unchanged' | 'remove';

export type InstallResult = {
  harness: string;
  scope: Scope;
  root: string;
  dryRun: boolean;
  /** Every file considered, with its absolute path. */
  files: { path: string; action: Action }[];
};

/** The manifest's name in the install root. */
const MANIFEST = '.gstack-manifest.json';

/** Every file under `dir`, as paths relative to it, sorted. */
const filesUnder = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
};

const FENCE = /^\s*(?:```|~~~)/;
const INLINE_LINK = /(\]\(\s*<?)([^)\s>]+)/g;
const REFERENCE_LINK = /^(\s*\[[^\]]+\]:\s*<?)([^\s>]+)/;
/** A URL scheme (https:, mailto:, ...) or a same-file anchor. */
const NOT_A_FILE = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

/**
 * Rewrites the relative links in `text` (the content file `from`) so they
 * still point at the same files once every content file `f` is installed
 * at `place(f)`. URLs, anchors, links in fenced or inline code, and links
 * whose target `place` leaves out (null) or that can't be decoded are left
 * as they are. Whether the target exists isn't checked; `gstack check` does
 * that on the content.
 */
const rewriteLinks = (
  text: string,
  from: string,
  place: (file: string) => string | null
): string => {
  const installedFrom = place(from);
  if (installedFrom === null) return text;
  const rewrite = (target: string): string => {
    if (NOT_A_FILE.test(target)) return target;
    const [file = '', ...anchor] = target.split('#');
    let decoded;
    try {
      decoded = decodeURI(file);
    } catch {
      return target;
    }
    const linked = path.posix.join(path.posix.dirname(from), decoded);
    const installed = place(linked);
    if (installed === null) return target;
    const relative = path.posix.relative(
      path.posix.dirname(installedFrom),
      installed
    );
    return [encodeURI(relative), ...anchor].join('#');
  };
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      // Odd segments are inline code; leave them alone.
      return line
        .split('`')
        .map((segment, index) =>
          index % 2 === 1
            ? segment
            : segment
                .replace(REFERENCE_LINK, (_, head: string, target: string) =>
                  index === 0 ? head + rewrite(target) : _
                )
                .replace(
                  INLINE_LINK,
                  (_, head: string, target: string) => head + rewrite(target)
                )
        )
        .join('`');
    })
    .join('\n');
};

/**
 * Every file under `contentDir`, placed at `place(path)` (paths use `/`;
 * null leaves a file out), with relative links in markdown rewritten to
 * match. Two files placed at the same path is a bug in the adapter.
 */
export const layOutContent = async (
  contentDir: string,
  place: (file: string) => string | null
): Promise<InstallFile[]> => {
  const files: InstallFile[] = [];
  const seen = new Map<string, string>();
  for (const file of await filesUnder(contentDir)) {
    const posix = file.split(path.sep).join('/');
    const target = place(posix);
    if (target === null) continue;
    const clash = seen.get(target);
    if (clash !== undefined) {
      throw new Error(
        `content ${clash} and ${posix} both install at ${target}`
      );
    }
    seen.set(target, posix);
    const text = await readFile(path.join(contentDir, file), 'utf8');
    files.push({
      path: target,
      text: posix.endsWith('.md') ? rewriteLinks(text, posix, place) : text,
    });
  }
  return files;
};

/**
 * A manifest entry as a clean relative path (`./a//b` -> `a/b`), or null
 * when it is empty or leaves the root.
 */
const normalizeEntry = (entry: string): string | null => {
  const normal = path.posix.normalize(entry.replaceAll('\\', '/'));
  if (
    normal === '.' ||
    normal === MANIFEST ||
    path.posix.isAbsolute(normal) ||
    normal.split('/').includes('..')
  ) {
    return null;
  }
  return normal;
};

const readManifest = async (root: string): Promise<Set<string>> => {
  const file = path.join(root, MANIFEST);
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    const files = (parsed as { files?: unknown } | null)?.files;
    if (Array.isArray(files) && files.every((f) => typeof f === 'string')) {
      return new Set(
        files.map(normalizeEntry).filter((f): f is string => f !== null)
      );
    }
  } catch {
    // Fall through to the error below.
  }
  throw new ConfigError(
    `invalid install manifest ${file}: expected {"files": [...]}; fix or delete it`
  );
};

/** The kind of thing at `file`, without following a final symlink. */
const kindOf = async (
  file: string
): Promise<'missing' | 'file' | 'symlink' | 'other'> => {
  try {
    const stats = await lstat(file);
    if (stats.isSymbolicLink()) return 'symlink';
    return stats.isFile() ? 'file' : 'other';
  } catch {
    return 'missing';
  }
};

/**
 * Refuses (ConfigError) when `relative` is reached through a symlink below
 * `root`, or names something other than a regular file.
 */
const assertPlainPath = async (root: string, relative: string) => {
  const parts = relative.split('/');
  for (let index = 1; index <= parts.length; index += 1) {
    const at = path.join(root, ...parts.slice(0, index));
    const kind = await kindOf(at);
    if (kind === 'missing') return;
    if (kind === 'symlink') {
      throw new ConfigError(
        `${at} is a symlink; install won't write or delete through it`
      );
    }
    if (index === parts.length && kind !== 'file') {
      throw new ConfigError(`${at} exists and is not a regular file`);
    }
  }
};

/** Removes empty directories from `dir` up to, but not including, `root`. */
const pruneEmptyDirs = async (root: string, dir: string) => {
  for (let at = dir; at !== root && at.startsWith(root);) {
    try {
      await rmdir(at);
    } catch {
      return;
    }
    at = path.dirname(at);
  }
};

/** A write failed partway through an install (exit 1). */
export class InstallError extends Error {
  override name = 'InstallError';
}

const manifestText = (harness: string, files: Iterable<string>) =>
  `${JSON.stringify({ harness, files: [...files].sort() }, null, 2)}\n`;

/**
 * Installs `adapter`'s files for `scope`. Writes nothing when `dryRun`, and
 * nothing at all (a ConfigError) when a file it would write exists without
 * g-stack having written it, or is reached through a symlink. A write that
 * fails partway is an InstallError; the manifest then lists what g-stack
 * owns so far.
 */
export const install = async (
  adapter: Adapter,
  scope: Scope,
  context: Context,
  dryRun: boolean
): Promise<InstallResult> => {
  const root = adapter.root(scope, context);
  const files = await adapter.files();
  const owned = await readManifest(root);

  const planned: { file: InstallFile; action: Action }[] = [];
  for (const file of files) {
    await assertPlainPath(root, file.path);
    const target = path.join(root, file.path);
    const existing = existsSync(target) ? await readFile(target, 'utf8') : null;
    if (existing === null) {
      planned.push({ file, action: 'create' });
    } else if (existing === file.text) {
      planned.push({ file, action: 'unchanged' });
    } else if (owned.has(file.path)) {
      planned.push({ file, action: 'update' });
    } else {
      throw new ConfigError(
        `${target} exists and was not written by g-stack; move it away and run install again`
      );
    }
  }

  // Never remove an entry that may name a shipped file: compared without
  // case, since macOS file systems usually ignore it.
  const shipped = new Set(files.map((file) => file.path));
  const shippedFolded = new Set([...shipped].map((f) => f.toLowerCase()));
  const removed: string[] = [];
  for (const file of [...owned].sort()) {
    if (shippedFolded.has(file.toLowerCase())) continue;
    await assertPlainPath(root, file);
    if (existsSync(path.join(root, file))) removed.push(file);
  }

  if (!dryRun) {
    const nowOwned = new Set(owned);
    try {
      for (const { file, action } of planned) {
        if (action !== 'create' && action !== 'update') continue;
        const target = path.join(root, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.text);
        nowOwned.add(file.path);
      }
      for (const file of removed) {
        const target = path.join(root, file);
        await rm(target, { force: true });
        nowOwned.delete(file);
        await pruneEmptyDirs(root, path.dirname(target));
      }
    } catch (error) {
      try {
        await mkdir(root, { recursive: true });
        await writeFile(
          path.join(root, MANIFEST),
          manifestText(adapter.harness, nowOwned)
        );
      } catch {
        // The original error is the one to report.
      }
      throw new InstallError(
        `install failed partway: ${(error as Error).message}`
      );
    }
    const manifest = manifestText(adapter.harness, shipped);
    const manifestFile = path.join(root, MANIFEST);
    const current = existsSync(manifestFile)
      ? await readFile(manifestFile, 'utf8')
      : null;
    if (current !== manifest) {
      await mkdir(root, { recursive: true });
      await writeFile(manifestFile, manifest);
    }
  }

  return {
    harness: adapter.harness,
    scope,
    root,
    dryRun,
    files: [
      ...planned.map(({ file, action }) => ({
        path: path.join(root, file.path),
        action,
      })),
      ...removed.map((file) => ({
        path: path.join(root, file),
        action: 'remove' as const,
      })),
    ],
  };
};
