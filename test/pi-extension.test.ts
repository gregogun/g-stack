/**
 * The pi extension, tested as installed: `gstack install --harness pi` writes
 * it into a sandbox, then the test loads that file and calls its default
 * export with a fake of the few parts of pi's extension API it uses. The
 * fake `exec` runs `gstack` through `runCli`, so the `spawn` tool is checked
 * end to end against `gstack spawn` with a fake agent CLI on PATH.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSandbox,
  fakeBin,
  runCli,
  writeFileIn,
  type Sandbox,
} from './helpers.ts';

type Tool = {
  name: string;
  parameters: { required: string[] };
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string }
  ) => Promise<{ content: { text: string }[]; details: unknown }>;
};

type Handler = (
  args: string,
  ctx: { isIdle: () => boolean; ui: { notify: (message: string) => void } }
) => Promise<void>;

type Exec = { command: string; args: string[]; cwd: string | undefined };

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
};

/**
 * Installs g-stack for pi in `sandbox`, loads the installed extension with a
 * fake pi, and returns what it registered and what it called. The fake
 * `exec` runs gstack, or returns `execResult` when given (to stand in for
 * what pi reports when it can't run gstack or kills it).
 */
const loadExtension = async (
  sandbox: Sandbox,
  commands: { name: string; source: string; sourceInfo: { path: string } }[],
  execResult?: ExecResult
) => {
  const install = await runCli(['install', '--harness', 'pi'], sandbox);
  expect(install.exitCode).toBe(0);
  const root = path.join(sandbox.home, '.pi', 'agent');
  const file = path.join(root, 'extensions', 'gstack', 'index.ts');
  const extension = (await import(pathToFileURL(file).href)) as {
    default: (pi: unknown) => void;
  };

  const tools: Tool[] = [];
  const handlers = new Map<string, Handler>();
  const sent: { content: string; options: unknown }[] = [];
  const execs: Exec[] = [];
  extension.default({
    registerTool: (tool: Tool) => tools.push(tool),
    registerCommand: (name: string, command: { handler: Handler }) =>
      handlers.set(name, command.handler),
    getCommands: () => commands,
    sendUserMessage: (content: string, options: unknown) =>
      sent.push({ content, options }),
    exec: async (
      command: string,
      args: string[],
      options: { cwd?: string } = {}
    ) => {
      execs.push({ command, args, cwd: options.cwd });
      expect(command).toBe('gstack');
      if (execResult) return execResult;
      const result = await runCli(args, sandbox, {
        cwd: path.relative(sandbox.project, options.cwd ?? sandbox.project),
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.exitCode,
      };
    },
  });
  return { root, tools, handlers, sent, execs };
};

const usePi = (sandbox: Sandbox, then = 'echo "the answer"') =>
  Promise.all([
    fakeBin(
      sandbox,
      'pi',
      [`cat > '${path.join(sandbox.home, 'pi-stdin')}'`, then].join('\n')
    ),
    writeFileIn(
      sandbox.home,
      'config.json',
      JSON.stringify({ defaultBackend: 'pi' })
    ),
  ]);

const BRIEF = 'GOAL: find where config is read.\n';

describe('the pi extension', () => {
  it('registers a spawn tool that runs gstack spawn and returns its report', async () => {
    const sandbox = await createSandbox();
    await usePi(sandbox);
    const { tools, execs } = await loadExtension(sandbox, []);

    expect(tools.map((tool) => tool.name)).toEqual(['spawn']);
    const [spawn] = tools;
    expect(spawn?.parameters.required).toEqual(['role', 'brief']);
    const result = await spawn!.execute(
      'call-1',
      { role: 'explorer', brief: BRIEF },
      undefined,
      undefined,
      { cwd: sandbox.project }
    );

    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
      status: 'ok',
      role: 'explorer',
      backend: 'pi',
      output: 'the answer',
    });
    expect(result.details).toEqual({ exitCode: 0 });
    expect(await readFile(path.join(sandbox.home, 'pi-stdin'), 'utf8')).toMatch(
      new RegExp(`\\n${BRIEF}$`)
    );
    expect(execs).toHaveLength(1);
    expect(execs[0]?.cwd).toBe(sandbox.project);
    expect(execs[0]?.args.slice(0, 4)).toEqual([
      'spawn',
      '--role',
      'explorer',
      '--brief',
    ]);
  });

  it('passes model and timeout on to gstack spawn', async () => {
    const sandbox = await createSandbox();
    await usePi(sandbox);
    const { tools, execs } = await loadExtension(sandbox, []);

    await tools[0]!.execute(
      'call-1',
      { role: 'explorer', brief: BRIEF, model: 'openai/gpt-5', timeout: 30 },
      undefined,
      undefined,
      { cwd: sandbox.project }
    );

    expect(execs[0]?.args.slice(5)).toEqual([
      '--model',
      'openai/gpt-5',
      '--timeout',
      '30',
    ]);
  });

  it('returns the report when the subagent fails', async () => {
    const sandbox = await createSandbox();
    await usePi(sandbox, 'echo "it broke" >&2; exit 3');
    const { tools } = await loadExtension(sandbox, []);

    const result = await tools[0]!.execute(
      'call-1',
      { role: 'explorer', brief: BRIEF },
      undefined,
      undefined,
      { cwd: sandbox.project }
    );

    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
      status: 'failed',
    });
    expect(result.details).toEqual({ exitCode: 1 });
  });

  it('fails the tool call when no subagent ran', async () => {
    const sandbox = await createSandbox();
    await usePi(sandbox);
    const { tools } = await loadExtension(sandbox, []);

    await expect(
      tools[0]!.execute(
        'call-1',
        { role: 'nobody', brief: BRIEF },
        undefined,
        undefined,
        { cwd: sandbox.project }
      )
    ).rejects.toThrow(/gstack spawn exited 2: .*nobody/);
  });

  it('says the spawn was aborted when pi stopped it', async () => {
    const sandbox = await createSandbox();
    // pi reports a process it killed as exit 0 with killed set.
    const { tools } = await loadExtension(sandbox, [], {
      stdout: '',
      stderr: '',
      code: 0,
      killed: true,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      tools[0]!.execute(
        'call-1',
        { role: 'explorer', brief: BRIEF },
        controller.signal,
        undefined,
        { cwd: sandbox.project }
      )
    ).rejects.toThrow(/^spawn aborted/);
  });

  it('asks whether gstack is on PATH when it printed nothing', async () => {
    const sandbox = await createSandbox();
    // What pi reports when the command can't be started.
    const { tools } = await loadExtension(sandbox, [], {
      stdout: '',
      stderr: '',
      code: 1,
    });

    await expect(
      tools[0]!.execute(
        'call-1',
        { role: 'explorer', brief: BRIEF },
        undefined,
        undefined,
        { cwd: sandbox.project }
      )
    ).rejects.toThrow(
      'gstack spawn exited 1: no output; is gstack on the PATH'
    );
  });

  it('registers /g, which sends the installed g skill and the task', async () => {
    const sandbox = await createSandbox();
    const skill = path.join(sandbox.home, '.pi', 'agent', 'skills', 'g');
    const file = path.join(skill, 'SKILL.md');
    const { handlers, sent } = await loadExtension(sandbox, [
      { name: 'skill:g', source: 'skill', sourceInfo: { path: file } },
    ]);
    const notified: string[] = [];

    await handlers.get('g')!('explain the install command', {
      isIdle: () => true,
      ui: { notify: (message) => notified.push(message) },
    });

    expect(notified).toEqual([]);
    expect(sent).toHaveLength(1);
    const { content, options } = sent[0]!;
    expect(content).toMatch(
      new RegExp(
        `^<skill name="g" location="${file}">\\nReferences are relative to ${skill}\\.\\n\\n`
      )
    );
    expect(content).not.toContain('\nname: g\n');
    expect(content).toContain('[the adapter](adapter.md)');
    expect(content).toMatch(/\n<\/skill>\n\nexplain the install command$/);
    expect(options).toBeUndefined();
  });

  it('queues /g as a follow-up while pi is busy', async () => {
    const sandbox = await createSandbox();
    const file = path.join(sandbox.home, '.pi/agent/skills/g/SKILL.md');
    const { handlers, sent } = await loadExtension(sandbox, [
      { name: 'skill:g', source: 'skill', sourceInfo: { path: file } },
    ]);

    await handlers.get('g')!('', {
      isIdle: () => false,
      ui: { notify: () => undefined },
    });

    expect(sent[0]?.content).toMatch(/<\/skill>$/);
    expect(sent[0]?.options).toEqual({ deliverAs: 'followUp' });
  });

  describe('inside a gstack subagent', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('registers nothing, so the subagent cannot fan out again', async () => {
      const sandbox = await createSandbox();
      // The extension runs inside pi, which gstack spawn starts with this set.
      vi.stubEnv('GSTACK_SUBAGENT', '1');

      const { tools, handlers } = await loadExtension(sandbox, []);

      expect(tools).toEqual([]);
      expect([...handlers.keys()]).toEqual([]);
    });
  });

  it('says so when pi has not loaded the g skill', async () => {
    const sandbox = await createSandbox();
    const { handlers, sent } = await loadExtension(sandbox, []);
    const notified: string[] = [];

    await handlers.get('g')!('a task', {
      isIdle: () => true,
      ui: { notify: (message) => notified.push(message) },
    });

    expect(sent).toEqual([]);
    expect(notified).toEqual([
      'g-stack: the g skill is not installed; run gstack install --harness pi',
    ]);
  });
});
