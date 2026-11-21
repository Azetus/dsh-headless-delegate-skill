# Verifying the deliverable

The worker's report is what it believes it did. `result.json` is what the
process did. Neither proves the work is correct.

- The worker implements and reports.
- The dispatch script records the process: exit code, terminal reason, session, event
  stream, working-tree snapshots, warnings.
- You reopen the deliverable, re-run the authorized checks, and decide whether
  to report, request rework, or commit.

If `warnings` reports a dirty pre-run tree, the snapshots cannot separate this
run's edits from earlier ones. Work from the diff and the brief.

## Answers

Require a nonblank `finalMessage`, then test its claims against the inputs you
named. A summary that cites nothing is not an answer; neither is one that
generalizes past the files it was given.

## Files

Open the promised path and read it. Check the structure the brief asked for,
coverage of the named inputs, and the acceptance criteria. A file that exists
but omits half the source material is a failed run, whatever the final message
says.

## Code changes

Four passes, in this order. Do not report a code change before all four.

### 1. Read the test changes first

If the diff touches tests, review those edits before running anything. A
deleted case, a new skip, or an assertion relaxed to a weaker form changes what
a passing suite means; the suite can pass while covering less than the brief
required. Test edits the brief did not request change the contract; report them
rather than folding them into the fix.

### 2. Run the checks yourself

Run the project's real test, lint, and build commands, within the scope the user
authorized. Read the output, not the summary in `finalMessage`. If a check could
not run — the Windows sandbox failed to provision a shell, for example — report
it as a gap. A skipped check is not a pass.

### 3. Compare the diff with the brief

- **Extra work:** refactors, renames, or cleanup the brief did not ask for.
- **Missing work:** the main path exists, but error paths, edge cases, or
  cleanup do not.
- **Decisions taken silently:** a choice the brief did not anticipate. Decide
  whether to keep it; do not accept it just because it is defensible.

Inspect staged and unstaged changes, and open new untracked files directly — a
normal diff does not show their contents.

### 4. Look for defects the checks miss

Generated code fails in ways a passing suite does not reveal:

- Success values or fixture data hardcoded on a path that should do real work.
- Failures swallowed into a default return, hiding the error the check was meant
  to catch.
- Dependencies, methods, or configuration referenced but absent from the
  installed version.
- Residue: imports with no reader, helpers with no caller, branches that cannot
  run, and numbered comments narrating the line below.
- A second implementation of something the file already does — another client,
  error style, or logger.
- Tests that mock the project's own modules or assert internal calls; they break
  easily and protect little.
- Several near-identical tests differing by one value.
- Settings or extension points that nothing in this change uses.
- Defensive checks for states the contract already rules out; they bury the
  checks that matter.

## Reporting and committing

Report the files touched, the checks you ran, the warnings you accepted, and any
open decisions. Leave the change uncommitted unless the user authorized a
commit; then commit only the reviewed changes. Never push or discard work
without authorization.

If a run was interrupted, inspect status, diff, staged diff, and untracked files
before deciding whether to keep the result.
