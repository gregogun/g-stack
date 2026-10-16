import { spawn as spawnProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

type AgentCli = 'claude' | 'pi';

/**
 * A fake agent CLI `name` that records its args (one per line) and stdin into
 * the sandbox, then runs `then` (by default: print an answer and exit 0).
 */
const fakeAgent = (
  sandbox: Sandbox,
  name: AgentCli,
  then = 'echo "the answer"'
): Promise<string> =>
  fakeBin(
    sandbox,
    name,
    [
      `printf '%s\\n' "$@" > '${path.join(sandbox.home, `${name}-args`)}'`,
      `cat > '${path.join(sandbox.home, `${name}-stdin`)}'`,
      then,
    ].join('\n')
  );

const fakeClaude = (sandbox: Sandbox, then?: string) =>
  fakeAgent(sandbox, 'claude', then);

const fakePi = (sandbox: Sandbox, then?: string) =>
  fakeAgent(sandbox, 'pi', then);

const recordedArgs = async (
  sandbox: Sandbox,
  name: AgentCli = 'claude'
): Promise<string[]> =>
  (await readFile(path.join(sandbox.home, `${name}-args`), 'utf8'))
    .split('\n')
    .slice(0, -1);

const recordedStdin = (
  sandbox: Sandbox,
  name: AgentCli = 'claude'
): Promise<string> =>
  readFile(path.join(sandbox.home, `${name}-stdin`), 'utf8');

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

describe('gstack spawn with the pi backend', () => {
  it('passes the role brief then the task brief to pi unchanged', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox);
    await writeTask(sandbox);

    const result = await spawn(sandbox, '--backend', 'pi');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(await recordedStdin(sandbox, 'pi')).toBe(
      `${explorerBrief}\n${TASK}`
    );
  });

  it('runs pi in print mode without saving a session, and no model flag for the default model', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox);
    await writeTask(sandbox);

    await spawn(sandbox, '--backend', 'pi');

    expect(await recordedArgs(sandbox, 'pi')).toEqual(['-p', '--no-session']);
  });

  it('passes the resolved model from config to pi as --model, unchanged', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox);
    await writeTask(sandbox);
    await writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({
        roles: { explorer: { backend: 'pi', model: 'openai/gpt-5:high' } },
      })
    );

    const result = await spawn(sandbox);

    expect(result.exitCode).toBe(0);
    expect(await recordedArgs(sandbox, 'pi')).toEqual([
      '-p',
      '--no-session',
      '--model',
      'openai/gpt-5:high',
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      backend: 'pi',
      model: 'openai/gpt-5:high',
    });
  });

  it('lets --model override config, and --model default passes no model flag', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox);
    await writeTask(sandbox);
    await writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({ roles: { explorer: { backend: 'pi', model: 'haiku' } } })
    );

    await spawn(sandbox, '--model', 'sonnet');
    expect(await recordedArgs(sandbox, 'pi')).toEqual([
      '-p',
      '--no-session',
      '--model',
      'sonnet',
    ]);

    const result = await spawn(sandbox, '--model', 'default');
    expect(await recordedArgs(sandbox, 'pi')).toEqual(['-p', '--no-session']);
    expect(JSON.parse(result.stdout)).toMatchObject({ model: null });
  });

  it('runs pi when config sets it as the default backend', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox);
    await fakeClaude(sandbox);
    await writeTask(sandbox);
    await writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({ defaultBackend: 'pi' })
    );

    const result = await spawn(sandbox);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ backend: 'pi' });
    expect(await recordedStdin(sandbox, 'pi')).toBe(
      `${explorerBrief}\n${TASK}`
    );
    await expect(recordedStdin(sandbox, 'claude')).rejects.toThrow();
  });

  it('runs pi by default when pi is on PATH, even with claude there too', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox);
    await fakeClaude(sandbox);
    await writeTask(sandbox);

    const result = await spawn(sandbox);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ backend: 'pi' });
    await expect(recordedStdin(sandbox, 'claude')).rejects.toThrow();
  });

  it('lets --backend pi override a config that picks claude', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox);
    await fakeClaude(sandbox);
    await writeTask(sandbox);
    await writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({ defaultBackend: 'claude' })
    );

    const result = await spawn(sandbox, '--backend', 'pi');

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ backend: 'pi' });
    await expect(recordedStdin(sandbox, 'claude')).rejects.toThrow();
  });

  it("reports ok with pi's answer and exits 0", async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox, 'printf "line one\\nline two\\n"');
    await writeTask(sandbox);

    const result = await spawn(sandbox, '--backend', 'pi');

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      role: 'explorer',
      backend: 'pi',
      model: null,
      output: 'line one\nline two',
    });
  });

  it('reports failed and exits 1 when pi exits non-zero', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox, 'echo "Request error" >&2\nexit 1');
    await writeTask(sandbox);

    const result = await spawn(sandbox, '--backend', 'pi');

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      backend: 'pi',
      output: '',
    });
    expect(result.stderr).toContain('Request error');
  });

  it('kills pi, reports timeout and exits 1 when it runs past --timeout', async () => {
    const sandbox = await createSandbox();
    await fakePi(sandbox, 'sleep 30');
    await writeTask(sandbox);

    const started = Date.now();
    const result = await spawn(sandbox, '--backend', 'pi', '--timeout', '0.3');

    expect(Date.now() - started).toBeLessThan(2500);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'timeout',
      backend: 'pi',
    });
  }, 10_000);

  it('exits 2 and says how to install pi when it is missing', async () => {
    const sandbox = await createSandbox();
    await fakeClaude(sandbox);
    await writeTask(sandbox);

    const result = await spawn(sandbox, '--backend', 'pi');

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("'pi'");
    expect(result.stderr).toContain(
      'npm install -g @earendil-works/pi-coding-agent'
    );
    await expect(recordedStdin(sandbox, 'claude')).rejects.toThrow();
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

  it('reports ok when claude exits just before --timeout while a background job holds stdout', async () => {
    const sandbox = await createSandbox();
    await fakeBin(sandbox, 'claude', '(sleep 3) &\nsleep 0.3\necho done');
    await writeTask(sandbox);

    // Process startup time varies by machine, so first measure when the
    // child exits: with stdout held open, the report comes 200ms after. The
    // first run is slower than the rest, so measure the second.
    await spawn(sandbox, '--timeout', '5');
    const calibration = await spawn(sandbox, '--timeout', '5');
    const { durationMs } = JSON.parse(calibration.stdout) as {
      durationMs: number;
    };
    const exitMs = durationMs - 200;

    // Then time out 100ms after that exit, while spawn still waits for output.
    const result = await spawn(
      sandbox,
      '--timeout',
      String((exitMs + 100) / 1000)
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      output: 'done',
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

/** Whether a process with this pid is still running. */
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (check: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('gstack spawn stopped by a signal', () => {
  // Signals need a real gstack process, so this runs the CLI as one (with
  // the same sandboxed environment runCli gives it).
  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
    ['SIGHUP', 129],
  ] as const)(
    'stops the backend and everything it started on %s, then exits %i',
    async (signal, code) => {
      const sandbox = await createSandbox();
      const pidFile = path.join(sandbox.home, 'sleep-pid');
      await fakeBin(
        sandbox,
        'claude',
        `cat > /dev/null\nsleep 30 &\necho $! > '${pidFile}'\nwait`
      );
      await writeTask(sandbox);
      const gstack = spawnProcess(
        process.execPath,
        [
          fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
          'spawn',
          '--role',
          'explorer',
          '--brief',
          'task.md',
        ],
        {
          cwd: sandbox.project,
          env: {
            GSTACK_HOME: sandbox.home,
            HOME: sandbox.home,
            PATH: [sandbox.bin, '/usr/bin', '/bin'].join(path.delimiter),
          },
          stdio: 'ignore',
        }
      );
      const exited = new Promise<number | null>((resolve) =>
        gstack.on('exit', (exitCode) => resolve(exitCode))
      );
      await waitFor(() => existsSync(pidFile));
      const backend = Number(await readFile(pidFile, 'utf8'));
      expect(isRunning(backend)).toBe(true);

      gstack.kill(signal);

      expect(await exited).toBe(code);
      await waitFor(() => !isRunning(backend), 1000);
    },
    15_000
  );
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
