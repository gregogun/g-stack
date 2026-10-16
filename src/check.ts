/**
 * Content checks: keeps the harness-neutral core content consistent.
 * See docs/content.md for the layout and the rules.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The content shipped with gstack, at the package root. */
export const SHIPPED_CONTENT = fileURLToPath(
  new URL('../content/', import.meta.url)
);

/** The router, relative to the content directory. */
const ROUTER = path.join('skills', 'g', 'SKILL.md');

/** The router's size budget in bytes. */
const ROUTER_BUDGET = 4096;

/** The verbs core content may use (see content/HARNESS.md). */
const VERBS = new Set(['spawn', 'todo', 'ask', 'wake', 'transcript']);

const REQUIRED_SECTIONS = ['GOAL', 'SCOPE', 'CONTEXT', 'ACCEPTANCE', 'REPORT'];

/**
 * Terms that tie content to one harness: harness names and their
 * harness-only tools and files. Longer terms first so "Claude Code" is
 * reported as one term rather than as "claude".
 *
 * Names that are also ordinary words ("a database cursor", "pi r squared")
 * match only capitalised, as names are written. Unambiguous names match in
 * any case. Harness-only spellings (pi-coding-agent, .pi/, .cursor/) catch
 * the lowercase uses that matter.
 */
const HARNESS_NAMES = [
  'claude code',
  'claude\\.md',
  'claude',
  'pi-coding-agent',
  'codex',
  'opencode',
  'aider',
  'gemini',
  'windsurf',
  'copilot',
  'cline',
  'kiro',
  'todowrite',
  'askuserquestion',
];
const AMBIGUOUS_NAMES = ['Cursor', 'Pi', 'Amp', 'Roo', 'Zed'];
/** Harness config directories and files, e.g. `.pi/` or `.cursorrules`. */
const HARNESS_PATH = '(?<![\\w.])\\.(?:pi|cursor(?:rules)?)\\b';
const HARNESS_TERMS = [
  new RegExp(`\\b(?:${HARNESS_NAMES.join('|')})\\b|${HARNESS_PATH}`, 'gi'),
  new RegExp(`\\b(?:${AMBIGUOUS_NAMES.join('|')})\\b`, 'g'),
];

/** Harness terms on `text`, in order, without overlaps. */
const harnessTermsIn = (text: string): string[] => {
  const matches = HARNESS_TERMS.flatMap((pattern) => [
    ...text.matchAll(pattern),
  ]).sort((a, b) => a.index - b.index || b[0].length - a[0].length);
  let end = 0;
  const terms: string[] = [];
  for (const match of matches) {
    if (match.index < end) continue;
    terms.push(match[0]);
    end = match.index + match[0].length;
  }
  return terms;
};

/**
 * A verb call such as `spawn(explorer, brief)`: the name before "(". A
 * capitalised name (`Spawn(`) or a space before "(" still counts; camelCase
 * identifiers (`handleRequest()`) don't.
 */
const VERB_CALL = /^\s*([A-Za-z][a-z0-9_]*)\s*\(/;
const INLINE_CODE = /`([^`\n]+)`/g;
const INLINE_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g;
const REFERENCE_LINK = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(?:```|~~~)\s*(\S*)/;
/** A URL scheme (https:, mailto:, ...) or a same-file anchor. */
const NOT_A_FILE = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

type Problem = {
  /** Absolute path of the file at fault. */
  file: string;
  /** 1-based line, when the problem is on one line. */
  line?: number;
  message: string;
};

type CheckResult = {
  problems: Problem[];
  router: { file: string; bytes: number; budget: number } | null;
};

const markdownFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
};

type Line = {
  number: number;
  content: string;
  /** Inside a fenced code block, or one of its fence lines. */
  fenced: boolean;
  /** Fenced code to check for verb calls: an untagged block's line. */
  verbCode: string | null;
  /** The line outside fences, without HTML comments: where links count. */
  prose: string;
};

/** Removes HTML comments, which may span lines; `open` carries the state. */
const stripComments = (text: string, state: { open: boolean }): string => {
  let out = '';
  let rest = text;
  while (rest) {
    const marker = state.open ? rest.indexOf('-->') : rest.indexOf('<!--');
    if (marker === -1) {
      if (!state.open) out += rest;
      break;
    }
    if (!state.open) out += rest.slice(0, marker);
    rest = rest.slice(marker + (state.open ? 3 : 4));
    state.open = !state.open;
  }
  return out;
};

