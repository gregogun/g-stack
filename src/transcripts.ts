/**
 * The transcript normaliser: finds a harness session file and reads it into
 * one harness-neutral shape (see docs/transcript.md).
 *
 * Each harness is one `SessionFormat` in `formats`. To support another
 * harness, add a format next to src/transcripts/claude-code.ts: where its
 * sessions live, how a file name maps to a session id, and how its entries
 * become turns.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from './command.ts';
import { claudeCode } from './transcripts/claude-code.ts';
import { pi } from './transcripts/pi.ts';
import {
  isObject,
  MalformedEntry,
  type Entry,
  type SessionFormat,
  type Transcript,
} from './transcripts/shared.ts';

const formats: SessionFormat[] = [claudeCode, pi];

export const harnessNames = formats.map((format) => format.harness);

/** A session that couldn't be found or read. Exit 1. */
export class TranscriptError extends Error {
  override name = 'TranscriptError';
}

const readEntries = async (file: string): Promise<Entry[]> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new TranscriptError(
      `cannot read session ${file}: ${(error as Error).message}`
    );
  }
  const entries: Entry[] = [];
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    if (raw.trim() === '') continue;
    const line = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      // A last line with no newline after it is one the harness is still
      // writing (the newest session is usually live); skip it.
      if (index === lines.length - 1) break;
      throw new TranscriptError(
        `${file}:${line}: not valid JSON (${(error as Error).message})`
      );
    }
    if (!isObject(value)) {
      throw new TranscriptError(`${file}:${line}: not a JSON object`);
    }
    entries.push({ line, value });
  }
  return entries;
};

/** Reads `file` as `format`, or as whichever format recognises it. */
const readSession = async (
  file: string,
  format?: SessionFormat
): Promise<Transcript> => {
  const entries = await readEntries(file);
  const chosen = format ?? formats.find((f) => f.recognises(entries));
  if (!chosen) {
    throw new TranscriptError(
      `${file}: not a ${formats.map((f) => f.label).join(' or ')} session`
    );
  }
  try {
    const parsed = chosen.parse(entries);
    // Prefer the id in the file name: it is what `--session` looks up, and a
    // resumed session's file can hold older lines with another id.
    const sessionId =
      chosen.idFromFileName(path.basename(file)) ?? parsed.sessionId;
    return { harness: chosen.harness, sessionId, file, turns: parsed.turns };
  } catch (error) {
    if (!(error instanceof MalformedEntry)) throw error;
    throw new TranscriptError(
      `${file}: not a valid ${chosen.label} session (${error.message})`
    );
  }
};

/** The `.jsonl` files directly inside `dir`; none if it doesn't exist. */
const sessionFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
};

/** The directories directly inside `dir`; none if it doesn't exist. */
const subdirectories = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
};

type Selection = {
  /** Only this harness (a `--harness` value); default: every harness. */
  harness?: string;
  /** A session id, looked up in every project. */
  session?: string;
  /** A session file, read directly. */
  file?: string;
};

/**
 * Finds and reads the session `selection` names: a file, a session id, or
 * else the most recently modified session started in `context.cwd`.
 * `home` is the user's home directory.
 */
export const loadTranscript = async (
  selection: Selection,
  context: Context,
  home: string
): Promise<Transcript> => {
  const candidates = formats.filter(
    (format) => !selection.harness || format.harness === selection.harness
  );
  if (selection.file) {
    return readSession(
      path.resolve(context.cwd, selection.file),
      selection.harness ? candidates[0] : undefined
    );
  }

  if (selection.session) {
    for (const format of candidates) {
      const root = format.sessionsRoot(context.env, home);
      for (const dir of await subdirectories(root)) {
        for (const file of await sessionFiles(dir)) {
          if (format.idFromFileName(path.basename(file)) === selection.session)
            return readSession(file, format);
        }
      }
    }
    throw new TranscriptError(`no session with id '${selection.session}'`);
  }

  let newest: { file: string; format: SessionFormat; mtime: number } | null =
    null;
  for (const format of candidates) {
    const dir = path.join(
      format.sessionsRoot(context.env, home),
      format.projectDirName(context.cwd)
    );
    for (const file of await sessionFiles(dir)) {
      const { mtimeMs } = await stat(file);
      if (!newest || mtimeMs > newest.mtime) {
        newest = { file, format, mtime: mtimeMs };
      }
    }
  }
  if (!newest) {
    throw new TranscriptError(
      `no session found for ${context.cwd} in ${candidates
        .map((format) => format.label)
        .join(' or ')}`
    );
  }
  return readSession(newest.file, newest.format);
};
