/**
 * The Claude Code adapter's install map. See docs/install.md.
 *
 * Everything installs into one skill directory, `skills/g/` (see
 * router-skill.ts). Hidden skills are not installed as skills of their own:
 * the router reaches them by path, and a skill marked
 * `disable-model-invocation` would be blocked from that.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../command.ts';
import type { Adapter } from '../install.ts';
import { projectRoot } from '../project.ts';
import { layOutRouterSkill } from './router-skill.ts';

const VERBS_DOC = fileURLToPath(
  new URL('../../adapters/claude-code/verbs.md', import.meta.url)
);

/**
 * Added to the installed router. Claude Code expands ${CLAUDE_SKILL_DIR}
 * in SKILL.md (not in supporting files), so the model gets an absolute base
 * for every file it reads from here on.
 */
const ROUTER_NOTE = `
## Files

Every file linked from here is installed in this skill's directory,
\`\${CLAUDE_SKILL_DIR}\`. Resolve a relative link against the directory of
the file that contains it, starting from \`\${CLAUDE_SKILL_DIR}/SKILL.md\`.
How each verb maps to this harness: [the adapter](adapter.md).
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
  files: () =>
    layOutRouterSkill({ at: '', verbsDoc: VERBS_DOC, routerNote: ROUTER_NOTE }),
};
