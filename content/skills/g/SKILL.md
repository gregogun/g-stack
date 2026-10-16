---
name: g
description: Start any task here. Picks the playbook that fits the request, copies its steps into the todo list and runs them.
---

# g

The single entry point. Every other skill, playbook and role is reached from
here by relative path.

Verbs used below are defined in [the verb contract](../../HARNESS.md).

## Steps

1. Read the request and pick the playbook that fits it. If none fits, `ask(question)` which outcome the user wants.
2. Copy the playbook's steps, with their ids, into the list with `todo(steps)`, each as `<id>: <step>`.
3. Run the steps in order. A skipped step stays on the list with its reason.

## Playbooks

- **explain**: the user asks how something in the codebase works. [explain](../../playbooks/explain.md)
