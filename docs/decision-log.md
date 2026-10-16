# Decision log

`gstack log` records why a workflow did what it did: one row per decision, appended to the current project's log.

## Appending

```
gstack log --step build.plan \
  --decision "split the work into two commits" \
  --reason "the refactor and the feature are separate changes" \
  --evidence "git diff --stat" \
  --result "two commits"
```

- All five options are required. `--step` (the playbook step id) and `--decision` must not be empty; `--evidence` and `--result` may be `""`.
- The time is filled in automatically, as an ISO 8601 UTC timestamp.
- Values may contain tabs, newlines and any other characters; they're stored exactly. For a value that starts with a dash (test output, a diff), use the `--field=value` form, e.g. `--result=-1 failing test`.
- It prints nothing and exits 0. A missing or empty field exits 2.

## Reading

```
$ gstack log --show
2026-10-16T09:12:03.120Z  build.plan
  decision: split the work into two commits
  reason:   the refactor and the feature are separate changes
  evidence: git diff --stat
  result:   two commits

$ gstack log --show --json
[{"time":"2026-10-16T09:12:03.120Z","step":"build.plan","decision":"split the work into two commits","reason":"the refactor and the feature are separate changes","evidence":"git diff --stat","result":"two commits"}]
```

Rows print oldest first. With no log yet, `--show` prints nothing and `--show --json` prints `[]`. An unreadable row exits 1, naming the file and line.

## Where it lives

`.gstack/decisions.jsonl` at the project root (the nearest directory at or above the current one that holds `.git`; without one, the current directory). Each line is one JSON object with the string fields `time`, `step`, `decision`, `reason`, `evidence` and `result`, in that order. JSON escaping keeps tabs and newlines inside a field from breaking a row.

The log is a working record for the person or agent running workflows in this checkout, so it's usually best left out of version control: add `.gstack/decisions.jsonl` to `.gitignore`. Repo config in `.gstack/config.json` is separate and is meant to be committed. A hand-edited log that lost its final newline is fine; the next append starts a new line.
