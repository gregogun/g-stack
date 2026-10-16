/**
 * Claude Code session files: $CLAUDE_CONFIG_DIR (default ~/.claude)
 * /projects/<cwd with every non-alphanumeric character as "-">/<id>.jsonl.
 *
 * One JSON object per line. Conversation lines have `type` "user" or
 * "assistant" and an Anthropic Messages API `message`; everything else
 * (snapshots, attachments, cost state, ...) is bookkeeping and skipped. An
 * assistant message is often split over several lines sharing `message.id`,
 * one content block each; those are joined into one turn. Subagent lines
 * (`isSidechain`) and injected lines (`isMeta`) are skipped.
 */
import path from 'node:path';
import {
  blocksAt,
  contentText,
  MalformedEntry,
  objectAt,
  stringAt,
  timestampOf,
  type AssistantTurn,
  type Entry,
  type SessionFormat,
  type Turn,
} from './shared.ts';

const isConversation = (entry: Entry) =>
  (entry.value.type === 'user' || entry.value.type === 'assistant') &&
  entry.value.isSidechain !== true;

/** An assistant message being assembled from one or more lines. */
type Assembling = { messageId: unknown; turn: AssistantTurn; pushed: boolean };

const parse: SessionFormat['parse'] = (entries) => {
  const conversation = entries.filter(isConversation);
  const withId = entries.find(
    (entry) => typeof entry.value.sessionId === 'string'
  );
  if (!withId) {
    throw new MalformedEntry(
      entries[0] ?? { line: 1, value: {} },
      'no line has a sessionId'
    );
  }

  const turns: Turn[] = [];
  const toolNames = new Map<string, string>();
  // The current assistant message, which may span several lines.
  let current: Assembling | null = null;

  for (const entry of conversation) {
    const message = objectAt(entry, entry.value.message, 'message');
    const timestamp = timestampOf(entry);

    if (entry.value.type === 'assistant') {
      const assembling: Assembling =
        current !== null &&
        message.id !== undefined &&
        current.messageId === message.id
          ? current
          : {
              messageId: message.id,
              turn: { role: 'assistant', text: '', toolCalls: [], timestamp },
              pushed: false,
            };
      current = assembling;
      const { turn } = assembling;
      for (const block of blocksAt(entry, message.content, 'message.content')) {
        if (block.type === 'text') {
          const text = stringAt(entry, block.text, 'text');
          turn.text = turn.text ? `${turn.text}\n${text}` : text;
        } else if (block.type === 'tool_use') {
          const id = stringAt(entry, block.id, 'tool_use id');
          const name = stringAt(entry, block.name, 'tool_use name');
          toolNames.set(id, name);
          turn.toolCalls.push({ id, name, input: block.input ?? {} });
        }
      }
      if (!assembling.pushed && (turn.text || turn.toolCalls.length > 0)) {
        turns.push(turn);
        assembling.pushed = true;
      }
      continue;
    }

    current = null;
    if (entry.value.isMeta === true) continue;
    if (typeof message.content === 'string') {
      turns.push({ role: 'user', text: message.content, timestamp });
      continue;
    }
    const text: string[] = [];
    for (const block of blocksAt(entry, message.content, 'message.content')) {
      if (block.type === 'tool_result') {
        const toolCallId = stringAt(entry, block.tool_use_id, 'tool_use_id');
        turns.push({
          role: 'tool',
          toolCallId,
          toolName: toolNames.get(toolCallId) ?? null,
          text: contentText(entry, block.content ?? ''),
          isError: block.is_error === true,
          timestamp,
        });
      } else {
        const blockText = contentText(entry, [block]);
        if (blockText) text.push(blockText);
      }
    }
    if (text.length > 0) {
      turns.push({ role: 'user', text: text.join('\n'), timestamp });
    }
  }

  return { sessionId: withId.value.sessionId as string, turns };
};

export const claudeCode: SessionFormat = {
  harness: 'claude-code',
  label: 'Claude Code',
  sessionsRoot: (env, home) =>
    path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects'),
  projectDirName: (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-'),
  idFromFileName: (name) => name.replace(/\.jsonl$/, ''),
  recognises: (entries) =>
    entries.some(
      (entry) =>
        isConversation(entry) && typeof entry.value.sessionId === 'string'
    ),
  parse,
};
