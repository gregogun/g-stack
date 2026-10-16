import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandbox, runCli, writeFileIn, type Sandbox } from './helpers.ts';

const userSkills = (sandbox: Sandbox) =>
  path.join(sandbox.home, '.claude', 'skills');

const projectSkills = (sandbox: Sandbox) =>
  path.join(sandbox.project, '.claude', 'skills');

const install = (sandbox: Sandbox, ...args: string[]) =>
  runCli(['install', '--harness', 'claude-code', ...args], sandbox);

/** Every file under `dir`, relative to it, with its content and mtime. */
const snapshot = async (dir: string) => {
  if (!existsSync(dir)) return {};
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: Record<string, { text: string; mtimeMs: number }> = {};
  for (const entry of entries.filter((e) => e.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, file)] = {
      text: await readFile(file, 'utf8'),
      mtimeMs: (await stat(file)).mtimeMs,
    };
  }
  return files;
};

type InstallJson = {
  harness: string;
  scope: string;
  root: string;
  dryRun: boolean;
  files: { path: string; action: string }[];
};

const installJson = async (sandbox: Sandbox, ...args: string[]) => {
  const result = await install(sandbox, '--json', ...args);
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as InstallJson;
};

const LINK = /\]\(([^)\s]+)\)/g;

describe('gstack install --harness claude-code', () => {
  it('installs the router as the g skill under the sandbox home by default', async () => {
    const sandbox = await createSandbox();

    const result = await install(sandbox);

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const g = path.join(userSkills(sandbox), 'g');
    const router = await readFile(path.join(g, 'SKILL.md'), 'utf8');
    expect(router).toMatch(/^---\nname: g\n/);
    expect(existsSync(path.join(g, 'HARNESS.md'))).toBe(true);
    expect(existsSync(path.join(g, 'roles', 'explorer.md'))).toBe(true);
    expect(existsSync(path.join(g, 'adapter.md'))).toBe(true);
    expect(result.stdout).toContain(g);
    expect(result.stdout).toMatch(/create\s+SKILL\.md/);
    expect(result.stdout).toMatch(/\d+ written, 0 removed, 0 unchanged/);
    // Only the g skill: hidden content is never a top-level skill.
    expect(await readdir(userSkills(sandbox))).toEqual(['g']);
  });

  it('keeps every relative link in the installed files working', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);

    const g = path.join(userSkills(sandbox), 'g');
    const router = await readFile(path.join(g, 'SKILL.md'), 'utf8');
    expect(router).toContain('[the verb contract](HARNESS.md)');
    const harness = await readFile(path.join(g, 'HARNESS.md'), 'utf8');
    expect(harness).toContain('](adapter.md)');

    const files = Object.keys(await snapshot(g)).filter((f) =>
      f.endsWith('.md')
    );
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      const text = await readFile(path.join(g, file), 'utf8');
      for (const [, target = ''] of text.matchAll(LINK)) {
        if (/^(?:[a-z]+:|#)/.test(target)) continue;
        const resolved = path.resolve(
          path.dirname(path.join(g, file)),
          decodeURI(target.split('#')[0] ?? '')
        );
        expect(existsSync(resolved), `${file} -> ${target}`).toBe(true);
      }
    }
  });

  it('installs under CLAUDE_CONFIG_DIR when it is set', async () => {
    const sandbox = await createSandbox();
    const config = path.join(sandbox.home, 'claude-config');

    const result = await runCli(
      ['install', '--harness', 'claude-code'],
      sandbox,
      { env: { CLAUDE_CONFIG_DIR: config } }
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(config, 'skills', 'g', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(sandbox.home, '.claude'))).toBe(false);
  });

  it('exits 2 when neither CLAUDE_CONFIG_DIR nor HOME is set', async () => {
    const sandbox = await createSandbox();

    const result = await runCli(
      ['install', '--harness', 'claude-code'],
      sandbox,
      { env: { HOME: '' } }
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/CLAUDE_CONFIG_DIR|HOME/);
    expect(await snapshot(sandbox.home)).toEqual({});
  });

  it('installs into the project with --project and leaves home alone', async () => {
    const sandbox = await createSandbox();

    const json = await installJson(sandbox, '--project');

    expect(json.scope).toBe('project');
    expect(json.root).toBe(path.join(projectSkills(sandbox), 'g'));
    expect(existsSync(path.join(projectSkills(sandbox), 'g', 'SKILL.md'))).toBe(
      true
    );
    expect(await snapshot(sandbox.home)).toEqual({});
  });

  it('finds the project root from a subdirectory', async () => {
    const sandbox = await createSandbox();
    await writeFileIn(sandbox.project, 'src/keep.txt', '');

    const result = await runCli(
      ['install', '--harness', 'claude-code', '--project'],
      sandbox,
      { cwd: 'src' }
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(projectSkills(sandbox), 'g', 'SKILL.md'))).toBe(
      true
    );
  });

  it('changes nothing when run twice', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);
    const before = await snapshot(userSkills(sandbox));

    const result = await install(sandbox);
    const json = await installJson(sandbox);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/0 written, 0 removed, \d+ unchanged/);
    expect(json.files.every((file) => file.action === 'unchanged')).toBe(true);
    expect(await snapshot(userSkills(sandbox))).toEqual(before);
  });

  it('lists what it would write with --dry-run and writes nothing', async () => {
    const sandbox = await createSandbox();

    const result = await install(sandbox, '--dry-run');
    const json = await installJson(sandbox, '--dry-run');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/would create\s+SKILL\.md/);
    expect(result.stdout).toMatch(/would create\s+HARNESS\.md/);
    expect(json.dryRun).toBe(true);
    expect(json.files).toContainEqual({
      path: path.join(userSkills(sandbox), 'g', 'SKILL.md'),
      action: 'create',
    });
    expect(await snapshot(sandbox.home)).toEqual({});
  });

  it('updates its own files on re-install and leaves user files alone', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);
    const g = path.join(userSkills(sandbox), 'g');
    const shipped = await readFile(path.join(g, 'SKILL.md'), 'utf8');
    await writeFileIn(g, 'SKILL.md', 'an old version\n');
    await writeFileIn(g, 'notes.md', 'my notes\n');
    await writeFileIn(userSkills(sandbox), 'mine/SKILL.md', 'my skill\n');

    const json = await installJson(sandbox);

    expect(json.files).toContainEqual({
      path: path.join(g, 'SKILL.md'),
      action: 'update',
    });
    expect(await readFile(path.join(g, 'SKILL.md'), 'utf8')).toBe(shipped);
    expect(await readFile(path.join(g, 'notes.md'), 'utf8')).toBe('my notes\n');
    expect(
      await readFile(path.join(userSkills(sandbox), 'mine/SKILL.md'), 'utf8')
    ).toBe('my skill\n');
  });

  it('removes files it installed earlier that are no longer shipped', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);
    const g = path.join(userSkills(sandbox), 'g');
    const manifestFile = path.join(g, '.gstack-manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
      files: string[];
    };
    manifest.files.push('retired/old.md');
    await writeFileIn(g, '.gstack-manifest.json', JSON.stringify(manifest));
    await writeFileIn(g, 'retired/old.md', 'retired\n');

    const result = await install(sandbox);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/remove\s+retired\/old\.md/);
    expect(existsSync(path.join(g, 'retired', 'old.md'))).toBe(false);
    expect(existsSync(path.join(g, 'retired'))).toBe(false);
  });

  it('refuses to overwrite a file it did not write', async () => {
    const sandbox = await createSandbox();
    const g = path.join(userSkills(sandbox), 'g');
    await writeFileIn(g, 'SKILL.md', 'someone else’s g skill\n');

    const result = await install(sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(path.join(g, 'SKILL.md'));
    expect(Object.keys(await snapshot(userSkills(sandbox)))).toEqual([
      path.join('g', 'SKILL.md'),
    ]);
    expect(await readFile(path.join(g, 'SKILL.md'), 'utf8')).toBe(
      'someone else’s g skill\n'
    );
  });

  it('describes every file with --json', async () => {
    const sandbox = await createSandbox();

    const json = await installJson(sandbox);

    const g = path.join(userSkills(sandbox), 'g');
    expect(json).toMatchObject({
      harness: 'claude-code',
      scope: 'user',
      root: g,
      dryRun: false,
    });
    expect(json.files).toContainEqual({
      path: path.join(g, 'SKILL.md'),
      action: 'create',
    });
    expect(json.files).toContainEqual({
      path: path.join(g, 'adapter.md'),
      action: 'create',
    });
  });

  it('tells the model where the installed files are', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);

    const router = await readFile(
      path.join(userSkills(sandbox), 'g', 'SKILL.md'),
      'utf8'
    );

    expect(router).toContain('`${CLAUDE_SKILL_DIR}`');
  });
});

