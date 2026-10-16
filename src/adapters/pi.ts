/**
 * The pi adapter's install map. See docs/install.md.
 *
 * The install root is pi's config directory (`~/.pi/agent`, or `.pi` in the
 * project), because pi looks for skills and extensions in two sibling
 * directories there:
 * - `skills/g/`: the router skill with every other content file beside it
 *   (see router-skill.ts). pi stops looking for skills below a directory
 *   that has a SKILL.md, so the nested hidden skills are never listed.
 * - `extensions/gstack/index.ts`: the extension that adds the `spawn` tool
 *   and the `/g` command.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../command.ts';
import type { Adapter } from '../install.ts';
import { projectRoot } from '../project.ts';
import { layOutRouterSkill } from './router-skill.ts';

const ADAPTER_DIR = new URL('../../adapters/pi/', import.meta.url);
const VERBS_DOC = fileURLToPath(new URL('verbs.md', ADAPTER_DIR));
const EXTENSION = fileURLToPath(new URL('extension/index.ts', ADAPTER_DIR));

/**
 * Added to the installed router. pi tells the model to resolve a skill's
 * relative links against the skill's directory; links in the supporting
 * files are relative to the file that holds them instead.
 */
const ROUTER_NOTE = `
## Files

Every file linked from here is installed in this skill's directory, the
directory that holds this file. Resolve a relative link against the
directory of the file that contains it. How each verb maps to this
harness: [the adapter](adapter.md).
`;

/**
 * pi expands a leading `~` in PI_CODING_AGENT_DIR (with the OS home
 * directory; gstack uses HOME, as for every other path under home).
 */
const expandTilde = (dir: string, home: string | undefined) => {
  if (dir !== '~' && !dir.startsWith('~/')) return dir;
  if (!home) {
    throw new ConfigError(
      `cannot expand '~' in PI_CODING_AGENT_DIR (${dir}): HOME is not set`
    );
  }
  return path.join(home, dir.slice(1));
};

export const pi: Adapter = {
  harness: 'pi',
  root: (scope, context) => {
    if (scope === 'project') {
      return path.join(projectRoot(context.cwd), '.pi');
    }
    const { PI_CODING_AGENT_DIR, HOME } = context.env;
    if (PI_CODING_AGENT_DIR) {
      return path.resolve(
        context.cwd,
        expandTilde(PI_CODING_AGENT_DIR, HOME || undefined)
      );
    }
    if (!HOME) {
      throw new ConfigError(
        'cannot find the pi config directory: set PI_CODING_AGENT_DIR or HOME'
      );
    }
    return path.join(HOME, '.pi', 'agent');
  },
  files: async () => [
    ...(await layOutRouterSkill({
      at: 'skills/g/',
      verbsDoc: VERBS_DOC,
      routerNote: ROUTER_NOTE,
    })),
    {
      path: 'extensions/gstack/index.ts',
      text: await readFile(EXTENSION, 'utf8'),
    },
  ],
};
