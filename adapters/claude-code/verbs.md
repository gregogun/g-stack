# Claude Code adapter

How each verb in the verb contract ([HARNESS.md](HARNESS.md)) maps to Claude Code, and what a skill does when a verb has no mapping yet. `gstack install --harness claude-code` installs this file next to the router as `adapter.md`.

## `spawn(role, brief, model?)`

1. Resolve the role: run `gstack models get <role> --json` with the Bash tool. It prints `{"role", "backend", "model"}`; `model` is `null` for the backend's default. A `model` passed to `spawn` replaces the resolved one.
2. Write the task brief, following the brief template in HARNESS.md.
3. Pick how to run it:
   - **Native subagent**, when the backend is `claude` and the model is `null` or one of the aliases `sonnet`, `opus` or `haiku`. Call the Agent tool (`subagent_type: general-purpose`) with a prompt made of the role brief (`roles/<role>.md`, beside this file) followed by the task brief, both unchanged. Pass the alias as `model`, or leave `model` out when it is `null`.
   - **`gstack spawn`**, otherwise (another backend such as `pi`, or a full model id). Save the task brief to a temporary file and run `gstack spawn --role <role> --brief <file>` with the Bash tool. Add `--model <model>` only when `spawn` was given one. Give the Bash call a timeout longer than spawn's own (600 seconds by default).
4. Use the subagent's final answer as the report. From `gstack spawn`, that is the `output` field of the JSON report. Exit code 1 means the subagent ran but failed or timed out: the report's `status` says which, so decide whether to retry. Exit code 2 means the invocation or config was wrong: stop and show the user the error.

Subagents can run in parallel: send several Agent or Bash calls in one message.

## `todo(steps)`

Use the TodoWrite tool (or the task tools that replace it in newer versions). Write every step with its id, for example `explain-1: Read the entry point`. Mark a step `in_progress` while it runs and `completed` when done. A skipped step is marked completed with `skipped: <reason>` added to its text, so it stays on the list.

## `ask(question)`

Use the AskUserQuestion tool, and wait for the answer before continuing. If the question needs a free-text answer, ask it in a plain message and end the turn.

## `wake(after)`

Not mapped yet. Tell the user what is left and what would resume it (for example "run `/g` again after the deploy finishes"), then end the turn.

## `transcript(session)`

Run `gstack transcript` with the Bash tool. It reads Claude Code and pi sessions and prints them in one normalised format.

## When a verb is missing

If a verb's tool isn't available in this session (a tool is disabled, or the subagent tool is denied):

- `spawn`: do the role's work yourself in the main session, following the role brief, and say in the report that it ran without a subagent.
- `todo`: keep the list as a numbered markdown list in your replies.
- `ask`: ask in a plain message and end the turn.
- Any other verb: tell the user which verb is unavailable and carry on without it.