/** Rewrites the user install's manifest file list with `edit`. */
const editManifest = async (
  sandbox: Sandbox,
  edit: (files: string[]) => string[]
) => {
  const g = path.join(userSkills(sandbox), 'g');
  const file = path.join(g, '.gstack-manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')) as {
    files: string[];
  };
  manifest.files = edit(manifest.files);
  await writeFileIn(g, '.gstack-manifest.json', JSON.stringify(manifest));
};

describe('gstack install over an unusual install directory', () => {
  it('keeps shipped files that stale manifest entries also name', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);
    await editManifest(sandbox, (files) => [
      ...files,
      './SKILL.md',
      'skill.MD',
      'roles//explorer.md',
      'ROLES/EXPLORER.md',
    ]);

    const result = await install(sandbox);

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(' 0 removed');
    const g = path.join(userSkills(sandbox), 'g');
    expect(existsSync(path.join(g, 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(g, 'roles', 'explorer.md'))).toBe(true);
    expect((await install(sandbox)).stdout).toMatch(
      /0 written, 0 removed, \d+ unchanged/
    );
  });

  it('exits 2 on a corrupt manifest without writing', async () => {
    const sandbox = await createSandbox();
    const g = path.join(userSkills(sandbox), 'g');
    await writeFileIn(g, '.gstack-manifest.json', '{not json');

    const result = await install(sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(path.join(g, '.gstack-manifest.json'));
    expect(existsSync(path.join(g, 'SKILL.md'))).toBe(false);
  });

  it('refuses to write through a symlink inside the install', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);
    const g = path.join(userSkills(sandbox), 'g');
    const outside = path.join(sandbox.home, 'elsewhere');
    await mkdir(outside);
    await writeFileIn(outside, 'explorer.md', 'not yours\n');
    await rm(path.join(g, 'roles'), { recursive: true });
    await symlink(outside, path.join(g, 'roles'));

    const result = await install(sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('symlink');
    expect(await readFile(path.join(outside, 'explorer.md'), 'utf8')).toBe(
      'not yours\n'
    );
  });

  it('exits 1 with a one-line error when a write fails, keeping ownership', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);
    const g = path.join(userSkills(sandbox), 'g');
    await writeFileIn(g, 'HARNESS.md', 'old\n');
    await writeFileIn(g, 'SKILL.md', 'old\n');
    await chmod(path.join(g, 'SKILL.md'), 0o444);

    const result = await install(sandbox);
    await chmod(path.join(g, 'SKILL.md'), 0o644);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^gstack: install failed partway: .+\n$/);
    const manifest = await readFile(
      path.join(g, '.gstack-manifest.json'),
      'utf8'
    );
    expect(manifest).toContain('"SKILL.md"');
    expect(manifest).toContain('"HARNESS.md"');
    // The next run still owns the file and finishes the job.
    expect((await install(sandbox)).exitCode).toBe(0);
    expect(await readFile(path.join(g, 'SKILL.md'), 'utf8')).toMatch(/^---/);
  });
});

describe('gstack install with bad arguments', () => {
  it('rejects an unsupported harness without writing anything', async () => {
    const sandbox = await createSandbox();

    const result = await runCli(['install', '--harness', 'vim'], sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unsupported harness 'vim'");
    expect(result.stderr).toContain('claude-code');
    expect(await snapshot(sandbox.home)).toEqual({});
    expect(existsSync(path.join(sandbox.project, '.claude'))).toBe(false);
  });

  it('needs --harness', async () => {
    const result = await runCli(['install'], await createSandbox());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--harness');
  });

  it('rejects --user with --project', async () => {
    const sandbox = await createSandbox();

    const result = await install(sandbox, '--user', '--project');

    expect(result.exitCode).toBe(2);
    expect(await snapshot(sandbox.home)).toEqual({});
  });
});
