---
name: how
description: Explain how part of a codebase works. Fans out to read-only explorers, then hands their reports to a synthesizer that labels every claim measured, inferred or guess.
metadata:
  discoverable: 'false'
---

# how

Answers "how does X work" with more ground covered than one context can hold.
Explorers ([role](../../roles/explorer.md)) each read one area and report what
they found. A synthesizer ([role](../../roles/synthesizer.md)) combines their
reports into one answer whose claims are labelled. Verbs are defined in
[the verb contract](../../HARNESS.md).

Run the sections in order. When a playbook step points at a section, run just
that section for the step.

## Split

1. Restate the question in one sentence.
2. Name the areas of the codebase that answer it: directories, modules, entry
   points or flows. Look around only enough to name them; the explorers do the
   reading.
3. Pick one to four areas that don't overlap. If the question covers one
   small area, use one explorer. If the question spans more than four, pick the four that matter
   most and note the rest for the reply.

## Explore

For each area, write a task brief and run `spawn(explorer, brief)`. Run them in
parallel when the harness can. Each brief is self-contained: the explorer sees
nothing from this session.

```markdown
## GOAL

<the question, narrowed to this area>

## SCOPE

<the files or directories to read>. Read only; change nothing.

## CONTEXT

<the whole question, the other areas being explored by others, and anything
already known, such as docs that describe this area>

## ACCEPTANCE

Every claim names the file or command it rests on and is labelled measured, inferred or
guess.

## REPORT

Answer, findings and open questions, as the role brief describes.
```

If an explorer fails or times out, run it once more with a narrower scope. If
it fails again, record the area as missing and carry on.

## Synthesize

Write one task brief holding the question and every explorer report, and run
`spawn(synthesizer, brief)`. Leave `model` out, so the model configured for its
role is used; point that role at another model family in config to get a
second opinion.

```markdown
## GOAL

Answer: <the question>

## SCOPE

Combine the reports below. Read files only to settle a conflict or check a
claim the answer depends on.

## CONTEXT

Areas explored: <list>. Missing: <areas whose explorer failed, or "none">.

### Report: <area>

<the explorer's report, unchanged>

<one such section per report>

## ACCEPTANCE

Every claim is labelled measured, inferred or guess. Measured claims name what
was read or run.

## REPORT

Answer, claims, conflicts and gaps, and open questions, as the role brief
describes.
```

If the synthesizer fails or times out, run it once more. If it fails again,
reply with the explorer reports as they are and say they were not synthesized.

## Reply

Give the user the synthesizer's answer with its labels and sources intact.
Then list its conflicts and gaps, the areas left out at Split, and its open
questions. Don't upgrade a label or drop a source while rewording.
