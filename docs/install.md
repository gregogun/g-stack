# Installing

```
gstack install --harness <name> [--user | --project] [--dry-run] [--json]
```

Installs the shipped content into a harness so that `/g` works there. Supported harnesses: `claude-code` and `pi`.

- `--user` (the default): install for every project on this machine.
- `--project`: install into the current project only. The project root is the nearest directory at or above the current one that holds `.git`; without one, it's the current directory.
- `--dry-run`: print what would change and write nothing.
- `--json`: print `{harness, scope, root, dryRun, files}` instead of the summary. Each entry in `files` is `{path, action}`. `path` is absolute and `action` is `create`, `update`, `unchanged` or `remove`.

```
$ gstack install --harness claude-code
g-stack for claude-code (user) in /Users/me/.claude/skills/g
  create  HARNESS.md
  create  roles/explorer.md
  create  SKILL.md
  create  adapter.md
4 written, 0 removed, 0 unchanged
```

## What install owns

Install writes a manifest, `.gstack-manifest.json`, in the install root. It lists every file g-stack wrote. On a later install:

- A file that is already up to date is left alone, so running install twice changes nothing.
- A file in the manifest whose content differs is overwritten with the shipped version. Edit installed files at your own risk; edit `content/` instead.
- A file in the manifest that is no longer shipped is removed, along with any directories that leaves empty. An entry that could name a shipped file (`./SKILL.md`, or one differing only in case) is never removed.
- A file not in the manifest is never touched. If install would have to write over one, it stops before writing anything and exits 2, naming the file.
- Install never writes or deletes through a symlink inside the install root; it exits 2 instead.
- A file that already has exactly the content install would write is taken over without asking. This is a known limitation: such a file is owned (and later updated or removed) by g-stack from then on.

Exit codes:

- 0: installed, or nothing to do.
- 1: a write failed partway (for example, permission denied). It prints one `gstack:` line, and the manifest lists the files written so far, so the next run still owns them.
- 2: bad arguments, an unsupported harness, a corrupt manifest, a foreign file or symlink in the way, or no config directory. Nothing is written.

## Claude Code

| Scope     | Install root                                                 |
| --------- | ------------------------------------------------------------ |
| `user`    | `$CLAUDE_CONFIG_DIR/skills/g`, else `$HOME/.claude/skills/g` |
| `project` | `<project root>/.claude/skills/g`                            |

Everything installs into one skill directory:

