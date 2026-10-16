# Spawning subagents

`gstack spawn` runs one subagent headlessly on an agent CLI and prints a report as JSON on stdout.

```
gstack spawn --role <role> --brief <file> [--backend <backend>] [--model <model>] [--timeout <seconds>]
```

- `--role`: a shipped role brief, `content/roles/<role>.md` (for now: `explorer`).
- `--brief`: the task brief file, relative to the current directory.
- `--backend`, `--model`: override [model resolution](config.md). `--model default` passes no model flag.
- `--timeout`: seconds before the subagent is killed (default 600; fractions allowed).

The subagent's input, on stdin, is the role brief, a newline, then the task brief, each exactly as in its file. The subagent runs in the current directory with gstack's environment.

## Backends

| Backend  | Command line                                       | Install                                                    |
| -------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `claude` | `claude -p --output-format text [--model <model>]` | [Claude Code](https://docs.claude.com/en/docs/claude-code) |
| `pi`     | `pi -p --no-session [--model <model>]`             | `npm install -g @earendil-works/pi-coding-agent`           |

The model value goes to the backend's model flag unchanged, so it uses that CLI's own syntax.

### pi

How `pi -p` behaves, as checked against `@earendil-works/pi-coding-agent` 0.74.0 (paths are inside the installed package):

- **Prompt.** In print mode pi reads piped stdin and makes it the initial message (`docs/usage.md`, "Modes"; `readPipedStdin` and `buildInitialMessage` in `dist/main.js` and `dist/cli/initial-message.js`). pi trims leading and trailing whitespace from stdin before using it, so the subagent sees the role brief and task brief byte for byte apart from whitespace at the very start and end. gstack passes no prompt argument; a word after `-p` would be taken as a second message (`dist/cli/args.js`).
- **Model.** `--model <pattern>` takes a model ID or pattern, `provider/id`, and an optional `:<thinking>` suffix, for example `openai/gpt-5:high` (`docs/usage.md`, "Model Options"; `dist/main.js`). Without `--model`, pi uses its saved default model from its settings. An unknown model is an error on stderr and exit 1, so the report says `failed`.
- **Output.** With the default text mode, pi prints only the text of the final assistant message on stdout, then exits (`dist/modes/print-mode.js`). `--mode json` would print every event as JSON lines (`docs/json.md`); gstack doesn't use it, so no output parsing is needed.
- **Exit codes.** `0` on success. `1` when the request ends in an error or is aborted (the error goes to stderr), when an exception escapes, or when there's no usable model. On SIGTERM it kills the tools it started and exits `143` (`dist/modes/print-mode.js`, `dist/main.js`).
- **Sessions.** pi saves every run as a session under `~/.pi/agent/sessions/` unless told otherwise (`docs/sessions.md`). `--no-session` uses an in-memory session, so subagent runs don't appear in the user's session list or in `pi --resume`.
- **Context.** pi still loads the user's extensions, skills, prompt templates and the project's `AGENTS.md`/`CLAUDE.md` as usual, as `claude -p` does.

## Report

```json
{
  "status": "ok",
  "role": "explorer",
  "backend": "claude",
  "model": null,
  "durationMs": 41250,
  "output": "..."
}
```

- `status`: `ok` (the CLI exited 0), `failed` (it exited non-zero) or `timeout` (it was killed at the timeout, with everything it started).
- `model`: the model passed to the backend, or `null` when no model flag was passed.
- `output`: the backend's stdout with trailing whitespace removed, collected until shortly after the CLI exits. Background jobs it leaves behind aren't waited for. The backend's stderr is passed through to gstack's stderr.

## Exit codes

- `0`: the subagent finished (`ok`).
- `1`: the subagent ran but failed or timed out. The report is still printed.
- `2`: bad arguments, an unknown role, an unreadable brief, invalid config, or the backend's CLI isn't on `PATH`. Nothing ran, no report is printed, and the error goes to stderr.
