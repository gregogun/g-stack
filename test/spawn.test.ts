import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSandbox,
  fakeBin,
  runCli,
  writeFileIn,
  type Sandbox,
} from './helpers.ts';

const explorerBrief = await readFile(
  new URL('../content/roles/explorer.md', import.meta.url),
  'utf8'
);

const TASK = 'How does model resolution work?\n\nLook at src/models.ts.\n';

/**
 * A fake `claude` that records its args (one per line) and stdin into the
 * sandbox, then runs `then` (by default: print an answer and exit 0).
 */
const fakeClaude = (
  sandbox: Sandbox,
  then = 'echo "the answer"'
): Promise<string> =>
  fakeBin(
    sandbox,
    'claude',
    [
      `printf '%s\\n' "$@" > '${path.join(sandbox.home, 'claude-args')}'`,
      `cat > '${path.join(sandbox.home, 'claude-stdin')}'`,
      then,
    ].join('\n')
  );

const recordedArgs = async (sandbox: Sandbox): Promise<string[]> =>
  (await readFile(path.join(sandbox.home, 'claude-args'), 'utf8'))
    .split('\n')
    .slice(0, -1);

const recordedStdin = (sandbox: Sandbox): Promise<string> =>
  readFile(path.join(sandbox.home, 'claude-stdin'), 'utf8');

const writeTask = (sandbox: Sandbox, content = TASK) =>
  writeFileIn(sandbox.project, 'task.md', content);

const spawn = (sandbox: Sandbox, ...extra: string[]) =>
  runCli(
    ['spawn', '--role', 'explorer', '--brief', 'task.md', ...extra],
    sandbox
  );

describe('gstack spawn with the claude backend', () => {
  it('passes the role brief then the task brief to claude unchanged', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);

    const result = await spawn(sandbox);

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(await recordedStdin(sandbox)).toBe(`${explorerBrief}\n${TASK}`);
  });

  it('runs claude headlessly with text output and no model flag for the default model', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);

    await spawn(sandbox);

    expect(await recordedArgs(sandbox)).toEqual([
      '-p',
      '--output-format',
      'text',
    ]);
  });

  it('passes the resolved model from config as --model', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);
    await writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({ roles: { explorer: { model: 'haiku' } } })
    );

    const result = await spawn(sandbox);

    expect(result.exitCode).toBe(0);
    expect(await recordedArgs(sandbox)).toEqual([
      '-p',
      '--output-format',
      'text',
      '--model',
      'haiku',
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({ model: 'haiku' });
  });

  it('lets --model override config, and --model default passes no model flag', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);
    await writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({ roles: { explorer: { model: 'haiku' } } })
    );

    await spawn(sandbox, '--model', 'opus');
    expect(await recordedArgs(sandbox)).toContain('opus');

    const result = await spawn(sandbox, '--model', 'default');
    expect(await recordedArgs(sandbox)).not.toContain('--model');
    expect(JSON.parse(result.stdout)).toMatchObject({ model: null });
  });

  it('lets --backend claude override a config that picks pi', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);
    await writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({ defaultBackend: 'pi' })
    );

    const result = await spawn(sandbox, '--backend', 'claude');

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ backend: 'claude' });
  });

  it('runs claude in the directory gstack was run from', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox, 'pwd');
    await writeFileIn(sandbox.project, 'sub/task.md', TASK);

    const result = await runCli(
      ['spawn', '--role', 'explorer', '--brief', 'task.md'],
      sandbox,
      { cwd: 'sub' }
    );

    expect(result.exitCode).toBe(0);
    const { output } = JSON.parse(result.stdout) as { output: string };
    expect(await realpath(output)).toBe(
      await realpath(path.join(sandbox.project, 'sub'))
    );
  });
});