- `content/skills/g/SKILL.md` (the router) becomes `skills/g/SKILL.md`, the only skill Claude Code sees. It is invoked as `/g`.
- Every other content file is a supporting file under `skills/g/`, at its path relative to `content/`. For example, `content/roles/explorer.md` becomes `skills/g/roles/explorer.md` and `content/skills/how/SKILL.md` becomes `skills/g/skills/how/SKILL.md`. Relative links are rewritten so they still resolve; the router's `../../HARNESS.md` becomes `HARNESS.md`.
- `adapters/claude-code/verbs.md` becomes `skills/g/adapter.md`, and the installed `HARNESS.md` gets a link to it. The installed router also gets a short note that every linked file lives in `${CLAUDE_SKILL_DIR}` (which Claude Code expands in `SKILL.md` to the skill's directory) and that relative links resolve against the containing file's directory. It maps each verb to Claude Code. `spawn` uses the native subagent tool when the role resolves to a Claude model and `gstack spawn` otherwise.

### Why hidden skills are supporting files

Content marks every skill except the router `metadata.discoverable: "false"`. Claude Code's nearest frontmatter is `disable-model-invocation: true`. Per the [skills docs](https://code.claude.com/docs/en/skills), it takes the description out of the model's context, but Claude also "can't invoke the skill on its own". If Claude tries anyway, "Claude Code blocks the call and instructs it not to reproduce the [skill's] steps another way". That would stop the router from handing off to a hidden skill.

So the Claude Code adapter doesn't install hidden skills as skills at all. Claude Code discovers skills only at `skills/<name>/SKILL.md`, so a `SKILL.md` nested under `skills/g/` is never listed. The model reads it by path when the router links to it. That is how hidden skills work in core content anyway.

## pi

| Scope     | Install root                                   |
| --------- | ---------------------------------------------- |
| `user`    | `$PI_CODING_AGENT_DIR`, else `$HOME/.pi/agent` |
| `project` | `<project root>/.pi`                           |

The install root is pi's config directory, not a skill directory, because pi looks for skills and extensions in two sibling directories there. A leading `~` in `PI_CODING_AGENT_DIR` is expanded with `HOME`, as pi expands it with the home directory. The manifest sits in the install root and lists only g-stack's files, so pi's own files (`settings.json`, `auth.json`, `sessions/`) and your other skills and extensions are never touched.

- `skills/g/`: laid out as for Claude Code. The router becomes `skills/g/SKILL.md` (pi's `/skill:g`), every other content file is a supporting file beside it, and `adapters/pi/verbs.md` becomes `skills/g/adapter.md`. The installed router gets a note that every linked file lives in the skill's directory and that relative links resolve against the containing file's directory.
- `extensions/gstack/index.ts`: the g-stack extension, copied from `adapters/pi/extension/index.ts`. pi loads it at startup. It adds:
  - the `spawn` tool, `{role, brief, model?, timeout?}`. It writes the brief to a temporary file, runs `gstack spawn --role <role> --brief <file> [--model <model>] [--timeout <seconds>]` in the session's directory and returns the JSON report as the tool result. Exit 1 (the subagent failed or timed out) still returns the report. Any other exit, or no report, fails the tool call with gstack's error.
  - the `/g <task>` command. It sends the installed g skill and the task to the model, the same message `/skill:g <task>` sends. If pi hasn't loaded the g skill, it shows an error instead.

In a pi subagent started by `gstack spawn` (which sets `GSTACK_SUBAGENT=1`, see [spawn](spawn.md)), the extension registers nothing, so subagents can't start the router or fan out again.

The extension imports nothing from pi. The few parts of the extension API it uses are typed in the file itself, so it needs no dependencies and no build step.

For the extension to work, `gstack` must be on the `PATH` pi was started with. pi reads a project's `.pi` directory in the directory it was started in, not at the git root, so after `--project`, start pi at the project root.

### What pi provides

Checked against pi 0.74.0 (`@earendil-works/pi-coding-agent`). Docs: [skills](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/skills.md), [extensions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), [usage](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/usage.md). Source paths below are in the installed package.

- **Config directory.** `~/.pi/agent`, or `PI_CODING_AGENT_DIR` (docs/usage.md; `getAgentDir` in `dist/config.js`).
- **Skills.** Loaded from `~/.pi/agent/skills/` and `~/.agents/skills/`, and in a project from `.pi/skills/` (the start directory only) and `.agents/skills/` (the start directory and its ancestors up to the git root) (docs/skills.md; `collectSkillEntries` in `dist/core/package-manager.js`). A directory that holds a `SKILL.md` is a skill and pi looks no deeper (`loadSkillsFromDirInternal` in `dist/core/skills.js`), so the hidden skills under `skills/g/skills/` are never listed and the model reads them by path, as with Claude Code. `name` must match the directory and `description` is required. Each skill becomes a `/skill:<name>` command that sends the skill's body wrapped in `<skill name="…" location="…">` with "References are relative to `<dir>`", followed by the arguments (`_expandSkillCommand` in `dist/core/agent-session.js`).
- **Extensions.** TypeScript modules loaded with jiti from `~/.pi/agent/extensions/*.ts` or `*/index.ts`, and from the start directory's `.pi/extensions/` (docs/extensions.md; `discoverAndLoadExtensions` in `dist/core/extensions/loader.js`). The default export receives the extension API:
  - `registerTool` takes a plain JSON Schema as `parameters` (TypeBox is optional; pi validates either). Tool calls in one message run in parallel.
  - `registerCommand(name, {description, handler})` adds a slash command.
  - `getCommands()` lists every command, with a skill's `SKILL.md` path in `sourceInfo.path`.
  - `sendUserMessage` sends text as-is. It doesn't expand `/skill:` commands, which is why `/g` builds the skill message itself.
  - `exec` runs a command without a shell, in pi's environment (`dist/core/exec.js`).
- **Verbs.** pi's built-in tools are `read`, `bash`, `edit`, `write`, `grep`, `find` and `ls`. It has no subagent, todo or question tool (only examples of building them). So `spawn` comes from the extension, `todo` is a markdown checklist in the reply, `ask` is a plain message, `wake` isn't mapped, and `transcript` is `gstack transcript` through `bash`. See `adapters/pi/verbs.md`.
