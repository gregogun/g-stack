import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { EXIT, UsageError, type Command } from '../command.ts';
import {
  harnessNames,
  loadTranscript,
  TranscriptError,
} from '../transcripts.ts';

const run: Command['run'] = async (args, context) => {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        harness: { type: 'string' },
        session: { type: 'string' },
        file: { type: 'string' },
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
  const { harness, session, file } = parsed.values;
  if (harness !== undefined && !harnessNames.includes(harness)) {
    throw new UsageError(
      `unknown harness '${harness}'; use one of ${harnessNames.join(', ')}`
    );
  }
  if (file !== undefined && session !== undefined) {
    throw new UsageError('give --file or --session, not both');
  }

  try {
    const transcript = await loadTranscript(
      { harness, session, file },
      context,
      context.env.HOME || homedir()
    );
    context.stdout(`${JSON.stringify(transcript, null, 2)}\n`);
    return EXIT.ok;
  } catch (error) {
    if (!(error instanceof TranscriptError)) throw error;
    context.stderr(`gstack: ${error.message}\n`);
    return EXIT.failed;
  }
};

export const transcript: Command = {
  name: 'transcript',
  usage: [
    'transcript [--harness claude-code|pi] [--session <id> | --file <path>]',
  ],
  summary:
    "Print a session as normalised JSON (default: this directory's most recent).",
  run,
};
