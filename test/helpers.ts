/**
 * Shared helpers for testing at the `gstack` CLI boundary.
 *
 * A test makes a sandbox (a temp g-stack home, a temp project directory that
 * is a git root, and an empty temp bin directory that comes first on PATH,
 * followed only by the system /usr/bin and /bin), optionally puts
 * fake executables in the bin directory and files in the home or project,
 * then runs the CLI in-process with `runCli` and checks the exit code,
 * stdout, stderr and the files left behind.
 *
 *   const sandbox = await createSandbox();
 *   await fakeBin(sandbox, 'pi', 'echo hello');
 *   const result = await runCli(['models', 'get', 'explorer'], sandbox);
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { main } from '../src/main.ts';

export type Sandbox = {
  /** g-stack's home directory, passed to the CLI as GSTACK_HOME. */
  home: string;
  /** The project directory; the CLI runs here unless `cwd` says otherwise. */
  project: string;
  /**
   * First on PATH, before only /usr/bin and /bin (so fakes can use system
   * tools like cat and env). Starts empty; add fakes with `fakeBin`.
   */
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
  // Make the project a git root so config lookup never climbs out of the
  // sandbox into the real machine.
  await mkdir(path.join(sandbox.project, '.git'));
  return sandbox;
};

/** Writes `content` to `file` (relative to `dir`), creating parent dirs. */
export const writeFileIn = async (
  dir: string,
  file: string,
  content: string
): Promise<string> => {
  const target = path.join(dir, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
};

/**
 * Puts an executable `name` on the sandbox's PATH that runs `script` with
 * /bin/sh, e.g. `fakeBin(sandbox, 'pi', 'echo "$@" > args.txt')`.
 */
export const fakeBin = async (
  sandbox: Sandbox,
  name: string,
  script = 'exit 0'
): Promise<string> => {
  const file = await writeFileIn(sandbox.bin, name, `#!/bin/sh\n${script}\n`);
  await chmod(file, 0o755);
  return file;
};

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RunCliOptions = {
  /** Directory to run in, relative to the project (default: the project). */
  cwd?: string;
  /** Extra environment variables, on top of GSTACK_HOME, HOME and PATH. */
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
    env: {
      GSTACK_HOME: sandbox.home,
      // Keep anything found under ~ (e.g. harness session files) inside the
      // sandbox rather than the real home directory.
      HOME: sandbox.home,
      PATH: [sandbox.bin, '/usr/bin', '/bin'].join(path.delimiter),
      ...options.env,
    },
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr };
};
