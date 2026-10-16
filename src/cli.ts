#!/usr/bin/env node
import os from 'node:os';
import { main } from './main.ts';

/** How long a command gets to wind down after a stop signal. */
const STOP_GRACE_MS = 5000;

// A stop signal aborts the context's signal so a running command can clean
// up (spawn takes its backend down) and return; a second one, or a command
// that doesn't return in time, exits at once with 128 + the signal number.
const controller = new AbortController();
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  const code = 128 + os.constants.signals[name];
  process.on(name, () => {
    if (controller.signal.aborted) process.exit(code);
    controller.abort(name);
    setTimeout(() => process.exit(code), STOP_GRACE_MS).unref();
  });
}

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  signal: controller.signal,
});
