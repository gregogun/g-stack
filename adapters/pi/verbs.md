# pi adapter

How each verb in the verb contract ([HARNESS.md](HARNESS.md)) maps to pi, and what a skill does when a verb has no mapping yet. `gstack install --harness pi` installs this file next to the router as `adapter.md`. Relative paths here are relative to that directory, the g skill's directory.

pi has no subagent, todo or question tool of its own; its built-in tools are `read`, `bash`, `edit`, `write`, `grep`, `find` and `ls`. The g-stack extension, installed with this skill, adds the `spawn` tool and the `/g` command.

## `spawn(role, brief, model?)`

Call the `spawn` tool with:

- `role`: the role name, for example `explorer`. The role brief is `roles/<role>.md` in this directory; the tool passes it to the subagent itself, so don't copy it into the brief.
- `brief`: the task brief, following the brief template in HARNESS.md.
- `model`: only when `spawn` was given one. Without it, the role runs on the backend and model that config names for it (`gstack models get <role>` prints them).
- `timeout`: seconds, only when the work needs more than the default 600.

The tool runs `gstack spawn` and returns its JSON report, `{status, role, backend, model, durationMs, output}`. Use `output`, the subagent's final answer, as the report. `status` is `ok`, `failed` or `timeout`; on `failed` or `timeout`, decide whether to retry. A tool error means no subagent ran (bad arguments or config, or a backend CLI that isn't installed): stop and show the user the error.

Subagents run in parallel when you call `spawn` several times in one message.

## `todo(steps)`

pi has no todo tool. Keep the list as a numbered markdown list in your reply, every step with its id, for example `1. [ ] explain.scope: Pin down the question`. Repeat the whole list, updated, whenever a step starts or finishes: `[~]` while it runs, `[x]` when done. A skipped step is marked `[x]` with `skipped: <reason>` added to its text, so it stays on the list.

## `ask(question)`

pi has no question tool. Ask in a plain message and end your turn; the user's reply is the answer.

## `wake(after)`

Not mapped yet. Tell the user what is left and what would resume it (for example "run `/g` again after the deploy finishes"), then end the turn.

## `transcript(session)`

Run `gstack transcript` with the `bash` tool. It prints the session as JSON in one normalised format, whichever harness recorded it.

- No flags: the newest session started in the current directory.
- `--session <id>`: the session with that id, in any project.
- `--file <path>`: read that session file.
- `--harness claude-code` or `--harness pi`: only that harness's sessions (with `--file`, read the file as that harness's format).

## When a verb is missing

If a verb's tool isn't available in this session (for example the extension isn't loaded, or `gstack` isn't on `PATH`):

- `spawn`: if you are a subagent yourself (`GSTACK_SUBAGENT` is set), do the work yourself: `gstack spawn` refuses to run inside a subagent. Otherwise, if the `bash` tool works and `gstack` is on `PATH`, save the task brief to a temporary file and run `gstack spawn --role <role> --brief <file>`; its stdout is the same JSON report. Otherwise do the role's work yourself in the main session, following the role brief, and say in the report that it ran without a subagent.
- Any other verb: tell the user which verb is unavailable and carry on without it.

## How g-stack is installed in pi

Checked against pi 0.74.0. pi's docs: [skills](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/skills.md), [extensions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), [usage](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/usage.md).

- **Where the files go.** Into pi's config directory: `~/.pi/agent` (or `PI_CODING_AGENT_DIR`) for the user, or `.pi` in the project. The router skill and every file it links to are in `skills/g/` (this directory). The extension is `extensions/gstack/index.ts`. pi loads a project's `.pi` only from the directory it was started in.
- **Skills.** pi lists each directory under `skills/` that holds a `SKILL.md` as a skill and looks no deeper, so only `g` is listed, as `/skill:g`. The other skills, under `skills/g/skills/`, are read by path when linked.
- **The `spawn` tool.** The extension registers it with pi's `registerTool`. It writes the brief to a temporary file, runs `gstack spawn --role <role> --brief <file>` (plus `--model` and `--timeout` when given) in the session's directory, and returns the JSON report. `gstack` must be on the `PATH` pi was started with.
- **The `/g` command.** The extension registers it with pi's `registerCommand`. It finds the loaded g skill and sends its body followed by the task, as `/skill:g <task>` would.
- **Subagents.** `gstack spawn` sets `GSTACK_SUBAGENT=1`. In a pi subagent the extension registers neither the tool nor the command, and `gstack spawn` itself refuses to run (exit 2), so a subagent can't fan out again, even through `bash`.
- **One scope.** If g-stack is installed for both the user and the project, pi loads both extensions and renames the commands to `/g:1` and `/g:2`, so plain `/g` stops working.
