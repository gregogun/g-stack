import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkContent, SHIPPED_CONTENT } from '../check.ts';
import { ConfigError, EXIT, UsageError, type Command } from '../command.ts';

export const check: Command = {
  name: 'check',
  usage: ['check [--content <dir>]'],
  summary:
    'Check content: references resolve, core is harness-neutral, roles are complete, router fits its budget.',
  run: async (args, context) => {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        options: { content: { type: 'string' } },
        allowPositionals: true,
      });
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    const [extra] = parsed.positionals;
    if (extra !== undefined) {
      throw new UsageError(`unexpected argument '${extra}'`);
    }

    const contentDir = path.resolve(
      context.cwd,
      parsed.values.content ?? SHIPPED_CONTENT
    );
    const isDir = await stat(contentDir).then(
      (stats) => stats.isDirectory(),
      () => false
    );
    if (!isDir) {
      throw new ConfigError(`content directory ${contentDir} not found`);
    }

    // Paths under the current directory print relative to it, so they are
    // short and clickable; others print absolute.
    const show = (file: string) => {
      const relative = path.relative(context.cwd, file);
      return relative.startsWith('..') ? file : relative;
    };

    const { problems, router } = await checkContent(contentDir);
    const lines = [`content: ${show(contentDir)}`];
    if (router) {
      lines.push(
        `router: ${show(router.file)} is ${router.bytes} bytes (budget ${router.budget})`
      );
    }
    for (const problem of problems) {
      const at = problem.line === undefined ? '' : `:${problem.line}`;
      lines.push(`${show(problem.file)}${at}: ${problem.message}`);
    }
    lines.push(
      `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`
    );
    context.stdout(`${lines.join('\n')}\n`);
    return problems.length === 0 ? EXIT.ok : EXIT.failed;
  },
};
