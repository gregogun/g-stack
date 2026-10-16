/**
 * The g-stack extension for pi. `gstack install --harness pi` installs it as
 * `extensions/gstack/index.ts` in pi's config directory, where pi discovers
 * and loads it (with jiti, so no build step).
 *
 * A thin wrapper, adding the two things pi lacks:
 * - a `spawn` tool that runs `gstack spawn` and returns its report;
 * - a `/g` command that starts the g skill (the router), like `/skill:g`.
 *
 * It imports nothing from pi: the few parts of pi's extension API it uses are
 * typed locally below (see docs/install.md for where each comes from).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  details: Record<string, unknown>;
};

type SpawnParams = {
  role: string;
  brief: string;
  model?: string;
  timeout?: number;
};

type Notify = (message: string, type?: 'info' | 'warning' | 'error') => void;

/** The parts of pi's `ExtensionAPI` this extension uses. */
type ExtensionAPI = {
  registerTool: (tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: object;
    execute: (
      toolCallId: string,
      params: SpawnParams,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: { cwd: string }
    ) => Promise<ToolResult>;
  }) => void;
  registerCommand: (
    name: string,
    command: {
      description?: string;
      handler: (
        args: string,
        ctx: { isIdle: () => boolean; ui: { notify: Notify } }
      ) => Promise<void>;
    }
  ) => void;
  getCommands: () => {
    name: string;
    source: string;
    sourceInfo: { path: string };
  }[];
  sendUserMessage: (
    content: string,
    options?: { deliverAs?: 'steer' | 'followUp' }
  ) => void;
  exec: (
    command: string,
    args: string[],
    options?: { signal?: AbortSignal; cwd?: string }
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
};

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export default function gstack(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'spawn',
    label: 'Spawn',
    description:
      'Run a g-stack subagent in its own context with `gstack spawn`. The subagent sees the role brief (roles/<role>.md) followed by `brief`, and nothing else from this session. Returns the JSON report: {status, role, backend, model, durationMs, output}; `output` is the subagent’s final answer.',
    promptSnippet: 'Run a g-stack subagent with a role and a task brief',
    promptGuidelines: [
      'Use spawn when a g-stack skill calls `spawn(role, brief)`. Several spawn calls in one message run in parallel.',
    ],
    parameters: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'The role to run, e.g. explorer or synthesizer.',
        },
        brief: {
          type: 'string',
          description:
            'The task brief, with the sections GOAL, SCOPE, CONTEXT, ACCEPTANCE and REPORT.',
        },
        model: {
          type: 'string',
          description:
            'Overrides the model configured for the role. Leave it out to use the configured one.',
        },
        timeout: {
          type: 'number',
          description: 'Seconds before the subagent is stopped (default 600).',
        },
      },
      required: ['role', 'brief'],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'gstack-brief-'));
      try {
        const brief = path.join(dir, 'brief.md');
        await writeFile(brief, params.brief);
        const args = ['spawn', '--role', params.role, '--brief', brief];
        if (params.model !== undefined) args.push('--model', params.model);
        if (params.timeout !== undefined) {
          args.push('--timeout', String(params.timeout));
        }
        const result = await pi.exec('gstack', args, { signal, cwd: ctx.cwd });
        const report = result.stdout.trim();
        // Exit 0 and 1 both print a report; its status says ok, failed or
        // timeout. Anything else means no subagent ran.
        if ((result.code !== 0 && result.code !== 1) || report === '') {
          throw new Error(
            `gstack spawn exited ${result.code}: ${result.stderr.trim() || 'no report'}`
          );
        }
        return {
          content: [{ type: 'text', text: report }],
          details: { exitCode: result.code },
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  });

  pi.registerCommand('g', {
    description: 'Start any task with g-stack: /g <task>',
    handler: async (args, ctx) => {
      const skill = pi
        .getCommands()
        .find(
          (command) => command.source === 'skill' && command.name === 'skill:g'
        );
      if (skill === undefined) {
        ctx.ui.notify(
          'g-stack: the g skill is not installed; run gstack install --harness pi',
          'error'
        );
        return;
      }
      // The same message pi builds for /skill:g (sendUserMessage doesn't
      // expand skill commands itself).
      const file = skill.sourceInfo.path;
      const body = (await readFile(file, 'utf8')).replace(FRONTMATTER, '');
      const block = `<skill name="g" location="${file}">\nReferences are relative to ${path.dirname(file)}.\n\n${body.trim()}\n</skill>`;
      const task = args.trim();
      pi.sendUserMessage(
        task === '' ? block : `${block}\n\n${task}`,
        ctx.isIdle() ? undefined : { deliverAs: 'followUp' }
      );
    },
  });
}
