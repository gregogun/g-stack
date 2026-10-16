/**
 * Model resolution: which backend and model each role runs on.
 *
 * Built-in defaults, overridden field by field by user config
 * ($GSTACK_HOME/config.json), overridden by repo config
 * (<project root>/.gstack/config.json). See docs/config.md.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ConfigError, type Context } from './command.ts';
import { isOnPath } from './executables.ts';

const BACKENDS = ['pi', 'claude'] as const;
type Backend = (typeof BACKENDS)[number];

/** The model value meaning "pass no model flag; use the backend's default". */
const DEFAULT_MODEL = 'default';

const BUILT_IN_ROLES = ['explorer', 'synthesizer', 'investigator'];

type RoleConfig = { backend?: Backend; model?: string };
type Config = { defaultBackend?: Backend; roles: Record<string, RoleConfig> };

export type Resolved = {
  role: string;
  backend: Backend;
  /** The model to pass to the backend, or null to pass no model flag. */
  model: string | null;
};

/** g-stack's home directory: GSTACK_HOME, else ~/.gstack. */
const gstackHome = (env: Context['env']): string =>
  env.GSTACK_HOME || path.join(env.HOME || homedir(), '.gstack');

/** The nearest ancestor of `cwd` holding .git, else `cwd` itself. */
const projectRoot = (cwd: string): string => {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return cwd;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseBackend = (value: unknown, fail: (msg: string) => never) =>
  BACKENDS.includes(value as Backend)
    ? (value as Backend)
    : fail(`must be one of ${BACKENDS.map((b) => `"${b}"`).join(', ')}`);

/** Validates parsed config, naming the file and field of the first error. */
const parseConfig = (file: string, raw: unknown): Config => {
  const fail =
    (field: string) =>
    (message: string): never => {
      throw new ConfigError(`invalid config in ${file}: ${field} ${message}`);
    };
  if (!isObject(raw)) {
    throw new ConfigError(
      `invalid config in ${file}: config must be a JSON object`
    );
  }
  const config: Config = { roles: {} };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'defaultBackend') {
      config.defaultBackend = parseBackend(value, fail(key));
    } else if (key === 'roles') {
      if (!isObject(value)) fail(key)('must be an object');
      for (const [role, roleRaw] of Object.entries(value as object)) {
        const at = `roles.${role}`;
        if (!isObject(roleRaw)) fail(at)('must be an object');
        const roleConfig: RoleConfig = {};
        for (const [field, fieldValue] of Object.entries(roleRaw as object)) {
          if (field === 'backend') {
            roleConfig.backend = parseBackend(
              fieldValue,
              fail(`${at}.backend`)
            );
          } else if (field === 'model') {
            if (typeof fieldValue !== 'string' || fieldValue === '') {
              fail(`${at}.model`)('must be a non-empty string');
            }
            roleConfig.model = fieldValue as string;
          } else {
            fail(`${at}.${field}`)('is not a known field');
          }
        }
        config.roles[role] = roleConfig;
      }
    } else {
      fail(key)('is not a known field');
    }
  }
  return config;
};

/** Reads and validates `file`; a missing file is an empty config. */
const loadConfig = async (file: string): Promise<Config> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { roles: {} };
    throw new ConfigError(
      `cannot read config ${file}: ${(error as Error).message}`
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(
      `invalid config in ${file}: not valid JSON (${(error as Error).message})`
    );
  }
  return parseConfig(file, raw);
};

/** Resolves `role` for gstack run in `context`. */
export const resolveRole = async (
  role: string,
  context: Context
): Promise<Resolved> => {
  // Lowest precedence first.
  const layers = [
    await loadConfig(path.join(gstackHome(context.env), 'config.json')),
    await loadConfig(
      path.join(projectRoot(context.cwd), '.gstack', 'config.json')
    ),
  ];
  const known = new Set([
    ...BUILT_IN_ROLES,
    ...layers.flatMap((layer) => Object.keys(layer.roles)),
  ]);
  if (!known.has(role)) {
    throw new ConfigError(
      `unknown role '${role}'; known roles: ${[...known].sort().join(', ')}`
    );
  }

  let backend: Backend | undefined;
  let defaultBackend: Backend | undefined;
  let model = DEFAULT_MODEL;
  for (const layer of layers) {
    defaultBackend = layer.defaultBackend ?? defaultBackend;
    backend = layer.roles[role]?.backend ?? backend;
    model = layer.roles[role]?.model ?? model;
  }
  defaultBackend ??= (await isOnPath('pi', context.env)) ? 'pi' : 'claude';

  return {
    role,
    backend: backend ?? defaultBackend,
    model: model === DEFAULT_MODEL ? null : model,
  };
};
