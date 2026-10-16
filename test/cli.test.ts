import { describe, expect, it } from 'vitest';
import { createSandbox, runCli } from './helpers.ts';

describe('gstack --help', () => {
  it('prints usage listing the commands and exits 0', async () => {
    const result = await runCli(['--help'], await createSandbox());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^Usage: gstack /);
    expect(result.stdout).toContain('models get <role> [--json]');
    expect(result.stderr).toBe('');
  });
});

describe('gstack with no command', () => {
  it('prints usage to stderr and exits 2', async () => {
    const result = await runCli([], await createSandbox());

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/Usage: gstack /);
  });
});

describe('gstack with an unknown command', () => {
  it('names the command, points at --help and exits 2', async () => {
    const result = await runCli(['frobnicate'], await createSandbox());

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown command 'frobnicate'");
    expect(result.stderr).toContain('gstack --help');
  });
});
