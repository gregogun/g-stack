/** The normalised transcript shape, and what each harness format provides. */
import type { Context } from '../command.ts';

type ToolCall = { id: string; name: string; input: unknown };

export type Turn =
  | { role: 'user'; text: string; timestamp: string | null }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      timestamp: string | null;
    }
  | {
      role: 'tool';
      toolCallId: string | null;
      toolName: string | null;
      text: string;
      isError: boolean;
      timestamp: string | null;
    };

export type AssistantTurn = Extract<Turn, { role: 'assistant' }>;

export type Transcript = {
  harness: string;
  sessionId: string;
  file: string;
  turns: Turn[];
};

/** One parsed line of a JSONL session file. */
export type Entry = { line: number; value: Record<string, unknown> };

/** Thrown by a format's `parse` when an entry isn't what it expects. */
export class MalformedEntry extends Error {
  constructor(entry: Entry, problem: string) {
    super(`line ${entry.line}: ${problem}`);
  }
}

export type SessionFormat = {
  /** The `--harness` value and the `harness` field of the output. */
  harness: string;
  /** Human name, for messages. */
  label: string;
  /** The directory holding one subdirectory of sessions per project. */
  sessionsRoot: (env: Context['env'], home: string) => string;
  /** The name of the subdirectory holding sessions started in `cwd`. */
  projectDirName: (cwd: string) => string;
  /** The session id a session file's name carries, or null if none. */
  idFromFileName: (name: string) => string | null;
  /** Whether a file's entries look like this format (for `--file`). */
  recognises: (entries: Entry[]) => boolean;
  /** Reads entries into turns; throws MalformedEntry on bad input. */
  parse: (entries: Entry[]) => { sessionId: string; turns: Turn[] };
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An entry's ISO `timestamp` field, or null. */
export const timestampOf = (entry: Entry): string | null =>
  typeof entry.value.timestamp === 'string' ? entry.value.timestamp : null;

/** `value` as an object, or a MalformedEntry naming `what`. */
export const objectAt = (
  entry: Entry,
  value: unknown,
  what: string
): Record<string, unknown> => {
  if (!isObject(value))
    throw new MalformedEntry(entry, `${what} must be an object`);
  return value;
};

/** `value` as a string, or a MalformedEntry naming `what`. */
export const stringAt = (
  entry: Entry,
  value: unknown,
  what: string
): string => {
  if (typeof value !== 'string')
    throw new MalformedEntry(entry, `${what} must be a string`);
  return value;
};

/** `value` as an array of objects, or a MalformedEntry naming `what`. */
export const blocksAt = (
  entry: Entry,
  value: unknown,
  what: string
): Record<string, unknown>[] => {
  if (!Array.isArray(value))
    throw new MalformedEntry(entry, `${what} must be an array`);
  return value.map((block) => objectAt(entry, block, `each of ${what}`));
};

/**
 * The text of content that is either a string or an array of blocks: text
 * blocks joined by newlines, images as "[image]", other blocks (thinking,
 * tool calls) skipped.
 */
export const contentText = (entry: Entry, content: unknown): string => {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of blocksAt(entry, content, 'content')) {
    if (block.type === 'text') parts.push(stringAt(entry, block.text, 'text'));
    else if (block.type === 'image') parts.push('[image]');
  }
  return parts.join('\n');
};
