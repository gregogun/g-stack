/**
 * The decision log: one JSON object per line in
 * <project root>/.gstack/decisions.jsonl. JSON escaping keeps tabs and
 * newlines inside a field from breaking a row. See docs/decision-log.md.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT, UsageError, type Command, type Context } from '../command.ts';
import { projectRoot } from '../project.ts';

/** The fields a caller supplies, in row order; `time` comes first. */
const FIELDS = ['step', 'decision', 'reason', 'evidence', 'result'] as const;
type Field = (typeof FIELDS)[number];
type Entry = { time: string } & Record<Field, string>;

/** Fields that must not be empty; the rest may be "" but must be given. */
const NON_EMPTY: readonly Field[] = ['step', 'decision'];

const logFile = (context: Context): string =>
  path.join(projectRoot(context.cwd), '.gstack', 'decisions.jsonl');

const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' &&
  value !== null &&
  ['time', ...FIELDS].every(
    (field) => typeof (value as Record<string, unknown>)[field] === 'string'
  );

/** Reads every row, or null (after reporting) if one is unreadable. */
const readEntries = async (
  file: string,
  context: Context
): Promise<Entry[] | null> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries: Entry[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    if (!isEntry(value)) {
      context.stderr(`gstack: ${file}:${index + 1}: not a decision log row\n`);
      return null;
    }
    entries.push(value);
  }
  return entries;
};

const LABEL_WIDTH = 'decision: '.length;

const formatEntry = (entry: Entry): string =>
  [
    `${entry.time}  ${entry.step}`,
    ...(['decision', 'reason', 'evidence', 'result'] as const).map(
      (field) =>
        `  ${`${field}:`.padEnd(LABEL_WIDTH)}${entry[field]
          .split(/\r?\n/)
          .join(`\n  ${' '.repeat(LABEL_WIDTH)}`)}`
    ),
  ].join('\n') + '\n';

const show = async (json: boolean, context: Context): Promise<number> => {
  const entries = await readEntries(logFile(context), context);
  if (entries === null) return EXIT.failed;
  context.stdout(
    json ? `${JSON.stringify(entries)}\n` : entries.map(formatEntry).join('\n')
  );
  return EXIT.ok;
};

const append = async (
  values: Partial<Record<Field, string>>,
  context: Context
): Promise<number> => {
  const missing = FIELDS.filter((field) => values[field] === undefined);
  if (missing.length > 0) {
    throw new UsageError(
      `log needs ${missing.map((field) => `--${field}`).join(', ')}`
    );
  }
  const empty = NON_EMPTY.find((field) => values[field] === '');
  if (empty) throw new UsageError(`--${empty} must not be empty`);

  const row = {
    time: new Date().toISOString(),
    ...Object.fromEntries(FIELDS.map((field) => [field, values[field]])),
  };
  const file = logFile(context);
  await mkdir(path.dirname(file), { recursive: true });
  // One write per row so concurrent appends don't interleave mid-row.
  await appendFile(file, `${JSON.stringify(row)}\n`);
  return EXIT.ok;
};

export const log: Command = {
  name: 'log',
  usage: [
    'log --step <id> --decision <text> --reason <text> --evidence <text> --result <text>',
    'log --show [--json]',
  ],
  summary:
    "Append a decision to the project's decision log, or print the log with --show.",
  run: async (args, context) => {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        options: {
          ...Object.fromEntries(
            FIELDS.map((field) => [field, { type: 'string' as const }])
          ),
          show: { type: 'boolean' },
          json: { type: 'boolean' },
        },
        allowPositionals: true,
      });
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    const [extra] = parsed.positionals;
    if (extra !== undefined) {
      throw new UsageError(`unexpected argument '${extra}'`);
    }
    const values = parsed.values as Partial<Record<Field, string>> & {
      show?: boolean;
      json?: boolean;
    };
    const given = FIELDS.filter((field) => values[field] !== undefined);

    if (values.show) {
      if (given.length > 0) {
        throw new UsageError(`--show takes no --${given[0]}`);
      }
      return show(values.json === true, context);
    }
    if (values.json) throw new UsageError('--json needs --show');
    return append(values, context);
  },
};
