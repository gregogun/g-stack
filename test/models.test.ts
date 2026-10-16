import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSandbox,
  fakeBin,
  runCli,
  writeFileIn,
  type Sandbox,
} from './helpers.ts';

const userConfig = (sandbox: Sandbox, config: unknown) =>
  writeFileIn(sandbox.home, 'config.json', JSON.stringify(config));

const repoConfig = (sandbox: Sandbox, config: unknown) =>
  writeFileIn(sandbox.project, '.gstack/config.json', JSON.stringify(config));

const getJson = async (sandbox: Sandbox, role: string) => {
  const result = await runCli(['models', 'get', role, '--json'], sandbox);
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as unknown;
};

describe('gstack models get with no config', () => {
  it('resolves each built-in role to the backend default model', async () => {
    const sandbox = await createSandbox();

    for (const role of ['explorer', 'synthesizer', 'investigator']) {
      const result = await runCli(['models', 'get', role], sandbox);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(
        `role: ${role}\nbackend: claude\nmodel: default (no model flag)\n`
      );
    }
  });

  it('uses pi when a pi executable is on PATH', async () => {
    const sandbox = await createSandbox();
    await fakeBin(sandbox, 'claude');
    await fakeBin(sandbox, 'pi');

    expect(await getJson(sandbox, 'explorer')).toEqual({
      role: 'explorer',
      backend: 'pi',
      model: null,
    });
  });

  it('uses claude when only claude is on PATH', async () => {
    const sandbox = await createSandbox();
    await fakeBin(sandbox, 'claude');

    expect(await getJson(sandbox, 'explorer')).toMatchObject({
      backend: 'claude',
    });
  });

  it('ignores a directory named pi on PATH', async () => {
    const sandbox = await createSandbox();
    await mkdir(path.join(sandbox.bin, 'pi'));

    expect(await getJson(sandbox, 'explorer')).toMatchObject({
      backend: 'claude',
    });
  });

  it('ignores a pi on PATH that is not executable', async () => {
    const sandbox = await createSandbox();
    await writeFileIn(sandbox.bin, 'pi', 'not a program');

    expect(await getJson(sandbox, 'explorer')).toMatchObject({
      backend: 'claude',
    });
  });
});

describe('gstack models get --json', () => {
  it('prints the resolved role, backend and model as JSON', async () => {
    const sandbox = await createSandbox();
    await userConfig(sandbox, {
      roles: { synthesizer: { backend: 'pi', model: 'gpt-5' } },
    });

    expect(await getJson(sandbox, 'synthesizer')).toEqual({
      role: 'synthesizer',
      backend: 'pi',
      model: 'gpt-5',
    });
  });
});

describe('gstack models get with config', () => {
  it('lets user config override the defaults', async () => {
    const sandbox = await createSandbox();
    await fakeBin(sandbox, 'pi');
    await userConfig(sandbox, {
      roles: { explorer: { backend: 'claude', model: 'haiku' } },
    });

    const result = await runCli(['models', 'get', 'explorer'], sandbox);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      'role: explorer\nbackend: claude\nmodel: haiku\n'
    );
  });

  it('lets repo config override user config, field by field', async () => {
    const sandbox = await createSandbox();
    await userConfig(sandbox, {
      roles: { explorer: { backend: 'pi', model: 'gpt-5' } },
    });
    await repoConfig(sandbox, { roles: { explorer: { model: 'opus' } } });

    expect(await getJson(sandbox, 'explorer')).toEqual({
      role: 'explorer',
      backend: 'pi',
      model: 'opus',
    });
  });

  it('finds repo config at the project root from a subdirectory', async () => {
    const sandbox = await createSandbox();
    await mkdir(path.join(sandbox.project, 'src', 'deep'), { recursive: true });
    await repoConfig(sandbox, { roles: { explorer: { model: 'opus' } } });

    const result = await runCli(
      ['models', 'get', 'explorer', '--json'],
      sandbox,
      {
        cwd: 'src/deep',
      }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ model: 'opus' });
  });

  it('shows "default" from config as no model flag', async () => {
    const sandbox = await createSandbox();
    await userConfig(sandbox, { roles: { explorer: { model: 'haiku' } } });
    await repoConfig(sandbox, { roles: { explorer: { model: 'default' } } });

    const result = await runCli(['models', 'get', 'explorer'], sandbox);

    expect(result.stdout).toContain('model: default (no model flag)\n');
    expect(await getJson(sandbox, 'explorer')).toMatchObject({ model: null });
  });

  it('applies defaultBackend to roles that name no backend', async () => {
    const sandbox = await createSandbox();
    await fakeBin(sandbox, 'claude');
    await userConfig(sandbox, { defaultBackend: 'pi' });

    expect(await getJson(sandbox, 'investigator')).toMatchObject({
      backend: 'pi',
    });
  });

  it('resolves a role that only config defines', async () => {
    const sandbox = await createSandbox();
    await repoConfig(sandbox, {
      roles: { reviewer: { backend: 'pi', model: 'gpt-5' } },
    });

    expect(await getJson(sandbox, 'reviewer')).toEqual({
      role: 'reviewer',
      backend: 'pi',
      model: 'gpt-5',
    });
  });

  it('reads user config from ~/.gstack when GSTACK_HOME is unset', async () => {
    const sandbox = await createSandbox();
    await writeFileIn(
      sandbox.home,
      '.gstack/config.json',
      JSON.stringify({ roles: { explorer: { model: 'haiku' } } })
    );

    const result = await runCli(['models', 'get', 'explorer'], sandbox, {
      env: { GSTACK_HOME: '', HOME: sandbox.home },
    });

    expect(result.stdout).toContain('model: haiku\n');
  });
});