/**
 * Splits `text` into lines, marking fenced code. A fence with a language tag
 * (```ts) is a code example, so its lines are never verb calls.
 */
const scanLines = (text: string): Line[] => {
  let fence: { tagged: boolean } | null = null;
  const comment = { open: false };
  return text.split('\n').map((content, index) => {
    const number = index + 1;
    const fenceLine = FENCE.exec(content);
    if (fenceLine) {
      fence = fence ? null : { tagged: Boolean(fenceLine[1]) };
      return { number, content, fenced: true, verbCode: null, prose: '' };
    }
    if (fence) {
      const verbCode = fence.tagged ? null : content;
      return { number, content, fenced: true, verbCode, prose: '' };
    }
    const prose = stripComments(content, comment);
    return { number, content, fenced: false, verbCode: null, prose };
  });
};

/** Verb-call candidates on a line: inline code, or untagged fenced code. */
const codeOn = (line: Line): string[] => {
  if (line.fenced) return line.verbCode === null ? [] : [line.verbCode];
  return [...line.prose.matchAll(INLINE_CODE)].map((match) => match[1] ?? '');
};

/** Link targets on a line, outside code and HTML comments. */
const linksOn = (line: Line): string[] => {
  const text = line.prose.replace(INLINE_CODE, '');
  const reference = REFERENCE_LINK.exec(text)?.[1];
  return [
    ...[...text.matchAll(INLINE_LINK)].map((match) => match[1] ?? ''),
    ...(reference === undefined ? [] : [reference]),
  ].filter((target) => !NOT_A_FILE.test(target));
};

/** The file `target` names, relative to `from`; null if it can't decode. */
const resolveLink = (from: string, target: string): string | null => {
  try {
    return path.resolve(
      path.dirname(from),
      decodeURI(target.split('#')[0] ?? '')
    );
  } catch {
    return null;
  }
};

const isInside = (dir: string, file: string): boolean => {
  const relative = path.relative(dir, file);
  return !(
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
};

const checkFile = (
  contentDir: string,
  file: string,
  text: string
): Problem[] => {
  const problems: Problem[] = [];
  for (const line of scanLines(text)) {
    const report = (message: string) =>
      problems.push({ file, line: line.number, message });

    for (const term of harnessTermsIn(line.content)) {
      report(`names the harness-specific term '${term}'`);
    }
    for (const code of codeOn(line)) {
      const verb = VERB_CALL.exec(code)?.[1];
      if (verb !== undefined && !VERBS.has(verb)) {
        report(`uses '${verb}', which is not a verb in the contract`);
      }
    }
    for (const target of linksOn(line)) {
      const resolved = resolveLink(file, target);
      if (resolved !== null && !isInside(contentDir, resolved)) {
        report(`reference '${target}' leaves the content directory`);
      } else if (resolved === null || !existsSync(resolved)) {
        report(`broken reference '${target}'`);
      }
    }
  }
  return problems;
};

const checkRole = (file: string, text: string): Problem[] => {
  const headings = new Set(
    scanLines(text)
      .filter((line) => !line.fenced)
      .map((line) => HEADING.exec(line.content)?.[1])
  );
  const role = path.basename(file, '.md');
  return REQUIRED_SECTIONS.filter((section) => !headings.has(section)).map(
    (section) => ({
      file,
      message: `role '${role}' is missing section ${section}`,
    })
  );
};

/** Checks the content directory `contentDir`, which must exist. */
export const checkContent = async (
  contentDir: string
): Promise<CheckResult> => {
  const problems: Problem[] = [];
  const roles = path.join(contentDir, 'roles');
  for (const file of await markdownFiles(contentDir)) {
    const text = await readFile(file, 'utf8');
    problems.push(...checkFile(contentDir, file, text));
    if (path.dirname(file) === roles) problems.push(...checkRole(file, text));
  }

  const routerFile = path.join(contentDir, ROUTER);
  if (!existsSync(routerFile)) {
    problems.push({ file: routerFile, message: 'router is missing' });
    return { problems, router: null };
  }
  const bytes = (await readFile(routerFile)).byteLength;
  if (bytes > ROUTER_BUDGET) {
    problems.push({
      file: routerFile,
      message: `router is ${bytes} bytes, over the budget of ${ROUTER_BUDGET}`,
    });
  }
  return {
    problems,
    router: { file: routerFile, bytes, budget: ROUTER_BUDGET },
  };
};
