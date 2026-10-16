# Verb contract

Core content (the router, playbooks, skills, roles and principles) reaches the
harness it runs in only through the verbs below. Each harness adapter documents
how every verb maps to its harness and what happens when its harness lacks one.
Content uses no other verb and names no specific harness.

Write a verb as a call in inline code, for example `spawn(explorer, brief)`.
Inline code that starts with a lowercase word followed by `(` counts as a verb
call, in prose or in a fenced code block, so `gstack check` rejects a call to
any word outside this contract.

## Verbs

### `spawn(role, brief, model?)`

Run a subagent in its own context. `role` names a role brief under `roles/`;
`brief` is the task brief written for this run, following the brief template
below. The subagent sees the role brief followed by the task brief, unchanged,
and nothing else from the current session. `model` overrides the model
configured for the role; leave it out to use the configured one. Returns the
subagent's report.

### `todo(steps)`

Replace the session's visible todo list with `steps`, in order, and keep it
updated as work proceeds. A step that is skipped stays on the list, marked
skipped, with its reason.

### `ask(question)`

Ask the user a question and wait for the answer before continuing.

### `wake(after)`

Resume this workflow after `after` (a duration or an event) without the user
having to prompt again.

### `transcript(session)`

Read a past session as a list of messages in one normalised format, whatever
harness recorded it.

## Brief template

Every role brief, and every task brief passed to `spawn`, uses these sections
as headings:

- Required: `GOAL`, `SCOPE`, `CONTEXT`, `ACCEPTANCE`, `REPORT`.
- Optional: `TIMEBOX`, `FORBIDDEN`.
