# Transcripts

`gstack transcript` reads a Claude Code or pi session file and prints it as JSON in one normalised format, so a skill (for example reflect) can read a session the same way in either harness.

## Choosing the session

```
gstack transcript [--harness claude-code|pi] [--session <id> | --file <path>]
```

- No options: the most recently modified session started in the current directory, in any harness.
- `--harness`: only look at that harness's sessions (or, with `--file`, read the file as that harness's format).
- `--session <id>`: the session with that id, in any project. The id is the Claude Code session id or the id in a pi session file's name.
- `--file <path>`: read this file. Its format is detected unless `--harness` is given.

Sessions are looked up where each harness stores them:

| Harness       | Location                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `claude-code` | `$CLAUDE_CONFIG_DIR/projects/<cwd, non-alphanumerics as ->/<id>.jsonl` (default `~/.claude`)     |
| `pi`          | `$PI_CODING_AGENT_DIR/sessions/--<cwd, / as ->--/<timestamp>_<id>.jsonl` (default `~/.pi/agent`) |

The current directory must be the one the harness was started in; a subdirectory has its own sessions.

## Output

```json
{
  "harness": "pi",
  "sessionId": "019c4d2e-8f10-7a3b-9c4d-5e6f7a8b9c0d",
  "file": "/home/me/.pi/agent/sessions/--work-demo--/2026-03-02T10-00-00-000Z_019c4d2e-8f10-7a3b-9c4d-5e6f7a8b9c0d.jsonl",
  "turns": [
    {
      "role": "user",
      "text": "What does greet return?",
      "timestamp": "2026-03-02T10:00:01.000Z"
    },
    {
      "role": "assistant",
      "text": "Let me read it.",
      "toolCalls": [
        { "id": "call_1", "name": "read", "input": { "path": "src/greet.ts" } }
      ],
      "timestamp": "2026-03-02T10:00:02.000Z"
    },
    {
      "role": "tool",
      "toolCallId": "call_1",
      "toolName": "read",
      "text": "export const greet = ...",
      "isError": false,
      "timestamp": "2026-03-02T10:00:03.000Z"
    }
  ]
}
```

- `sessionId` is the id in the file's name (what `--session` looks up), or the id inside the file if the name has none.
- `turns` are in conversation order. `role` is `user`, `assistant` or `tool`.
- An assistant turn's `toolCalls` lists each call with the harness's own tool name and input. Each result is a later `tool` turn whose `toolCallId` matches.
- `text` joins a message's text blocks with newlines. Images become `[image]`. Thinking is left out.
- `timestamp` is an ISO time, or `null` if the file has none.
- Tool names and inputs are not translated between harnesses (Claude Code's `Read` takes `file_path`, pi's `read` takes `path`).

What each harness's file contributes:

- **Claude Code:** user and assistant lines. Bookkeeping lines, subagent (sidechain) lines and injected (meta) lines are skipped. An assistant message split over several lines becomes one turn.
- **pi:** message entries on the current branch, from the last entry back to the root; abandoned branches are skipped. A command the user ran with `!` becomes a user turn `$ <command>\n<output>`. Summaries and extension messages are skipped.

## Errors

Exit 1, with the message on stderr:

- no session for the current directory, or none with the given id
- a file that can't be read or parsed; the message names the file (and the line, for invalid JSON). A last line with no newline after it is one the harness is still writing, so it is skipped rather than reported.

Exit 2 for bad usage: an unknown harness, or both `--file` and `--session`.
