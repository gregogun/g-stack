/**
 * pi session files: $PI_CODING_AGENT_DIR (default ~/.pi/agent)/sessions
 * /--<cwd without its leading "/", with "/", "\" and ":" as "-">--
 * /<timestamp>_<id>.jsonl. Format documented in pi's docs/session-format.md.
 *
 * The first line is a header `{"type":"session","id":...}`. Later lines are
 * entries forming a tree through `id`/`parentId`; the current branch runs
 * from the last entry back to the root, and abandoned branches are skipped.
 * Only `message` entries become turns, and of those only user, assistant,
 * toolResult and bashExecution (a command the user ran, shown as a user
 * turn). Summaries and extension messages are skipped.
 */
import path from 'node:path';
import {
  blocksAt,
  contentText,
  MalformedEntry,
  objectAt,
  stringAt,
  timestampOf,
  type Entry,
  type SessionFormat,
  type Turn,
} from './shared.ts';

const isHeader = (entry: Entry | undefined) =>
  entry?.value.type === 'session' && typeof entry.value.id === 'string';

/** The entries on the current branch, root first. */
const currentBranch = (entries: Entry[]): Entry[] => {
  // Version 1 sessions are linear and have no ids.
  if (!entries.some((entry) => typeof entry.value.id === 'string')) {
    return entries;
  }
  const byId = new Map(entries.map((entry) => [entry.value.id, entry]));
  const branch: Entry[] = [];
  const seen = new Set<unknown>();
  let entry = entries.findLast((candidate) => candidate.value.id !== undefined);
  while (entry && !seen.has(entry.value.id)) {
    seen.add(entry.value.id);
    branch.push(entry);
    entry =
      entry.value.parentId === null || entry.value.parentId === undefined
        ? undefined
        : byId.get(entry.value.parentId);
  }
  return branch.reverse();
};

const toTurn = (entry: Entry): Turn | null => {
  const message = objectAt(entry, entry.value.message, 'message');
  const timestamp = timestampOf(entry);
  switch (message.role) {
    case 'user':
      return {
        role: 'user',
        text: contentText(entry, message.content),
        timestamp,
      };
    case 'assistant': {
      const blocks = blocksAt(entry, message.content, 'assistant content');
      return {
        role: 'assistant',
        text: contentText(entry, blocks),
        toolCalls: blocks
          .filter((block) => block.type === 'toolCall')
          .map((block) => ({
            id: stringAt(entry, block.id, 'toolCall id'),
            name: stringAt(entry, block.name, 'toolCall name'),
            input: block.arguments ?? {},
          })),
        timestamp,
      };
    }
    case 'toolResult':
      return {
        role: 'tool',
        toolCallId: stringAt(entry, message.toolCallId, 'toolCallId'),
        toolName: stringAt(entry, message.toolName, 'toolName'),
        text: contentText(entry, message.content),
        isError: message.isError === true,
        timestamp,
      };
    case 'bashExecution': {
      const command = stringAt(entry, message.command, 'command');
      const output = stringAt(entry, message.output, 'output');
      return { role: 'user', text: `$ ${command}\n${output}`, timestamp };
    }
    default:
      return null;
  }
};

const parse: SessionFormat['parse'] = (entries) => {
  const [header, ...rest] = entries;
  if (!header || !isHeader(header)) {
    throw new MalformedEntry(
      header ?? { line: 1, value: {} },
      'the first line must be a session header with an id'
    );
  }
  const turns = currentBranch(rest)
    .filter((entry) => entry.value.type === 'message')
    .map(toTurn)
    .filter((turn) => turn !== null);
  return { sessionId: header.value.id as string, turns };
};

export const pi: SessionFormat = {
  harness: 'pi',
  label: 'pi',
  sessionsRoot: (env, home) =>
    path.join(
      env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'),
      'sessions'
    ),
  projectDirName: (cwd) =>
    `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`,
  idFromFileName: (name) => /_(.+)\.jsonl$/.exec(name)?.[1] ?? null,
  recognises: (entries) => isHeader(entries[0]),
  parse,
};
