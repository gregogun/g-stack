/**
 * Runs one subagent on a backend CLI and turns the result into a report.
 */
import { spawn } from 'node:child_process';
import type { BackendCli } from './backends/index.ts';
import type { Context } from './command.ts';

export type RunResult = {
  status: 'ok' | 'failed' | 'timeout';
  durationMs: number;
  /** The backend's stdout, without trailing whitespace. */
  output: string;
};

/** How long a timed-out child gets after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2000;

/** How long to wait for output after the child exits. */
const CLOSE_GRACE_MS = 200;

/**
 * Runs `backend` headlessly in `context.cwd` with `prompt` on stdin. The
 * child's stderr is passed through. Past `timeoutMs`, the child's whole
 * process group is killed and the status is `timeout`.
 */
export const runBackend = (
  backend: BackendCli,
  model: string | null,
  prompt: string,
  timeoutMs: number,
  context: Context
): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    // Its own process group, so a timeout kills anything it started too.
    const child = spawn(backend.executable, backend.args(model), {
      cwd: context.cwd,
      env: context.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      context.stderr(chunk);
    });
    // A child that exits without reading all of stdin is reported by its
    // exit status, not by a broken pipe here.
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    };

    const timers = new Set<NodeJS.Timeout>();
    const after = (ms: number, fn: () => void): NodeJS.Timeout => {
      const timer = setTimeout(fn, ms);
      timers.add(timer);
      return timer;
    };
    let settled = false;
    let timedOut = false;
    let exitCode: number | null = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      // A grandchild may still hold the pipes open; stop waiting for it.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        status: timedOut ? 'timeout' : exitCode === 0 ? 'ok' : 'failed',
        durationMs: Math.round(performance.now() - started),
        output: stdout.trimEnd(),
      });
    };

    const timeout = after(timeoutMs, () => {
      timedOut = true;
      killGroup('SIGTERM');
      after(KILL_GRACE_MS, () => {
        killGroup('SIGKILL');
        // Resolve even if the child never reports its exit.
        after(CLOSE_GRACE_MS, settle);
      });
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      reject(error);
    });
    // Settle on exit, not close: a background job the child left behind can
    // keep stdout open long after the child is done. Give close a moment to
    // collect the last output, then stop waiting.
    child.on('exit', (code) => {
      exitCode = code;
      // It finished in time; don't let the timeout fire while waiting.
      clearTimeout(timeout);
      after(CLOSE_GRACE_MS, settle);
    });
    child.on('close', settle);
  });
