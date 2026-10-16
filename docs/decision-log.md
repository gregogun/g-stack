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
- Values may contain tabs, newlines and any other characters; they're stored exactly.
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
