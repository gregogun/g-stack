import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandbox, runCli, writeFileIn, type Sandbox } from './helpers.ts';

type Entry = {
  time: string;
  step: string;
  decision: string;
  reason: string;
  evidence: string;
  result: string;
};

const fields = {
  step: 'build.plan',
  decision: 'split the work into two commits',
  reason: 'the refactor and the feature are separate changes',
  evidence: 'git diff --stat',
  result: 'two commits',
};

const logArgs = (values: Omit<Entry, 'time'> = fields) =>
  Object.entries(values).flatMap(([name, value]) => [`--${name}`, value]);

const append = async (
  sandbox: Sandbox,
  values: Omit<Entry, 'time'> = fields,
  cwd?: string
) => {
  const result = await runCli(['log', ...logArgs(values)], sandbox, { cwd });
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return result;
};

const showJson = async (sandbox: Sandbox, cwd?: string): Promise<Entry[]> => {
  const result = await runCli(['log', '--show', '--json'], sandbox, { cwd });
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as Entry[];
};

const logFile = (sandbox: Sandbox) =>
  path.join(sandbox.project, '.gstack', 'decisions.jsonl');

describe('gstack log', () => {
  it('appends a row with all six fields, filling in the time', async () => {
    const sandbox = await createSandbox();
    const before = Date.now();

    const result = await append(sandbox);

    const after = Date.now();
    expect(result.stdout).toBe('');
    const entries = await showJson(sandbox);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toEqual({ time: expect.any(String), ...fields });
    expect(entry?.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    const time = Date.parse(entry?.time ?? '');
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });

  it('keeps earlier rows when appending, in order', async () => {
    const sandbox = await createSandbox();

    await append(sandbox, { ...fields, step: 'one' });
    await append(sandbox, { ...fields, step: 'two' });
    await append(sandbox, { ...fields, step: 'three' });

    const entries = await showJson(sandbox);
    expect(entries.map((entry) => entry.step)).toEqual(['one', 'two', 'three']);
  });

  it('starts a new line when a hand-edited log lost its final newline', async () => {
    const sandbox = await createSandbox();
    await append(sandbox, { ...fields, step: 'one' });
    const text = await readFile(logFile(sandbox), 'utf8');
    await writeFileIn(
      sandbox.project,
      '.gstack/decisions.jsonl',
      text.trimEnd()
    );

    await append(sandbox, { ...fields, step: 'two' });

    const entries = await showJson(sandbox);
    expect(entries.map((entry) => entry.step)).toEqual(['one', 'two']);
  });

  it('accepts values starting with a dash in the --field=value form', async () => {
    const sandbox = await createSandbox();

    const result = await runCli(
      [
        'log',
        ...logArgs({ ...fields, evidence: 'x' }).slice(0, -2),
        '--result=-1 failing test',
      ],
      sandbox
    );

    expect(result.exitCode).toBe(0);
    expect((await showJson(sandbox))[0]?.result).toBe('-1 failing test');
  });

  it('stores fields with tabs and newlines without corrupting the log', async () => {
    const sandbox = await createSandbox();
    const awkward = {
      step: 'investigate.hypothesis',
      decision: 'col1\tcol2\tcol3',
      reason: 'line one\nline two\r\nline three',
      evidence: 'quote " backslash \\ brace {"a":1}\n\n',
      result: '\t\n',
    };

    await append(sandbox, awkward);
    await append(sandbox);

    const text = await readFile(logFile(sandbox), 'utf8');
    expect(text.trimEnd().split('\n')).toHaveLength(2);
    const entries = await showJson(sandbox);
    expect(entries).toEqual([
      { time: expect.any(String), ...awkward },
      { time: expect.any(String), ...fields },
    ]);
  });

  it('accepts empty evidence and result', async () => {
    const sandbox = await createSandbox();

    await append(sandbox, { ...fields, evidence: '', result: '' });

    expect(await showJson(sandbox)).toMatchObject([
      { evidence: '', result: '' },
    ]);
  });

  it('writes to the project root log from a subdirectory', async () => {
    const sandbox = await createSandbox();
    await mkdir(path.join(sandbox.project, 'src', 'deep'), { recursive: true });

    await append(sandbox, fields, 'src/deep');

    expect(await readFile(logFile(sandbox), 'utf8')).toContain('build.plan');
    expect(await showJson(sandbox)).toHaveLength(1);
  });
});

describe('gstack log --show', () => {
  it('prints each row readably, indenting continuation lines', async () => {
    const sandbox = await createSandbox();
    await append(sandbox);
    await append(sandbox, {
      ...fields,
      step: 'build.review',
      reason: 'first line\nsecond line',
    });
    const [first, second] = await showJson(sandbox);

    const result = await runCli(['log', '--show'], sandbox);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      `${first?.time}  build.plan
  decision: split the work into two commits
  reason:   the refactor and the feature are separate changes
  evidence: git diff --stat
  result:   two commits

${second?.time}  build.review
  decision: split the work into two commits
  reason:   first line
            second line
  evidence: git diff --stat
  result:   two commits
`
    );
  });

  it('prints nothing when the project has no log yet', async () => {
    const sandbox = await createSandbox();

    const text = await runCli(['log', '--show'], sandbox);
    const json = await runCli(['log', '--show', '--json'], sandbox);

    expect(text).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(json).toEqual({ exitCode: 0, stdout: '[]\n', stderr: '' });
  });

  it('shows only the current project log', async () => {
    const sandbox = await createSandbox();
    const other = await createSandbox();
    await append(other);

    expect(await showJson(sandbox)).toEqual([]);
  });

  it('fails naming the file and line when a row is unreadable', async () => {
    const sandbox = await createSandbox();
    await append(sandbox);
    const file = logFile(sandbox);
    await writeFileIn(
      sandbox.project,
      '.gstack/decisions.jsonl',
      `${await readFile(file, 'utf8')}not json\n`
    );

    const result = await runCli(['log', '--show'], sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`${file}:2`);
  });
});

describe('gstack log usage errors', () => {
  it('requires every field, naming the missing ones', async () => {
    const sandbox = await createSandbox();

    const result = await runCli(
      ['log', '--step', 'build.plan', '--decision', 'go'],
      sandbox
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--reason, --evidence, --result');
    expect(result.stderr).toContain('gstack --help');
  });

  it('rejects an empty step or decision', async () => {
    const sandbox = await createSandbox();

    for (const name of ['step', 'decision'] as const) {
      const result = await runCli(
        ['log', ...logArgs({ ...fields, [name]: '' })],
        sandbox
      );

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(`--${name}`);
    }
  });

  it('rejects fields together with --show', async () => {
    const result = await runCli(
      ['log', '--show', '--step', 'x'],
      await createSandbox()
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--show');
  });

  it('rejects --json without --show', async () => {
    const result = await runCli(
      ['log', ...logArgs(), '--json'],
      await createSandbox()
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--json');
  });

  it('rejects unknown options and positional arguments', async () => {
    const sandbox = await createSandbox();

    const unknown = await runCli(['log', '--show', '--yaml'], sandbox);
    const positional = await runCli(['log', '--show', 'extra'], sandbox);

    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain('--yaml');
    expect(positional.exitCode).toBe(2);
    expect(positional.stderr).toContain("unexpected argument 'extra'");
  });
});
