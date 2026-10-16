import { describe, expect, it } from 'vitest';
import {
  createSandbox,
  runCli,
  writeFileIn,
  type CliResult,
  type Sandbox,
} from './helpers.ts';

const ROUTER = 'content/skills/g/SKILL.md';

const router = `---
name: g
description: Pick the playbook that fits the task.
---

# g

Verbs are defined in [the contract](../../HARNESS.md).
Fan out with \`spawn(explorer, brief)\` and track steps with \`todo(steps)\`.
`;

const role = (sections: string[]) =>
  sections.map((section) => `## ${section}\n\nSomething.\n`).join('\n');

const ALL_SECTIONS = ['GOAL', 'SCOPE', 'CONTEXT', 'ACCEPTANCE', 'REPORT'];

/** Writes a small, valid content directory into the sandbox project. */
const writeContent = async (
  sandbox: Sandbox,
  overrides: Record<string, string | null> = {}
) => {
  const files: Record<string, string | null> = {
    'content/HARNESS.md': '# Verbs\n\n`spawn(role, brief, model?)`\n',
    [ROUTER]: router,
    'content/roles/explorer.md': role(ALL_SECTIONS),
    ...overrides,
  };
  for (const [file, text] of Object.entries(files)) {
    if (text !== null) await writeFileIn(sandbox.project, file, text);
  }
};

const check = (sandbox: Sandbox, ...args: string[]): Promise<CliResult> =>
  runCli(['check', '--content', 'content', ...args], sandbox);

describe('gstack check on the shipped content', () => {
  it('passes and reports the router size', async () => {
    const result = await runCli(['check'], await createSandbox());

    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(
      /router: .*SKILL\.md is \d+ bytes \(budget 4096\)/
    );
    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });
});

describe('gstack check on valid content', () => {
  it('passes, reporting the router size in bytes', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox);

    const result = await check(sandbox);

    expect(result.stdout).toContain(
      `router: ${ROUTER} is ${Buffer.byteLength(router)} bytes (budget 4096)`
    );
    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });

  it('ignores links to web pages and anchors', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md':
        'See [spec](https://example.com/x.md), [top](#top) and [mail](mailto:a@b.c).\n',
    });

    const result = await check(sandbox);

    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });
});

describe('gstack check on broken references', () => {
  it('fails naming the file, line and missing target', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      [ROUTER]: `${router}\nRun [explain](../../playbooks/explain.md).\n`,
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `${ROUTER}:11: broken reference '../../playbooks/explain.md'`
    );
    expect(result.stdout).toContain('1 problem');
  });

  it('checks references in playbooks and skills, ignoring the anchor', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/playbooks/explain.md':
        '# explain\n\n1. [how](../skills/how/SKILL.md#steps)\n',
      'content/skills/how/SKILL.md': 'Brief: [explorer](../../roles/nope.md)\n',
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('content/playbooks/explain.md');
    expect(result.stdout).toContain(
      "content/skills/how/SKILL.md:1: broken reference '../../roles/nope.md'"
    );
  });

  it('fails on a reference that leaves the content directory', async () => {
    const sandbox = await createSandbox();
    await writeFileIn(sandbox.project, 'outside.md', 'here\n');
    await writeContent(sandbox, {
      'content/playbooks/build.md': 'See [it](../../outside.md).\n',
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/playbooks/build.md:1: reference '../../outside.md' leaves the content directory"
    );
  });

  it('does not flag a file whose name starts with two dots', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/..notes.md': 'notes\n',
      'content/playbooks/build.md': 'See [notes](../..notes.md).\n',
    });

    const result = await check(sandbox);

    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });

  it('reports malformed percent-encoding as a broken reference', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/playbooks/build.md': 'Get [deal](50%off.md).\n',
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/playbooks/build.md:1: broken reference '50%off.md'"
    );
  });

  it('ignores links inside inline code and HTML comments', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/playbooks/build.md':
        'Write links like `[how](nope.md)`.\n<!-- [old](gone.md) -->\n<!--\n[older](gone.md)\n-->\nThen [real](missing.md).\n',
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/playbooks/build.md:6: broken reference 'missing.md'"
    );
    expect(result.stdout).toContain('1 problem');
  });

  it('fails naming the router file when there is no router', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, { [ROUTER]: null });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`${ROUTER}: router is missing`);
  });
});

