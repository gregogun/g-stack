# Installing

```
gstack install --harness <name> [--user | --project] [--dry-run] [--json]
```

Installs the shipped content into a harness so that `/g` works there. Supported harnesses: `claude-code`.

- `--user` (the default): install for every project on this machine.
- `--project`: install into the current project only. The project root is the nearest directory at or above the current one that holds `.git`.
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
- A file in the manifest that is no longer shipped is removed.
- A file not in the manifest is never touched. If install would have to write over one, it stops before writing anything and exits 2, naming the file.

Exit codes: 0 installed (or nothing to do), 2 bad arguments, an unsupported harness, a foreign file in the way, or no config directory. Nothing is written when it exits 2.

## Claude Code

| Scope     | Install root                                                 |
| --------- | ------------------------------------------------------------ |
| `user`    | `$CLAUDE_CONFIG_DIR/skills/g`, else `$HOME/.claude/skills/g` |
| `project` | `<project root>/.claude/skills/g`                            |

Everything installs into one skill directory:

- `content/skills/g/SKILL.md` (the router) becomes `skills/g/SKILL.md`, the only skill Claude Code sees. It is invoked as `/g`.
- Every other content file is a supporting file under `skills/g/`, at its path relative to `content/`. For example, `content/roles/explorer.md` becomes `skills/g/roles/explorer.md` and `content/skills/how/SKILL.md` becomes `skills/g/skills/how/SKILL.md`. Relative links are rewritten so they still resolve; the router's `../../HARNESS.md` becomes `HARNESS.md`.
- `adapters/claude-code/verbs.md` becomes `skills/g/adapter.md`, and the installed `HARNESS.md` gets a link to it. It maps each verb to Claude Code. `spawn` uses the native subagent tool when the role resolves to a Claude model and `gstack spawn` otherwise.

### Why hidden skills are supporting files

Content marks every skill except the router `metadata.discoverable: "false"`. Claude Code's nearest frontmatter is `disable-model-invocation: true`. Per the [skills docs](https://code.claude.com/docs/en/skills), it takes the description out of the model's context, but Claude also "can't invoke the skill on its own". If Claude tries anyway, "Claude Code blocks the call and instructs it not to reproduce the [skill's] steps another way". That would stop the router from handing off to a hidden skill.

So the Claude Code adapter doesn't install hidden skills as skills at all. Claude Code discovers skills only at `skills/<name>/SKILL.md`, so a `SKILL.md` nested under `skills/g/` is never listed. The model reads it by path when the router links to it. That is how hidden skills work in core content anyway.
