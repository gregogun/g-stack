import {
  ConfigError,
  EXIT,
  UsageError,
  type Command,
  type Context,
} from './command.ts';
import { check } from './commands/check.ts';
import { log } from './commands/log.ts';
import { models } from './commands/models.ts';

/** Every command, in help order. To add one, append it here. */
const commands: Command[] = [models, log, check];

const help = (): string => {
  const lines = commands.flatMap((command) => [
    ...command.usage.map((usage) => `  gstack ${usage}`),
    `      ${command.summary}`,
  ]);
  return `Usage: gstack <command> [options]

A harness-neutral skill layer for coding agents.

Commands:
${lines.join('\n')}

Options:
  -h, --help  Show this help and exit

Environment:
  GSTACK_HOME  g-stack's home directory, holding user config (default: ~/.gstack)

Exit codes: 0 ok, 1 the work ran but failed, 2 bad usage or config.
`;
};

/**
 * Runs gstack with `argv` (without node and the script) and resolves to the
 * exit code. Never exits the process or touches process.* itself.
 */
export const main = async (
  argv: string[],
  context: Context
): Promise<number> => {
  const [name, ...args] = argv;
  if (name === '-h' || name === '--help') {
    context.stdout(help());
    return EXIT.ok;
  }
  if (name === undefined) {
    context.stderr(help());
    return EXIT.usage;
  }
  try {
    const command = commands.find((candidate) => candidate.name === name);
    if (!command) throw new UsageError(`unknown command '${name}'`);
    return await command.run(args, context);
  } catch (error) {
    if (error instanceof UsageError) {
      context.stderr(
        `gstack: ${error.message}\nRun 'gstack --help' for usage.\n`
      );
      return EXIT.usage;
    }
    if (error instanceof ConfigError) {
      context.stderr(`gstack: ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }
};