describe('gstack check on harness-specific content', () => {
  it.each([
    ['Claude Code', 'Run this in Claude Code.'],
    ['Pi', 'Install the Pi extension first.'],
    ['Cursor', 'Open the project in Cursor.'],
    ['pi-coding-agent', 'Needs pi-coding-agent installed.'],
    ['.pi', 'Put it in .pi/skills.'],
    ['.cursor', 'Rules live in .cursor/rules.'],
    ['TodoWrite', 'Use TodoWrite for steps.'],
    ['Amp', 'Works in Amp too.'],
    ['Cline', 'Works in Cline too.'],
    ['Zed', 'Works in Zed too.'],
  ])('fails naming the file, line and term %s', async (term, line) => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/why/SKILL.md': `# why\n\n${line}\n`,
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `content/skills/why/SKILL.md:3: names the harness-specific term '${term}'`
    );
  });

  it('checks roles and the verb contract too', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/roles/explorer.md': `${role(ALL_SECTIONS)}\nYou run inside claude.\n`,
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/roles/explorer.md:21: names the harness-specific term 'claude'"
    );
  });

  it('does not flag words that merely contain a harness name', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md': 'Read the API and the pipeline spec.\n',
    });

    const result = await check(sandbox);

    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });

  it('does not flag ordinary words that share a name with a harness', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md':
        'Page with a database cursor.\nThe area is pi r squared.\nAmplify the amp, zed and roo.\nSee report.pdf and config.pi.\n',
    });

    const result = await check(sandbox);

    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });

  it('fails naming the file, line and verb for a non-contract verb', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/playbooks/build.md':
        '# build\n\n1. `todo(steps)`\n2. `delegate(explorer, brief)`\n',
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/playbooks/build.md:4: uses 'delegate', which is not a verb in the contract"
    );
    expect(result.stdout).toContain('1 problem');
  });

  it('checks verb calls inside fenced code blocks', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md':
        '```\nspawn(explorer, brief)\nschedule(10m)\n```\n',
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/skills/how/SKILL.md:3: uses 'schedule', which is not a verb in the contract"
    );
    expect(result.stdout).toContain('1 problem');
  });

  it('lets code examples through in language-tagged fences', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md':
        '```ts\nload(file);\nfetch(url).then(parse);\n```\n',
    });

    const result = await check(sandbox);

    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });

  it('catches capitalised verbs and a space before the parenthesis', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md':
        '1. `Spawn(explorer, brief)`\n2. `delegate (task)`\n',
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/skills/how/SKILL.md:1: uses 'Spawn', which is not a verb in the contract"
    );
    expect(result.stdout).toContain(
      "content/skills/how/SKILL.md:2: uses 'delegate', which is not a verb in the contract"
    );
  });

  it('does not treat camelCase identifiers in inline code as verbs', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md': 'Trace `handleRequest()` to its caller.\n',
    });

    const result = await check(sandbox);

    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });

  it('accepts every contract verb', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/skills/how/SKILL.md':
        '`spawn(a, b)` `todo(s)` `ask(q)` `wake(after)` `transcript(session)`\n',
    });

    const result = await check(sandbox);

    expect(result.stdout).toContain('0 problems');
    expect(result.exitCode).toBe(0);
  });
});

describe('gstack check on roles', () => {
  it('fails naming the role and each missing section', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/roles/synthesizer.md': role(['GOAL', 'SCOPE', 'CONTEXT']),
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "content/roles/synthesizer.md: role 'synthesizer' is missing section ACCEPTANCE"
    );
    expect(result.stdout).toContain(
      "content/roles/synthesizer.md: role 'synthesizer' is missing section REPORT"
    );
    expect(result.stdout).toContain('2 problems');
  });

  it('only counts a section written as a heading', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/roles/explorer.md': `${role(['GOAL', 'SCOPE', 'CONTEXT', 'ACCEPTANCE'])}\nREPORT in prose.\n`,
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "role 'explorer' is missing section REPORT"
    );
  });

  it('accepts the optional sections', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox, {
      'content/roles/explorer.md': role([
        ...ALL_SECTIONS,
        'TIMEBOX',
        'FORBIDDEN',
      ]),
    });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(0);
  });
});

describe('gstack check on the router size', () => {
  it('fails when the router exceeds the budget', async () => {
    const sandbox = await createSandbox();
    const big = `${router}\n${'word '.repeat(1000)}\n`;
    await writeContent(sandbox, { [ROUTER]: big });

    const result = await check(sandbox);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `${ROUTER}: router is ${Buffer.byteLength(big)} bytes, over the budget of 4096`
    );
  });
});

describe('gstack check usage errors', () => {
  it('exits 2 when the content directory does not exist', async () => {
    const result = await check(await createSandbox());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('content directory');
    expect(result.stderr).toContain('not found');
  });

  it('rejects unexpected arguments', async () => {
    const sandbox = await createSandbox();
    await writeContent(sandbox);

    const result = await check(sandbox, 'extra');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unexpected argument 'extra'");
  });
});
