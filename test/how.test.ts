import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandbox, fakeBin, runCli, writeFileIn } from './helpers.ts';

const LINK = /\]\(([^)\s]+)\)/g;

/** Installs for the user and returns the installed g skill directory. */
const installG = async () => {
  const sandbox = await createSandbox();
  const result = await runCli(['install', '--harness', 'claude-code'], sandbox);
  expect(result.exitCode).toBe(0);
  return path.join(sandbox.home, '.claude', 'skills', 'g');
};

/** The files `file` links to, resolved, keeping only those matching `pick`. */
const linksFrom = async (file: string, pick: RegExp): Promise<string[]> => {
  const text = await readFile(file, 'utf8');
  return [...text.matchAll(LINK)]
    .map(([, target = '']) => target.split('#')[0] ?? '')
    .filter((target) => pick.test(target))
    .map((target) => path.resolve(path.dirname(file), target));
};

/** The text under the `## <heading>` section of `text`. */
const section = (text: string, heading: string): string =>
  text.split(new RegExp(`^## ${heading}$`, 'm'))[1]?.split(/^## /m)[0] ?? '';

describe('the how workflow, as installed', () => {
  it('reaches the explain playbook, the how skill and both roles from the router', async () => {
    const g = await installG();

    const [playbook] = await linksFrom(
      path.join(g, 'SKILL.md'),
      /playbooks\/explain\.md$/
    );
    expect(playbook).toBe(path.join(g, 'playbooks', 'explain.md'));
    expect(existsSync(playbook ?? '')).toBe(true);

    const [how] = await linksFrom(playbook ?? '', /skills\/how\/SKILL\.md$/);
    expect(how).toBe(path.join(g, 'skills', 'how', 'SKILL.md'));
    expect(existsSync(how ?? '')).toBe(true);

    const roles = await linksFrom(how ?? '', /roles\/\w+\.md$/);
    expect(roles).toContain(path.join(g, 'roles', 'explorer.md'));
    expect(roles).toContain(path.join(g, 'roles', 'synthesizer.md'));
    for (const role of roles) expect(existsSync(role), role).toBe(true);
  });

  it('gives every explain step a unique, stable id for the todo list', async () => {
    const g = await installG();
    const playbook = await readFile(
      path.join(g, 'playbooks', 'explain.md'),
      'utf8'
    );

    const steps = section(playbook, 'Steps')
      .split('\n')
      .filter((line) => /^\d+\. /.test(line));
    const ids = steps.map((line) => /^\d+\. `(explain\.[a-z-]+)`/.exec(line));
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (const [index, id] of ids.entries()) {
      expect(id, steps[index]).not.toBeNull();
    }
    const unique = new Set(ids.map((id) => id?.[1]));
    expect(unique.size).toBe(steps.length);

    const router = await readFile(path.join(g, 'SKILL.md'), 'utf8');
    expect(router).toMatch(/steps, with their ids,.*`todo\(steps\)`/s);
  });

  it('asks the synthesizer to label every claim and name the source of measured ones', async () => {
    const g = await installG();
    const role = await readFile(
      path.join(g, 'roles', 'synthesizer.md'),
      'utf8'
    );

    for (const label of ['measured', 'inferred', 'guess']) {
      expect(section(role, 'ACCEPTANCE')).toContain(label);
      expect(section(role, 'REPORT')).toContain(label);
    }
    expect(section(role, 'ACCEPTANCE')).toMatch(/measured.*(read|ran)/s);
  });
});

describe('gstack spawn --role synthesizer', () => {
  it('runs the shipped synthesizer brief followed by the task brief', async () => {
    const sandbox = await createSandbox();
    const stdin = path.join(sandbox.home, 'claude-stdin');
    await fakeBin(sandbox, 'claude', `cat > '${stdin}'\necho "the synthesis"`);
    const task = '## GOAL\n\nCombine the explorer reports below.\n';
    await writeFileIn(sandbox.project, 'task.md', task);

    const result = await runCli(
      ['spawn', '--role', 'synthesizer', '--brief', 'task.md'],
      sandbox
    );

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      role: 'synthesizer',
      output: 'the synthesis',
    });
    const brief = await readFile(
      new URL('../content/roles/synthesizer.md', import.meta.url),
      'utf8'
    );
    expect(await readFile(stdin, 'utf8')).toBe(`${brief}\n${task}`);
  });
});
