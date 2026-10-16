import { readFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandbox, runCli, writeFileIn, type Sandbox } from './helpers.ts';

const CLAUDE_ID = '5f0c2a9e-7b1d-4c3e-9a8f-0d6e4b2c1a77';
const PI_ID = '019c4d2e-8f10-7a3b-9c4d-5e6f7a8b9c0d';

const fixture = (name: string) =>
  readFile(
    path.join(import.meta.dirname, 'fixtures/transcripts', name),
    'utf8'
  );

/** Where Claude Code keeps sessions for `cwd`, under the sandbox's home. */
const claudeProjectDir = (sandbox: Sandbox, cwd = sandbox.project) =>
  path.join('.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));

/** Where pi keeps sessions for `cwd`, under the sandbox's home. */
const piProjectDir = (sandbox: Sandbox, cwd = sandbox.project) =>
  path.join(
    '.pi/agent/sessions',
    `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  );

/** Puts a Claude Code session file for the project in the sandbox's home. */
const claudeSession = async (
  sandbox: Sandbox,
  id = CLAUDE_ID,
  content?: string
) =>
  writeFileIn(
    sandbox.home,
    path.join(claudeProjectDir(sandbox), `${id}.jsonl`),
    (content ?? (await fixture('claude-code.jsonl'))).replaceAll(CLAUDE_ID, id)
  );

/** Puts a pi session file for the project in the sandbox's home. */
const piSession = async (sandbox: Sandbox, id = PI_ID, content?: string) =>
  writeFileIn(
    sandbox.home,
    path.join(piProjectDir(sandbox), `2026-03-02T10-00-00-000Z_${id}.jsonl`),
    (content ?? (await fixture('pi.jsonl'))).replaceAll(PI_ID, id)
  );

/** Makes `file` look last modified `secondsAgo` seconds ago. */
const age = async (file: string, secondsAgo: number) => {
  const time = new Date(Date.now() - secondsAgo * 1000);
  await utimes(file, time, time);
};

const transcript = async (sandbox: Sandbox, args: string[]) => {
  const result = await runCli(['transcript', ...args], sandbox);
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
};

const user = (text: string, timestamp: string) => ({
  role: 'user',
  text,
  timestamp,
});

describe('gstack transcript normalises each harness', () => {
  it('reads a Claude Code session', async () => {
    const sandbox = await createSandbox();
    const file = await claudeSession(sandbox);

    expect(await transcript(sandbox, ['--file', file])).toEqual({
      harness: 'claude-code',
      sessionId: CLAUDE_ID,
      file,
      turns: [
        user('What does greet return?', '2026-03-02T10:00:01.000Z'),
        {
          role: 'assistant',
          text: 'Let me read it.',
          toolCalls: [
            {
              id: 'toolu_demo_read',
              name: 'Read',
              input: { file_path: '/work/demo/src/greet.ts' },
            },
          ],
          timestamp: '2026-03-02T10:00:02.000Z',
        },
        {
          role: 'tool',
          toolCallId: 'toolu_demo_read',
          toolName: 'Read',
          text: "export const greet = (name: string) => 'Hello, ' + name;",
          isError: false,
          timestamp: '2026-03-02T10:00:03.000Z',
        },
        {
          role: 'assistant',
          text: '',
          toolCalls: [
            {
              id: 'toolu_demo_bash',
              name: 'Bash',
              input: { command: 'pnpm test', description: 'Run the tests' },
            },
          ],
          timestamp: '2026-03-02T10:00:04.000Z',
        },
        {
          role: 'tool',
          toolCallId: 'toolu_demo_bash',
          toolName: 'Bash',
          text: 'pnpm: command not found',
          isError: true,
          timestamp: '2026-03-02T10:00:05.000Z',
        },
        {
          role: 'assistant',
          text: "It returns a greeting such as 'Hello, Ada'.",
          toolCalls: [],
          timestamp: '2026-03-02T10:00:06.000Z',
        },
      ],
    });
  });

  it('reads a pi session, following the current branch', async () => {
    const sandbox = await createSandbox();
    const file = await piSession(sandbox);

    expect(await transcript(sandbox, ['--file', file])).toEqual({
      harness: 'pi',
      sessionId: PI_ID,
      file,
      turns: [
        user('What does greet return?', '2026-03-02T10:00:01.000Z'),
        {
          role: 'assistant',
          text: 'Let me read it.',
          toolCalls: [
            {
              id: 'call_demo_read',
              name: 'read',
              input: { path: 'src/greet.ts' },
            },
          ],
          timestamp: '2026-03-02T10:00:02.000Z',
        },
        {
          role: 'tool',
          toolCallId: 'call_demo_read',
          toolName: 'read',
          text: "export const greet = (name: string) => 'Hello, ' + name;",
          isError: false,
          timestamp: '2026-03-02T10:00:03.000Z',
        },
        {
          role: 'assistant',
          text: '',
          toolCalls: [
            {
              id: 'call_demo_bash',
              name: 'bash',
              input: { command: 'pnpm test' },
            },
          ],
          timestamp: '2026-03-02T10:00:04.000Z',
        },
        {
          role: 'tool',
          toolCallId: 'call_demo_bash',
          toolName: 'bash',
          text: 'pnpm: command not found',
          isError: true,
          timestamp: '2026-03-02T10:00:05.000Z',
        },
        user('$ ls\nsrc\n', '2026-03-02T10:00:05.500Z'),
        {
          role: 'assistant',
          text: "It returns a greeting such as 'Hello, Ada'.",
          toolCalls: [],
          timestamp: '2026-03-02T10:00:06.000Z',
        },
      ],
    });
  });
});

describe('gstack transcript session selection', () => {
  it('takes the most recent session for the current project', async () => {
    const sandbox = await createSandbox();
    await age(await claudeSession(sandbox), 60);
    await age(await piSession(sandbox), 120);
    await age(
      await claudeSession(sandbox, '00000000-0000-4000-8000-0000000000aa'),
      300
    );

    expect(await transcript(sandbox, [])).toMatchObject({
      harness: 'claude-code',
      sessionId: CLAUDE_ID,
    });
  });

  it('limits the most recent session to one harness with --harness', async () => {
    const sandbox = await createSandbox();
    await age(await claudeSession(sandbox), 60);
    await age(await piSession(sandbox), 120);

    expect(await transcript(sandbox, ['--harness', 'pi'])).toMatchObject({
      harness: 'pi',
      sessionId: PI_ID,
    });
  });

  it('ignores sessions that belong to other projects', async () => {
    const sandbox = await createSandbox();
    await age(await piSession(sandbox), 120);
    await writeFileIn(
      sandbox.home,
      path.join(claudeProjectDir(sandbox, '/elsewhere'), `${CLAUDE_ID}.jsonl`),
      await fixture('claude-code.jsonl')
    );

    expect(await transcript(sandbox, [])).toMatchObject({ harness: 'pi' });
  });

  it('selects a session by id in any harness and project', async () => {
    const sandbox = await createSandbox();
    await claudeSession(sandbox);
    const otherId = '019c0000-0000-7000-8000-000000000001';
    await writeFileIn(
      sandbox.home,
      path.join(
        piProjectDir(sandbox, '/elsewhere'),
        `2026-01-01T00-00-00-000Z_${otherId}.jsonl`
      ),
      (await fixture('pi.jsonl')).replaceAll(PI_ID, otherId)
    );

    expect(await transcript(sandbox, ['--session', CLAUDE_ID])).toMatchObject({
      harness: 'claude-code',
      sessionId: CLAUDE_ID,
    });
    expect(await transcript(sandbox, ['--session', otherId])).toMatchObject({
      harness: 'pi',
      sessionId: otherId,
    });
  });

  it('honours CLAUDE_CONFIG_DIR and PI_CODING_AGENT_DIR', async () => {
    const sandbox = await createSandbox();
    const claudeDir = path.join(sandbox.home, 'claude-config');
    const piDir = path.join(sandbox.home, 'pi-agent');
    await writeFileIn(
      claudeDir,
      path.join(
        claudeProjectDir(sandbox).replace('.claude/', ''),
        `${CLAUDE_ID}.jsonl`
      ),
      await fixture('claude-code.jsonl')
    );
    await writeFileIn(
      piDir,
      path.join(
        piProjectDir(sandbox).replace('.pi/agent/', ''),
        `2026-03-02T10-00-00-000Z_${PI_ID}.jsonl`
      ),
      await fixture('pi.jsonl')
    );
    const env = { CLAUDE_CONFIG_DIR: claudeDir, PI_CODING_AGENT_DIR: piDir };

    for (const [harness, sessionId] of [
      ['claude-code', CLAUDE_ID],
      ['pi', PI_ID],
    ] as const) {
      const result = await runCli(
        ['transcript', '--harness', harness],
        sandbox,
        { env }
      );
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({ harness, sessionId });
    }
  });

  it('exits 1 when the project has no sessions', async () => {
    const sandbox = await createSandbox();

    const result = await runCli(['transcript'], sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no session found');
    expect(result.stderr).toContain(sandbox.project);
  });

  it('exits 1 when no session has the id', async () => {
    const sandbox = await createSandbox();
    await claudeSession(sandbox);

    const result = await runCli(['transcript', '--session', 'nope'], sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no session with id 'nope'");
  });
});

describe('gstack transcript with a file it cannot parse', () => {
  const expectParseError = async (
    sandbox: Sandbox,
    args: string[],
    file: string,
    reason: string
  ) => {
    const result = await runCli(['transcript', ...args], sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain(reason);
  };

  it('names the file and line holding invalid JSON', async () => {
    const sandbox = await createSandbox();
    const good = await fixture('claude-code.jsonl');
    const file = await claudeSession(sandbox, CLAUDE_ID, `${good}{ nope\n`);

    await expectParseError(sandbox, [], `${file}:15`, 'not valid JSON');
  });

  it('names a file that is neither harness format', async () => {
    const sandbox = await createSandbox();
    const file = await writeFileIn(
      sandbox.project,
      'notes.jsonl',
      '{"hello":"world"}\n'
    );

    await expectParseError(
      sandbox,
      ['--file', file],
      file,
      'not a Claude Code or pi session'
    );
  });

  it('names a pi file with a malformed message', async () => {
    const sandbox = await createSandbox();
    const file = await piSession(
      sandbox,
      PI_ID,
      `{"type":"session","version":3,"id":"${PI_ID}","timestamp":"2026-03-02T10:00:00.000Z","cwd":"/work/demo"}\n{"type":"message","id":"e1","parentId":null,"timestamp":"2026-03-02T10:00:01.000Z","message":{"role":"assistant","content":"oops"}}\n`
    );

    await expectParseError(
      sandbox,
      ['--harness', 'pi'],
      file,
      'not a valid pi session'
    );
  });

  it('names a --file that does not exist', async () => {
    const sandbox = await createSandbox();
    const file = path.join(sandbox.project, 'missing.jsonl');

    await expectParseError(sandbox, ['--file', file], file, 'cannot read');
  });
});

describe('gstack transcript usage errors', () => {
  it('rejects an unknown harness with exit 2', async () => {
    const result = await runCli(
      ['transcript', '--harness', 'cursor'],
      await createSandbox()
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown harness 'cursor'");
  });

  it('rejects --file together with --session', async () => {
    const result = await runCli(
      ['transcript', '--file', 'a.jsonl', '--session', 'x'],
      await createSandbox()
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--file');
  });

  it('rejects positional arguments', async () => {
    const result = await runCli(['transcript', 'extra'], await createSandbox());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unexpected argument 'extra'");
  });
});
