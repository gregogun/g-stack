A harness-neutral skill layer for coding agents: markdown workflows written once against a small verb contract, plus a `gstack` CLI that installs them into a harness and runs subagents on any supported agent CLI and model. The design spec is issue #1.

This is a TypeScript repo and uses pnpm as package manager. Node runs the TypeScript directly (no build step for development).

## Conventions

- Core content (router, playbooks, skills, roles, principles) never names a specific harness and only uses verbs from the verb contract. Harness specifics live in adapters.
- Test at the `gstack` CLI boundary: call the CLI with argv, a temporary home directory and project directory, and fake harness binaries on `PATH`. Don't test internal modules directly.

## Checks

Run these before calling work done; CI runs the same set:

- `pnpm format:check`
- `pnpm lint`
- `pnpm types:check`
- `pnpm knip` (unused files, exports and dependencies; delete rather than ignore)

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
