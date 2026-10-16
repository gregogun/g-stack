import { parseArgs } from 'node:util';
import { EXIT, UsageError, type Command } from '../command.ts';
import { resolveRole } from '../models.ts';

const get: Command['run'] = async (args, context) => {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { json: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const [role, ...extra] = parsed.positionals;
  if (role === undefined) throw new UsageError('models get needs a <role>');
  if (extra.length > 0) {
    throw new UsageError(`unexpected argument '${extra[0]}'`);
  }

  const resolved = await resolveRole(role, context);
  context.stdout(
    parsed.values.json
      ? `${JSON.stringify(resolved)}\n`
      : `role: ${resolved.role}\nbackend: ${resolved.backend}\nmodel: ${
          resolved.model ?? 'default (no model flag)'
        }\n`
  );
  return EXIT.ok;
};

export const models: Command = {
  name: 'models',
  usage: ['models get <role> [--json]'],
  summary:
    'Print the backend and model a role resolves to. "default" means no model flag.',
  run: async ([subcommand, ...args], context) => {
    if (subcommand === 'get') return get(args, context);
    throw new UsageError(
      subcommand === undefined
        ? 'models needs a subcommand: get'
        : `unknown models command '${subcommand}'`
    );
  },
};
