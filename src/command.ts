/**
 * What every gstack command is given and what it must provide. The
 * dispatcher in main.ts owns argv[0]; a command owns the rest.
 */

/** Everything a command may touch of the outside world. Tests pass fakes. */
export type Context = {
  /** The directory gstack was run from. */
  cwd: string;
  /** Environment variables (PATH, GSTACK_HOME, HOME, ...). */
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export type Command = {
  /** The word after `gstack`, e.g. `models`. */
  name: string;
  /** One usage line per form, without the leading `gstack `. */
  usage: string[];
  /** One-line description for `gstack --help`. */
  summary: string;
  /** Runs with the args after the command name; resolves to the exit code. */
  run: (args: string[], context: Context) => Promise<number>;
};

/** Exit codes shared by every command (see the spec, issue #1). */
export const EXIT = {
  ok: 0,
  /** The work ran but failed (e.g. a subagent failed or timed out). */
  failed: 1,
  /** Bad invocation or config; nothing ran. */
  usage: 2,
} as const;

/** Bad arguments. The dispatcher prints it with a pointer to --help, exit 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** Invalid config. The message names the file and field; exit 2. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}
