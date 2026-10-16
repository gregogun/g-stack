# Explain

Pick this playbook when the user asks how something in the codebase works:
"how does X work", "walk me through Y", "where does Z happen". The answer is
grounded in the code, and every claim says how much it can be trusted.

The steps run through the [how skill](../skills/how/SKILL.md). Verbs are
defined in [the verb contract](../HARNESS.md).

## Steps

Each step starts with its id. Copy the ids into the todo list unchanged, so
the list, any logs and later reflection name the same step.

1. `explain.scope`: Pin down the question and the areas that answer it (run the Split section of the how skill). If the request could mean two different things, `ask(question)` which one first.
2. `explain.prior`: Read what is already written about those areas, such as a README, docs or decision records, and keep what you learn for each explorer's CONTEXT. Skip when nothing written covers them.
3. `explain.explore`: Fan out to one explorer per area (run the Explore section of the how skill).
4. `explain.synthesize`: Hand the explorer reports to a synthesizer (run the Synthesize section of the how skill).
5. `explain.answer`: Reply with the labelled answer (run the Reply section of the how skill).

A step is skipped only when its own text says when to skip it. A skipped step
stays on the list, marked skipped, with its reason.
