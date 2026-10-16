# Content and `gstack check`

Core content is the harness-neutral markdown under `content/`. Harness specifics live in adapters, outside `content/`.

## Layout

```
content/
├── HARNESS.md            the verb contract: spawn, todo, ask, wake, transcript
├── skills/
│   ├── g/SKILL.md        the router, the only discoverable skill (/g)
│   └── <name>/SKILL.md   workflow skills, reached by relative path
├── playbooks/<name>.md   playbooks, linked from the router
├── roles/<role>.md       subagent role briefs; <role> is the role name
└── principles/<name>.md  guidance loaded on demand
```

- Skills follow the agent-skills `SKILL.md` convention: frontmatter with `name` and `description`.
- Every skill except the router carries `metadata.discoverable: "false"` in its frontmatter. Each adapter keeps such a skill out of the model's list in whatever way its harness allows, while still letting the router reach it by path. For example, the Claude Code adapter installs hidden skills as supporting files of the router; see [install](install.md).
- Files refer to each other with relative markdown links, for example `[how](../skills/how/SKILL.md)`.
- A verb is written as a call in inline code, for example `` `spawn(explorer, brief)` ``.

## `gstack check`

```
gstack check [--content <dir>]
```

Checks the shipped content, or the content directory `<dir>` (relative to the current directory). It prints the router's size and one line per problem, then a count:

```
$ gstack check
content: content
router: content/skills/g/SKILL.md is 743 bytes (budget 4096)
content/skills/how/SKILL.md:12: broken reference '../../roles/nope.md'
content/playbooks/build.md:4: uses 'delegate', which is not a verb in the contract
content/roles/synthesizer.md: role 'synthesizer' is missing section REPORT
3 problems
```

Every `.md` file under the content directory is checked for:

- **References.** Every relative link (inline or reference-style) must point at a file that exists inside the content directory. Links in fenced code, inline code and HTML comments are skipped, as are URLs and `#anchor` links; the anchor of a file link is ignored. A link that can't be decoded (`50%off.md`) is a broken reference.
- **Harness names.** No line may name a harness or a harness-only tool or file. Matching is by whole word:
  - In any case: Claude Code, claude, `CLAUDE.md`, Codex, opencode, Aider, Gemini, Windsurf, Copilot, Cline, Kiro, TodoWrite, AskUserQuestion, `pi-coding-agent`, and the paths `.pi`, `.cursor` and `.cursorrules`.
  - Capitalised only, because they are also ordinary words: Cursor, Pi, Amp, Roo, Zed. So "a database cursor" and "pi r squared" pass, while "Open it in Cursor" fails. The cost: a sentence starting with one of these words ("Pi is irrational") is flagged; reword it.
- **Verbs.** Inline code that starts with a word and `(` is a verb call, as is such a line in a fenced code block with no language tag. The word must be `spawn`, `todo`, `ask`, `wake` or `transcript`, spelled in lowercase: `` `Spawn(x)` `` and `` `delegate (task)` `` fail. camelCase calls such as `` `handleRequest()` `` are not verb calls. Code examples go in a fenced block with a language tag (` ```ts `); its lines are never verb calls.

And also:

- **Roles.** Each `roles/<role>.md` must have the headings `GOAL`, `SCOPE`, `CONTEXT`, `ACCEPTANCE` and `REPORT` (any level, in capitals). `TIMEBOX` and `FORBIDDEN` are optional.
- **Router.** `skills/g/SKILL.md` must exist and be at most 4096 bytes.

Exit codes: 0 no problems, 1 problems found, 2 bad arguments or a missing content directory.