describe('gstack models get with invalid config', () => {
  const expectConfigError = async (
    sandbox: Sandbox,
    file: string,
    field: string
  ) => {
    const result = await runCli(['models', 'get', 'explorer'], sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain(field);
  };

  it('names the file when it is not valid JSON', async () => {
    const sandbox = await createSandbox();
    const file = await writeFileIn(sandbox.home, 'config.json', '{ nope');

    await expectConfigError(sandbox, file, 'not valid JSON');
  });

  it('names the file and field for an unknown backend', async () => {
    const sandbox = await createSandbox();
    const file = await repoConfig(sandbox, {
      roles: { explorer: { backend: 'gpt' } },
    });

    await expectConfigError(sandbox, file, 'roles.explorer.backend');
  });

  it('names the file and field for a model that is not a string', async () => {
    const sandbox = await createSandbox();
    const file = await userConfig(sandbox, {
      roles: { explorer: { model: 4 } },
    });

    await expectConfigError(sandbox, file, 'roles.explorer.model');
  });

  it('names the file and field for an empty model', async () => {
    const sandbox = await createSandbox();
    const file = await userConfig(sandbox, {
      roles: { explorer: { model: '' } },
    });

    await expectConfigError(sandbox, file, 'roles.explorer.model');
  });

  it('names the file and field for an unknown key', async () => {
    const sandbox = await createSandbox();
    const file = await userConfig(sandbox, { models: {} });

    await expectConfigError(sandbox, file, 'models');
  });

  it('names the file and field for a bad defaultBackend', async () => {
    const sandbox = await createSandbox();
    const file = await repoConfig(sandbox, { defaultBackend: 'codex' });

    await expectConfigError(sandbox, file, 'defaultBackend');
  });

  it('names the file when the config cannot be read', async () => {
    const sandbox = await createSandbox();
    const file = path.join(sandbox.home, 'config.json');
    await mkdir(file);

    await expectConfigError(sandbox, file, 'cannot read');
  });

  it('names the file when the config is not an object', async () => {
    const sandbox = await createSandbox();
    const file = await userConfig(sandbox, []);

    await expectConfigError(sandbox, file, 'must be a JSON object');
  });
});

describe('gstack models usage errors', () => {
  it('rejects an unknown role, listing the known ones, with exit 2', async () => {
    const sandbox = await createSandbox();

    const result = await runCli(['models', 'get', 'wizard'], sandbox);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown role 'wizard'");
    expect(result.stderr).toContain('explorer, investigator, synthesizer');
  });

  it('requires a role', async () => {
    const result = await runCli(['models', 'get'], await createSandbox());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('gstack --help');
  });

  it('requires a known subcommand', async () => {
    const result = await runCli(['models', 'set'], await createSandbox());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown models command 'set'");
  });

  it('rejects unknown options', async () => {
    const result = await runCli(
      ['models', 'get', 'explorer', '--yaml'],
      await createSandbox()
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--yaml');
  });
});
