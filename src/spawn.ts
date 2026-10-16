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
    const started = Date.now();
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
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      forceKill = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      resolve({
        status: timedOut ? 'timeout' : code === 0 ? 'ok' : 'failed',
        durationMs: Date.now() - started,
        output: stdout.trimEnd(),
      });
    });
  });
