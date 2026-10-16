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
 */
const HARNESS_TERMS = [
  'claude code',
  'claude\\.md',
  'claude',
  'pi',
  'cursor',
  'codex',
  'opencode',
  'aider',
  'gemini',
  'windsurf',
  'copilot',
  'todowrite',
  'askuserquestion',
];
const HARNESS_TERM = new RegExp(`\\b(?:${HARNESS_TERMS.join('|')})\\b`, 'gi');

/** A verb call such as `spawn(explorer, brief)`: the name before "(". */
const VERB_CALL = /^\s*([a-z][a-z0-9_]*)\(/;
const INLINE_CODE = /`([^`\n]+)`/g;
const INLINE_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g;
const REFERENCE_LINK = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
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

/** Splits `text` into lines, marking which are inside fenced code. */
const scanLines = (text: string) => {
  let fenced = false;
  return text.split('\n').map((content, index) => {
    const isFence = FENCE.test(content);
    if (isFence) fenced = !fenced;
    return { number: index + 1, content, fenced: fenced || isFence, isFence };
  });
};

/** Verb-call candidates on a line: inline code, or the line in a fence. */
const codeOn = (line: ReturnType<typeof scanLines>[number]): string[] => {
  if (line.isFence) return [];
  if (line.fenced) return [line.content];
  return [...line.content.matchAll(INLINE_CODE)].map((match) => match[1] ?? '');
};

/** Link targets on a line, outside fenced code. */
const linksOn = (line: ReturnType<typeof scanLines>[number]): string[] => {
  if (line.fenced) return [];
  const reference = REFERENCE_LINK.exec(line.content)?.[1];
  return [
    ...[...line.content.matchAll(INLINE_LINK)].map((match) => match[1] ?? ''),
    ...(reference === undefined ? [] : [reference]),
  ].filter((target) => !NOT_A_FILE.test(target));
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

    for (const match of line.content.matchAll(HARNESS_TERM)) {
      report(`names the harness-specific term '${match[0]}'`);
    }
    for (const code of codeOn(line)) {
      const verb = VERB_CALL.exec(code)?.[1];
      if (verb !== undefined && !VERBS.has(verb)) {
        report(`uses '${verb}', which is not a verb in the contract`);
      }
    }
    for (const target of linksOn(line)) {
      const resolved = path.resolve(
        path.dirname(file),
        decodeURI(target.split('#')[0] ?? '')
      );
      if (path.relative(contentDir, resolved).startsWith('..')) {
        report(`reference '${target}' leaves the content directory`);
      } else if (!existsSync(resolved)) {
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
