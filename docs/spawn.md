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

| Backend  | Command line                                       |
| -------- | -------------------------------------------------- |
| `claude` | `claude -p --output-format text [--model <model>]` |

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
- `output`: the backend's stdout with trailing whitespace removed. The backend's stderr is passed through to gstack's stderr.

## Exit codes

- `0`: the subagent finished (`ok`).
- `1`: the subagent ran but failed or timed out. The report is still printed.
- `2`: bad arguments, an unknown role, an unreadable brief, invalid config, or the backend's CLI isn't on `PATH`. Nothing ran, no report is printed, and the error goes to stderr.
