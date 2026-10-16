/**
 * Role briefs: the self-contained instructions a subagent gets before its
 * task brief. Shipped as content/roles/<role>.md.
 */
import { readdir, readFile } from 'node:fs/promises';
import { ConfigError } from './command.ts';

const ROLES_DIR = new URL('../content/roles/', import.meta.url);

const shippedRoles = async (): Promise<string[]> =>
  (await readdir(ROLES_DIR))
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.slice(0, -'.md'.length))
    .sort();

/** The brief for `role`, exactly as shipped. Unknown roles are an error. */
export const readRoleBrief = async (role: string): Promise<string> => {
  const known = await shippedRoles();
  if (!known.includes(role)) {
    throw new ConfigError(
      `unknown role '${role}'; available roles: ${known.join(', ')}`
    );
  }
  return readFile(new URL(`${role}.md`, ROLES_DIR), 'utf8');
};
