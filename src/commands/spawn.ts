import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { backends } from '../backends/index.ts';
import { ConfigError, EXIT, UsageError, type Command } from '../command.ts';
import { isOnPath } from '../executables.ts';
import {
  BACKENDS,
  DEFAULT_MODEL,
  resolveRole,
  type Backend,
} from '../models.ts';
import { readRoleBrief } from '../roles.ts';
import { runBackend } from '../spawn.ts';

const DEFAULT_TIMEOUT_SECONDS = 600;

const parse = (args: string[]) => {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        role: { type: 'string' },
        brief: { type: 'string' },
        backend: { type: 'string' },
        model: { type: 'string' },
        timeout: { type: 'string' },
      },
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { role, brief, backend, model, timeout } = parsed.values;
  if (parsed.positionals.length > 0) {
    throw new UsageError(`unexpected argument '${parsed.positionals[0]}'`);
  }
  if (role === undefined) throw new UsageError('spawn needs --role <role>');
  if (brief === undefined) throw new UsageError('spawn needs --brief <file>');
  if (backend !== undefined && !BACKENDS.includes(backend as Backend)) {
    throw new UsageError(
      `--backend must be one of ${BACKENDS.join(', ')}, not '${backend}'`
    );
  }
  if (model === '') throw new UsageError('--model must not be empty');
  const timeoutSeconds =
    timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(timeout);
  if (!(timeoutSeconds > 0) || !Number.isFinite(timeoutSeconds)) {
    throw new UsageError(
      `--timeout must be a positive number of seconds, not '${timeout}'`
    );
  }
  return {
    role,
    brief,
    backend: backend as Backend | undefined,
    model,
    timeoutMs: Math.round(timeoutSeconds * 1000),
  };
};

export const spawn: Command = {
  name: 'spawn',
  usage: [
    'spawn --role <role> --brief <file> [--backend <backend>] [--model <model>] [--timeout <seconds>]',
  ],
  summary:
    'Run a subagent with a role and task brief; print its report as JSON.',
  run: async (args, context) => {
    const options = parse(args);
    // runBackend marks every subagent with GSTACK_SUBAGENT; one level only.
    if (context.env.GSTACK_SUBAGENT) {
      throw new ConfigError(
        "already inside a g-stack subagent (GSTACK_SUBAGENT is set); subagents can't spawn more subagents, so do the work yourself"
      );
    }

    const roleBrief = await readRoleBrief(options.role);
    const briefFile = path.resolve(context.cwd, options.brief);
    let taskBrief: string;
    try {
      taskBrief = await readFile(briefFile, 'utf8');
    } catch (error) {
      throw new UsageError(
        `cannot read brief ${options.brief}: ${(error as Error).message}`
      );
    }

    const resolved = await resolveRole(options.role, context);
    const backendName = options.backend ?? resolved.backend;
    const model =
      options.model === undefined
        ? resolved.model
        : options.model === DEFAULT_MODEL
          ? null
          : options.model;

    const backend = backends[backendName];
    if (!backend) {
      throw new UsageError(
        `backend '${backendName}' is not supported by spawn yet; use --backend ${Object.keys(backends).join(' or ')}`
      );
    }
    if (!(await isOnPath(backend.executable, context.env))) {
      throw new ConfigError(
        `backend '${backendName}' needs the '${backend.executable}' CLI on PATH; ${backend.installHint}`
      );
    }

    let result;
    try {
      result = await runBackend(
        backend,
        model,
        `${roleBrief}\n${taskBrief}`,
        options.timeoutMs,
        context
      );
    } catch (error) {
      throw new ConfigError(
        `could not start the '${backend.executable}' CLI: ${(error as Error).message}`
      );
    }
    // Stopped by a signal: no report, exit as if killed by it.
    if (result.stopped !== undefined) {
      return (
        128 + (os.constants.signals[result.stopped as NodeJS.Signals] ?? 15)
      );
    }
    const report = {
      status: result.status,
      role: options.role,
      backend: backendName,
      model,
      durationMs: result.durationMs,
      output: result.output,
    };
    context.stdout(`${JSON.stringify(report)}\n`);
    return result.status === 'ok' ? EXIT.ok : EXIT.failed;
  },
};