describe('gstack spawn report', () => {
  it('reports ok with the answer and exits 0 when claude succeeds', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox, 'printf "line one\\nline two\\n"');
    await writeTask(sandbox);

    const result = await spawn(sandbox);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.endsWith('\n')).toBe(true);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(report).sort()).toEqual(
      ['backend', 'durationMs', 'model', 'output', 'role', 'status'].sort()
    );
    expect(report).toMatchObject({
      status: 'ok',
      role: 'explorer',
      backend: 'claude',
      model: null,
      output: 'line one\nline two',
    });
    expect(Number.isInteger(report.durationMs)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports failed and exits 1 when claude exits non-zero', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox, 'echo "partial"\necho "boom" >&2\nexit 3');
    await writeTask(sandbox);

    const result = await spawn(sandbox);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      role: 'explorer',
      backend: 'claude',
      output: 'partial',
    });
    expect(result.stderr).toContain('boom');
  });

  it('kills claude, reports timeout and exits 1 when it runs past --timeout', async () => {
    const sandbox = await createSandbox();
    const marker = path.join(sandbox.home, 'still-running');
    await fakeClaude(sandbox, `sleep 3\ntouch '${marker}'`);
    await writeTask(sandbox);

    const started = Date.now();
    const result = await spawn(sandbox, '--timeout', '0.3');
    const elapsed = Date.now() - started;

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(report).toMatchObject({ status: 'timeout', role: 'explorer' });
    expect(report.durationMs).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(2500);
    // Had the child survived, it would create the marker after its sleep.
    await new Promise((resolve) => setTimeout(resolve, 3200));
    await expect(readFile(marker)).rejects.toThrow();
  }, 10_000);
  it('reports ok promptly when claude exits 0 but leaves a background job holding stdout', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox, 'echo "the answer"\n(sleep 5) &\nexit 0');
    await writeTask(sandbox);

    const started = Date.now();
    const result = await spawn(sandbox, '--timeout', '3');

    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      output: 'the answer',
    });
  }, 10_000);

  it('reports timeout close to --timeout even when a grandchild escapes the process group', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(
      sandbox,
      "perl -e 'use POSIX; POSIX::setsid(); sleep 5' &\nsleep 60"
    );
    await writeTask(sandbox);

    const started = Date.now();
    const result = await spawn(sandbox, '--timeout', '0.5');

    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'timeout' });
  }, 10_000);
});

describe('gstack spawn errors', () => {
  it('exits 2 and names the CLI to install when claude is missing', async () => {
    const sandbox = await createSandbox();
    await writeTask(sandbox);

    const result = await spawn(sandbox, '--backend', 'claude');

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("'claude'");
    expect(result.stderr).toMatch(/install/i);
    expect(result.stderr).not.toContain('--help');
  });

  it('exits 2 with a clear error for an unknown role', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);

    const result = await runCli(
      ['spawn', '--role', 'wizard', '--brief', 'task.md'],
      sandbox
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown role 'wizard'");
    expect(result.stderr).toContain('explorer');
    await expect(recordedStdin(sandbox)).rejects.toThrow();
  });

  it('exits 2 when the brief file does not exist', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);

    const result = await spawn(sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('task.md');
    await expect(recordedStdin(sandbox)).rejects.toThrow();
  });

  it.each([
    [['spawn', '--brief', 'task.md'], '--role'],
    [['spawn', '--role', 'explorer'], '--brief'],
    [
      ['spawn', '--role', 'explorer', '--brief', 'task.md', '--backend', 'gpt'],
      '--backend',
    ],
    [
      ['spawn', '--role', 'explorer', '--brief', 'task.md', '--timeout', '0'],
      '--timeout',
    ],
    [
      ['spawn', '--role', 'explorer', '--brief', 'task.md', '--timeout', 'x'],
      '--timeout',
    ],
    [['spawn', '--role', 'explorer', '--brief', 'task.md', 'extra'], 'extra'],
  ])('exits 2 for bad usage: %j', async (argv, mentioned) => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);

    const result = await runCli(argv, sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(mentioned);
  });
});
