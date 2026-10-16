import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandbox, runCli, writeFileIn, type Sandbox } from './helpers.ts';

const userRoot = (sandbox: Sandbox) => path.join(sandbox.home, '.pi', 'agent');

const install = (sandbox: Sandbox, ...args: string[]) =>
  runCli(['install', '--harness', 'pi', ...args], sandbox);

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

describe('gstack install --harness pi', () => {
  it('installs the g skill and the extension under ~/.pi/agent by default', async () => {
    const sandbox = await createSandbox();

    const result = await install(sandbox);

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const root = userRoot(sandbox);
    const g = path.join(root, 'skills', 'g');
    const router = await readFile(path.join(g, 'SKILL.md'), 'utf8');
    expect(router).toMatch(/^---\nname: g\n/);
    expect(existsSync(path.join(g, 'HARNESS.md'))).toBe(true);
    expect(existsSync(path.join(g, 'roles', 'explorer.md'))).toBe(true);
    expect(existsSync(path.join(g, 'skills', 'how', 'SKILL.md'))).toBe(true);
    expect(await readFile(path.join(g, 'adapter.md'), 'utf8')).toMatch(
      /^# pi adapter/
    );
    expect(
      existsSync(path.join(root, 'extensions', 'gstack', 'index.ts'))
    ).toBe(true);
    expect(result.stdout).toContain(`g-stack for pi (user) in ${root}`);
    expect(result.stdout).toMatch(/create\s+skills\/g\/SKILL\.md/);
    expect(result.stdout).toMatch(/create\s+extensions\/gstack\/index\.ts/);
    expect(result.stdout).toMatch(/\d+ written, 0 removed, 0 unchanged/);
    // Only the g skill at the top: pi doesn't look below a SKILL.md, so the
    // nested hidden skills stay unlisted.
    expect(await readdir(path.join(root, 'skills'))).toEqual(['g']);
    expect(await readdir(path.join(root, 'extensions'))).toEqual(['gstack']);
  });

  it('keeps every relative link in the installed files working', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);

    const g = path.join(userRoot(sandbox), 'skills', 'g');
    const router = await readFile(path.join(g, 'SKILL.md'), 'utf8');
    expect(router).toContain('[the verb contract](HARNESS.md)');
    expect(router).toContain('[the adapter](adapter.md)');
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

  it('installs into PI_CODING_AGENT_DIR when it is set', async () => {
    const sandbox = await createSandbox();
    const config = path.join(sandbox.home, 'pi-config');

    const result = await runCli(['install', '--harness', 'pi'], sandbox, {
      env: { PI_CODING_AGENT_DIR: config },
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(config, 'skills', 'g', 'SKILL.md'))).toBe(true);
    expect(
      existsSync(path.join(config, 'extensions', 'gstack', 'index.ts'))
    ).toBe(true);
    expect(existsSync(path.join(sandbox.home, '.pi'))).toBe(false);
  });

  it('expands a leading ~ in PI_CODING_AGENT_DIR, as pi does', async () => {
    const sandbox = await createSandbox();

    const json = await (async () => {
      const result = await runCli(
        ['install', '--harness', 'pi', '--json'],
        sandbox,
        { env: { PI_CODING_AGENT_DIR: '~/pi-config' } }
      );
      expect(result.exitCode).toBe(0);
      return JSON.parse(result.stdout) as InstallJson;
    })();

    expect(json.root).toBe(path.join(sandbox.home, 'pi-config'));
    expect(
      existsSync(path.join(sandbox.home, 'pi-config', 'skills', 'g'))
    ).toBe(true);
  });

  it('exits 2 when neither PI_CODING_AGENT_DIR nor HOME is set', async () => {
    const sandbox = await createSandbox();

    const result = await runCli(['install', '--harness', 'pi'], sandbox, {
      env: { HOME: '' },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/PI_CODING_AGENT_DIR|HOME/);
    expect(await snapshot(sandbox.home)).toEqual({});
  });

  it('installs into the project .pi with --project and leaves home alone', async () => {
    const sandbox = await createSandbox();
    await writeFileIn(sandbox.project, 'src/keep.txt', '');

    const result = await runCli(
      ['install', '--harness', 'pi', '--project', '--json'],
      sandbox,
      { cwd: 'src' }
    );

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as InstallJson;
    const root = path.join(sandbox.project, '.pi');
    expect(json.scope).toBe('project');
    expect(json.root).toBe(root);
    expect(existsSync(path.join(root, 'skills', 'g', 'SKILL.md'))).toBe(true);
    expect(
      existsSync(path.join(root, 'extensions', 'gstack', 'index.ts'))
    ).toBe(true);
    expect(await snapshot(sandbox.home)).toEqual({});
  });

  it('changes nothing when run twice', async () => {
    const sandbox = await createSandbox();
    await install(sandbox);
    const before = await snapshot(userRoot(sandbox));

    const result = await install(sandbox);
    const json = await installJson(sandbox);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/0 written, 0 removed, \d+ unchanged/);
    expect(json.files.every((file) => file.action === 'unchanged')).toBe(true);
    expect(await snapshot(userRoot(sandbox))).toEqual(before);
  });

  it('lists what it would write with --dry-run and writes nothing', async () => {
    const sandbox = await createSandbox();

    const result = await install(sandbox, '--dry-run');
    const json = await installJson(sandbox, '--dry-run');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/would create\s+skills\/g\/SKILL\.md/);
    expect(result.stdout).toMatch(
      /would create\s+extensions\/gstack\/index\.ts/
    );
    expect(json.dryRun).toBe(true);
    expect(await snapshot(sandbox.home)).toEqual({});
  });

  it('updates its own files and leaves pi’s and the user’s files alone', async () => {
    const sandbox = await createSandbox();
    const root = userRoot(sandbox);
    await writeFileIn(root, 'settings.json', '{"theme":"dark"}\n');
    await writeFileIn(root, 'skills/mine/SKILL.md', 'my skill\n');
    await writeFileIn(root, 'extensions/mine.ts', 'my extension\n');
    await install(sandbox);
    const extension = path.join(root, 'extensions', 'gstack', 'index.ts');
    const shipped = await readFile(extension, 'utf8');
    await writeFileIn(root, 'extensions/gstack/index.ts', 'an old version\n');

    const json = await installJson(sandbox);

    expect(json.files).toContainEqual({ path: extension, action: 'update' });
    expect(await readFile(extension, 'utf8')).toBe(shipped);
    expect(await readFile(path.join(root, 'settings.json'), 'utf8')).toBe(
      '{"theme":"dark"}\n'
    );
    expect(
      await readFile(path.join(root, 'skills/mine/SKILL.md'), 'utf8')
    ).toBe('my skill\n');
    expect(await readFile(path.join(root, 'extensions/mine.ts'), 'utf8')).toBe(
      'my extension\n'
    );
  });

  it('refuses to overwrite a skill it did not write', async () => {
    const sandbox = await createSandbox();
    const root = userRoot(sandbox);
    await writeFileIn(root, 'skills/g/SKILL.md', 'someone else’s g skill\n');

    const result = await install(sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(path.join(root, 'skills', 'g', 'SKILL.md'));
    expect(Object.keys(await snapshot(root))).toEqual([
      path.join('skills', 'g', 'SKILL.md'),
    ]);
  });

  it('refuses to overwrite an extension it did not write', async () => {
    const sandbox = await createSandbox();
    const root = userRoot(sandbox);
    await writeFileIn(root, 'extensions/gstack/index.ts', 'not ours\n');

    const result = await install(sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      path.join(root, 'extensions', 'gstack', 'index.ts')
    );
    expect(Object.keys(await snapshot(root))).toEqual([
      path.join('extensions', 'gstack', 'index.ts'),
    ]);
  });

  it.each([
    ['user', 'project'],
    ['project', 'user'],
  ])(
    'installs into %s but warns when %s already has g-stack, since pi would rename /g',
    async (first, second) => {
      const sandbox = await createSandbox();
      const roots: Record<string, string> = {
        user: userRoot(sandbox),
        project: path.join(sandbox.project, '.pi'),
      };
      expect((await install(sandbox, `--${first}`)).stderr).toBe('');

      const result = await install(sandbox, `--${second}`, '--json');

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ scope: second });
      expect(result.stderr).toContain('warning');
      expect(result.stderr).toContain(roots[first]);
      expect(result.stderr).toContain('/g:1');
      expect(result.stderr).toContain('Install in one scope only');
      expect(
        existsSync(path.join(roots[second]!, 'skills', 'g', 'SKILL.md'))
      ).toBe(true);
    }
  );

  it.each(['skills', 'extensions'])(
    'refuses to install through a symlinked %s directory',
    async (dir) => {
      const sandbox = await createSandbox();
      const root = userRoot(sandbox);
      const elsewhere = path.join(sandbox.home, 'dotfiles', dir);
      await mkdir(elsewhere, { recursive: true });
      await mkdir(root, { recursive: true });
      await symlink(elsewhere, path.join(root, dir));

      const result = await install(sandbox);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(path.join(root, dir));
      expect(await readdir(elsewhere)).toEqual([]);
    }
  );

  it('describes every file with --json', async () => {
    const sandbox = await createSandbox();

    const json = await installJson(sandbox);

    const root = userRoot(sandbox);
    expect(json).toMatchObject({
      harness: 'pi',
      scope: 'user',
      root,
      dryRun: false,
    });
    expect(json.files).toContainEqual({
      path: path.join(root, 'skills', 'g', 'SKILL.md'),
      action: 'create',
    });
    expect(json.files).toContainEqual({
      path: path.join(root, 'skills', 'g', 'adapter.md'),
      action: 'create',
    });
    expect(json.files).toContainEqual({
      path: path.join(root, 'extensions', 'gstack', 'index.ts'),
      action: 'create',
    });
  });

  it('is listed as a supported harness', async () => {
    const result = await runCli(
      ['install', '--harness', 'vim'],
      await createSandbox()
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/supported: .*\bpi\b/);
  });
});
