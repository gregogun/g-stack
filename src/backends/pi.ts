import type { BackendCli } from './index.ts';

/**
 * pi in print mode: `pi -p` reads the prompt from piped stdin and, in its
 * default text output, prints only the final answer on stdout.
 * `--no-session` keeps subagent runs out of the user's saved sessions.
 * `--model` takes pi's own pattern syntax (`provider/id`, `:<thinking>`),
 * passed through unchanged. See docs/spawn.md.
 */
export const pi: BackendCli = {
  executable: 'pi',
  installHint: 'install pi: npm install -g @earendil-works/pi-coding-agent',
  args: (model) => [
    '-p',
    '--no-session',
    ...(model === null ? [] : ['--model', model]),
  ],
};
