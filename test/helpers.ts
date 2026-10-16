/**
 * Shared helpers for testing at the `gstack` CLI boundary.
 *
 * A test makes a sandbox (a temp g-stack home, a temp project directory and
 * an empty temp bin directory that is the whole of PATH), optionally puts
 * fake executables in the bin directory and files in the home or project,
 * then runs the CLI in-process with `runCli` and checks the exit code,
 * stdout, stderr and the files left behind.
 *
 *   const sandbox = await createSandbox();
 *   await fakeBin(sandbox, 'pi', 'echo hello');
 *   const result = await runCli(['models', 'get', 'explorer'], sandbox);
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { main } from '../src/main.ts';

export type Sandbox = {
  /** g-stack's home directory, passed to the CLI as GSTACK_HOME. */
  home: string;
  /** The project directory; the CLI runs here unless `cwd` says otherwise. */
  project: string;
  /** The only directory on PATH. Starts empty; add fakes with `fakeBin`. */
  bin: string;
};

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

/** Makes a fresh sandbox, removed after the current test. */
export const createSandbox = async (): Promise<Sandbox> => {
  const root = await mkdtemp(path.join(tmpdir(), 'gstack-test-'));
  cleanups.push(root);
  const sandbox = {
    home: path.join(root, 'home'),
    project: path.join(root, 'project'),
    bin: path.join(root, 'bin'),
  };
  await Promise.all(
    Object.values(sandbox).map((dir) => mkdir(dir, { recursive: true }))
  );
  return sandbox;
};

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RunCliOptions = {
  /** Directory to run in, relative to the project (default: the project). */
  cwd?: string;
  /** Extra environment variables, on top of GSTACK_HOME and PATH. */
  env?: Record<string, string>;
};

/** Runs the gstack CLI in-process inside `sandbox` and captures the result. */
export const runCli = async (
  argv: string[],
  sandbox: Sandbox,
  options: RunCliOptions = {}
): Promise<CliResult> => {
  let stdout = '';
  let stderr = '';
  const exitCode = await main(argv, {
    cwd: path.join(sandbox.project, options.cwd ?? ''),
    env: { GSTACK_HOME: sandbox.home, PATH: sandbox.bin, ...options.env },
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr };
};
