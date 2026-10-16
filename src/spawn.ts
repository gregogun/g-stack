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
  /**
   * Set when gstack was asked to stop (`context.signal`) while the backend
   * ran: the reason, a signal name such as `SIGTERM`.
   */
  stopped?: string;
};

/** How long a stopped child gets after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2000;

/** How long to wait for output after the child exits. */
const CLOSE_GRACE_MS = 200;

/**
 * Runs `backend` headlessly in `context.cwd` with `prompt` on stdin. The
 * child's stderr is passed through. Past `timeoutMs`, the child's whole
 * process group is killed and the status is `timeout`. When
 * `context.signal` aborts, the whole group is killed too and the result
 * says `stopped`.
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
      // Marks the run as a subagent: gstack spawn refuses to run inside one,
      // so subagents can't fan out again.
      env: { ...context.env, GSTACK_SUBAGENT: '1' },
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
    // SIGTERM to the group now, SIGKILL to whatever is left after the grace
    // period, then resolve even if the child never reports its exit.
    const stopGroup = () => {
      killGroup('SIGTERM');
      after(KILL_GRACE_MS, () => {
        killGroup('SIGKILL');
        after(CLOSE_GRACE_MS, settle);
      });
    };

    let settled = false;
    let timedOut = false;
    let stopped: string | undefined;
    let exitCode: number | null = null;
    const finish = () => {
      settled = true;
      timers.forEach(clearTimeout);
      context.signal?.removeEventListener('abort', onAbort);
    };
    const settle = () => {
      if (settled) return;
      finish();
      // Stopped: leave nothing it started behind.
      if (stopped !== undefined) killGroup('SIGKILL');
      // A grandchild may still hold the pipes open; stop waiting for it.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        status: timedOut ? 'timeout' : exitCode === 0 ? 'ok' : 'failed',
        durationMs: Math.round(performance.now() - started),
        output: stdout.trimEnd(),
        ...(stopped === undefined ? {} : { stopped }),
      });
    };

    // gstack itself was asked to stop (pi aborting the spawn tool sends
    // SIGTERM to gstack only): take the backend's group down with it rather
    // than leave it running unparented.
    function onAbort() {
      if (settled || stopped !== undefined) return;
      stopped = String(context.signal?.reason ?? 'SIGTERM');
      clearTimeout(timeout);
      stopGroup();
    }

    const timeout = after(timeoutMs, () => {
      timedOut = true;
      stopGroup();
    });

    if (context.signal?.aborted) onAbort();
    else context.signal?.addEventListener('abort', onAbort);

    child.on('error', (error) => {
      if (settled) return;
      finish();
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
