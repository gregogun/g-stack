/**
 * The Claude Code adapter's install map. See docs/install.md.
 *
 * Everything installs into one skill directory, `skills/g/`: the router is
 * its SKILL.md and every other content file is a supporting file beside it,
 * keeping its place relative to the content root. Hidden skills are not
 * installed as skills of their own: the router reaches them by path, and a
 * skill marked `disable-model-invocation` would be blocked from that.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPED_CONTENT } from '../check.ts';
import { ConfigError } from '../command.ts';
import { layOutContent, type Adapter } from '../install.ts';
import { projectRoot } from '../project.ts';

const VERBS_DOC = fileURLToPath(
  new URL('../../adapters/claude-code/verbs.md', import.meta.url)
);

const ROUTER_DIR = 'skills/g/';

/** Where a content file goes, relative to `skills/g/`. */
const place = (file: string): string =>
  file.startsWith(ROUTER_DIR) ? file.slice(ROUTER_DIR.length) : file;

const POINTER = `
## In this harness

How each verb maps to this harness, and what to do when one is missing:
[the adapter](adapter.md).
`;

export const claudeCode: Adapter = {
  harness: 'claude-code',
  root: (scope, context) => {
    if (scope === 'project') {
      return path.join(projectRoot(context.cwd), '.claude', 'skills', 'g');
    }
    const { CLAUDE_CONFIG_DIR, HOME } = context.env;
    const configDir =
      CLAUDE_CONFIG_DIR || (HOME ? path.join(HOME, '.claude') : undefined);
    if (configDir === undefined) {
      throw new ConfigError(
        'cannot find the Claude Code config directory: set CLAUDE_CONFIG_DIR or HOME'
      );
    }
    return path.join(configDir, 'skills', 'g');
  },
  files: async () => {
    const files = await layOutContent(SHIPPED_CONTENT, place);
    return [
      ...files.map((file) =>
        file.path === 'HARNESS.md'
          ? { ...file, text: file.text.trimEnd() + '\n' + POINTER }
          : file
      ),
      { path: 'adapter.md', text: await readFile(VERBS_DOC, 'utf8') },
    ];
  },
};
