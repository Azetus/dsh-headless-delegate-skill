# Writing the brief

The worker starts a fresh session: no memory of this conversation, no notes
from earlier tasks — only the brief text and whatever it can read under
`--cd`. Anything the user told you that the worker needs has to be in the
brief.

Start from the [five-field template](../assets/task-template.md). One brief
should produce one reviewable outcome; split unrelated jobs into separate
dispatches.

## The five fields

| Field | Write |
|---|---|
| Goal | One sentence: the question to answer or the outcome to produce. |
| Inputs | Files by path relative to `--cd`, plus the facts the worker cannot derive, including the user's decisions. |
| Allowed actions | What may be read, created, or changed; limits on commands and checks. |
| Deliverable | A final answer with a shape, a named file with a path, or scoped edits with a report. |
| Acceptance criteria | The evidence you will check: citations, section names, paths, commands. |

The brief does not carry the permission mode. Choose the mode at dispatch time
(see the skill body); a write task dispatched `read-only` cannot deliver.

## Examples

### Decide whether a proposal holds

```text
Goal: Determine whether the retry proposal addresses duplicate submissions.
Inputs: design.md and incidents.md in the working directory.
Allowed actions: Read those files. Return findings in the final message.
Deliverable: For each incident, name the proposed mitigation or the gap.
Acceptance criteria: Cover every incident ID and cite the relevant section of
design.md. Label assumptions and call out incidents with insufficient evidence.
```

### Produce a file from notes

```text
Goal: Give the project lead a summary of decisions and action items.
Inputs: meeting-notes.md.
Allowed actions: Read the notes and create summary.md. Preserve the source.
Deliverable: summary.md with Decisions and Action items sections; report its path.
Acceptance criteria: Trace each item to a heading in the notes. Include owners
and due dates where recorded; mark missing ones as unspecified.
```

### Change code in a worktree

```text
Goal: Make a retried refund submission idempotent after a network timeout.
Inputs: services/billing/refund.py and tests/billing/test_refund.py.
Allowed actions: Edit those two files and run the checks below. Leave changes
uncommitted. Preserve the charge path and the public API.
Deliverable: The fix, regression coverage, and a report of paths changed, check
outcomes, and open decisions.
Acceptance criteria: Repeating a submission with the same key creates one
refund. Run pytest tests/billing/ -q and ruff check services/billing/.
```

Discover the project's real commands from its instructions or CI; do not
invent them. Name only the checks the user authorized.

## Corrections

Send a correction to the same session as a short delta: the failed acceptance
criterion, the new evidence, and the scope still authorized. Keep the
directory and profile, pass the mode explicitly, and use a fresh run directory.
See [dispatch.md](dispatch.md) for `--session` and recovery.
