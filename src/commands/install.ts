import { parseArgs } from 'node:util';
import { claudeCode } from '../adapters/claude-code.ts';
import { EXIT, UsageError, type Command } from '../command.ts';
import {
  InstallError,
  install as runInstall,
  type Adapter,
} from '../install.ts';

/** Every supported harness. To add one, append its adapter here. */
const adapters: Adapter[] = [claudeCode];

const names = () => adapters.map((adapter) => adapter.harness).join(', ');

export const install: Command = {
  name: 'install',
  usage: ['install --harness <name> [--user | --project] [--dry-run] [--json]'],
  summary: `Install g-stack into a harness (${names()}); re-running updates only g-stack's own files.`,
  run: async (args, context) => {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        options: {
          harness: { type: 'string' },
          user: { type: 'boolean' },
          project: { type: 'boolean' },
          'dry-run': { type: 'boolean' },
          json: { type: 'boolean' },
        },
        allowPositionals: true,
      });
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    const { harness, user, project, json } = parsed.values;
    const dryRun = parsed.values['dry-run'] ?? false;
    const [extra] = parsed.positionals;
    if (extra !== undefined) {
      throw new UsageError(`unexpected argument '${extra}'`);
    }
    if (harness === undefined) {
      throw new UsageError(`install needs --harness <name> (${names()})`);
    }
    const adapter = adapters.find((candidate) => candidate.harness === harness);
    if (!adapter) {
      throw new UsageError(
        `unsupported harness '${harness}'; supported: ${names()}`
      );
    }
    if (user && project) {
      throw new UsageError('pass --user or --project, not both');
    }

    let result;
    try {
      result = await runInstall(
        adapter,
        project ? 'project' : 'user',
        context,
        dryRun
      );
    } catch (error) {
      if (!(error instanceof InstallError)) throw error;
      context.stderr(`gstack: ${error.message}\n`);
      return EXIT.failed;
    }

    if (json) {
      context.stdout(`${JSON.stringify(result)}\n`);
      return EXIT.ok;
    }
    const count = (...actions: string[]) =>
      result.files.filter((file) => actions.includes(file.action)).length;
    const would = dryRun ? 'would ' : '';
    const lines = [
      `${dryRun ? 'Dry run, nothing written: ' : ''}g-stack for ${result.harness} (${result.scope}) in ${result.root}`,
      ...result.files
        .filter((file) => file.action !== 'unchanged')
        .map(
          (file) =>
            `  ${would}${file.action.padEnd(6)}  ${file.path.slice(result.root.length + 1)}`
        ),
      `${count('create', 'update')} ${dryRun ? 'would be ' : ''}written, ${count('remove')} ${dryRun ? 'would be ' : ''}removed, ${count('unchanged')} unchanged`,
    ];
    context.stdout(`${lines.join('\n')}\n`);
    return EXIT.ok;
  },
};
