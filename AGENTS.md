A harness-neutral skill layer for coding agents: markdown workflows written once against a small verb contract, plus a `gstack` CLI that installs them into a harness and runs subagents on any supported agent CLI and model. The design spec is issue #1.

This is a TypeScript repo and uses pnpm as package manager. Node runs the TypeScript directly (no build step for development).

## Conventions

- Core content (router, playbooks, skills, roles, principles) lives under `content/` in the layout in `docs/content.md`, never names a specific harness and only uses verbs from the verb contract (`content/HARNESS.md`). Harness specifics live in adapters. `gstack check` enforces this; `pnpm test` runs it on the shipped content.
- `gstack spawn` backends live in `src/backends/`, one file per agent CLI, each only building its command line; register a new one in `src/backends/index.ts`. Role briefs ship as `content/roles/<role>.md`. See `docs/spawn.md`.
- Test at the `gstack` CLI boundary: call the CLI with argv, a temporary home directory and project directory, and fake harness binaries first on `PATH` (followed only by `/usr/bin` and `/bin`; child processes must get `context.env` and `context.cwd`, never `process.*`). Don't test internal modules directly. `test/helpers.ts` has `createSandbox`, `fakeBin`, `writeFileIn` and `runCli` for this.
- Each command is a `Command` (`src/command.ts`) in its own file under `src/commands/`, added to the `commands` list in `src/main.ts`. Commands write only through the `Context` they're given and return an exit code; throw `UsageError` or `ConfigError` for exit 2.

## Checks

Run these before calling work done; CI runs the same set:

- `pnpm format:check`
- `pnpm lint`
- `pnpm types:check`
- `pnpm knip` (unused files, exports and dependencies; delete rather than ignore)
- `pnpm test`

The pre-commit hook (lefthook) formats, lints, typechecks and scans staged files for secrets. Don't bypass it with `--no-verify`; fix the finding.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, etc.). Keep commits meaningfully scoped — one logical change per commit — so history reads as a sequence of intentional moves rather than a dump of unrelated edits.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for gregogun/g-stack, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, each named after its role. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
