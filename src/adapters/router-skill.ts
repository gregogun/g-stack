/**
 * Lays the shipped content out as one skill directory: the router is its
 * SKILL.md and every other content file is a supporting file beside it,
 * keeping its place relative to the content root. Hidden skills are not
 * installed as skills of their own; the router reaches them by path.
 *
 * Both the Claude Code and the pi adapters install this way. Each passes
 * where the skill directory sits in its install root, its verb-mapping
 * document (installed as `adapter.md`) and a note for the installed router.
 */
import { readFile } from 'node:fs/promises';
import { SHIPPED_CONTENT } from '../check.ts';
import { layOutContent, type InstallFile } from '../install.ts';

const ROUTER_DIR = 'skills/g/';

const POINTER = `
## In this harness

How each verb maps to this harness, and what to do when one is missing:
[the adapter](adapter.md).
`;

/** Appends `note` to `text`, separated by a blank line. */
const append = (text: string, note: string) => `${text.trimEnd()}\n${note}`;

export const layOutRouterSkill = async (options: {
  /** The skill directory's path in the install root: '' or ending in '/'. */
  at: string;
  /** The adapter's verb-mapping document, installed as `adapter.md`. */
  verbsDoc: string;
  /** Appended to the installed router (`SKILL.md`). */
  routerNote: string;
}): Promise<InstallFile[]> => {
  const { at, verbsDoc, routerNote } = options;
  const place = (file: string): string =>
    at + (file.startsWith(ROUTER_DIR) ? file.slice(ROUTER_DIR.length) : file);
  const files = await layOutContent(SHIPPED_CONTENT, place);
  return [
    ...files.map((file) => {
      if (file.path === `${at}HARNESS.md`) {
        return { ...file, text: append(file.text, POINTER) };
      }
      if (file.path === `${at}SKILL.md`) {
        return { ...file, text: append(file.text, routerNote) };
      }
      return file;
    }),
    { path: `${at}adapter.md`, text: await readFile(verbsDoc, 'utf8') },
  ];
};
