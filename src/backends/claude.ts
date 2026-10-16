import type { BackendCli } from './index.ts';

/**
 * Claude Code in print mode: `claude -p` reads the prompt from stdin and,
 * with text output, prints only the final answer on stdout.
 */
export const claude: BackendCli = {
  executable: 'claude',
  installHint:
    'install Claude Code: https://docs.claude.com/en/docs/claude-code',
  args: (model) => [
    '-p',
    '--output-format',
    'text',
    ...(model === null ? [] : ['--model', model]),
  ],
};
