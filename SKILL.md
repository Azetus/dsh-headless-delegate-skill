---
name: dsh-headless-delegate-skill
description: >-
  Delegate a bounded task to a local DeepSeek Harness (DSH) headless worker
  when the user requests DSH to carry it out or independently review it
  ("have DSH compare these files", "让 DSH 复核方案", "让 DSH 实现"). Use for
  answers, file deliverables, and code changes in a specified directory.
license: MIT
compatibility: Requires Node 18+, DSH 0.2.2-rc.5+ with a configured headless profile and credentials, and shell and file access. Git is optional.
metadata:
  version: 0.1.0
---

# DSH Headless Delegate Skill

You choose the working directory, the **permission mode**, and the brief, and
you verify the deliverable. DSH runs one task in a separate process with no
memory of this conversation.

Two rules hold for every dispatch:

- **Pass `--permission-mode` explicitly.** There is no default and no inherited
  mode.
- **The brief must stand alone.** Goal, inputs, allowed actions, deliverable,
  and acceptance criteria all live in the text you send.

## 1. Write the brief

Start from the [five-field template](assets/task-template.md); worked examples
are in [brief.md](references/brief.md). Carry over the user's restrictions,
including limits on what the worker may run. If an input is missing, require the
worker to name the gap instead of guessing.

## 2. Choose the permission mode

| Task | Mode | Notes |
|---|---|---|
| Answer, review, diagnosis | `read-only` | No writes. |
| Create or edit files inside the working directory | `workspace-write` | Writes confined to the working directory and private temp. |
| Code change | `workspace-write` in a prepared worktree | Inspect the diff before landing. |
| Install dependencies, or write outside the working directory | Prepare the environment first; otherwise `danger-full-access` with explicit human approval, or a container/VM | See [Windows](references/dispatch.md#windows). |

`danger-full-access` disables the file sandbox. It is never a default.

On Windows, `workspace-write` covers only the workspace and private temp for
shell commands; npm cache and global prefixes are outside. If ACL provisioning
fails (`SetNamedSecurityInfoW`, Win32 5), file tools still work but shell checks
do not — verify files directly or escalate with approval.

If the task does not fit a row, stop and ask the human.

## 3. Dispatch

```sh
node "<skill-dir>/scripts/dispatch.mjs" --permission-mode <mode> --brief <file> --cd <dir>
```

For a correction, add `--session <id>` from a prior `result.json` and choose
the mode for the follow-up explicitly. Flags, artifacts, and exit codes:
[dispatch.md](references/dispatch.md).

**Artifacts.** Each run gets its own directory, printed on stderr before the
worker starts, holding `brief.txt`, `events.jsonl`, `stderr.txt`, and
`result.json`. Without `--out-dir` the dispatch script creates one under the
system temp (`<tmp>/dsh-headless-delegate-skill/`) and never deletes it. Keep
`--out-dir` outside `--cd` so artifacts cannot enter the task's diff or
`gitStatus`.

## 4. Wait for the run, read the result

The dispatch script blocks until the process exits; read `result.json` in the
printed run directory — if that path was lost, the newest directory under
`<tmp>/dsh-headless-delegate-skill/` is this run. A run is complete only when
all three hold:

- `status === "completed"`
- `reason.kind === "completed"`
- `exitCode === 0`

`finalMessage` is the worker's claim, not proof.

Two traps:

- **`read-only` with a file or code deliverable is a dispatch error**, even when
  `status` is `completed`: nothing could have been written. Inspect for partial
  output, then re-dispatch with `workspace-write` (or `danger-full-access` with
  approval).
- **A `workspace-write` warning about shell provisioning** means shell-dependent
  checks did not run; verify files directly.

If the status is not `completed`, read
[dispatch.md](references/dispatch.md#recovery) before retrying. Do not re-dispatch
blindly; inspect partial output first. Read `events.jsonl` and `stderr.txt`
before choosing resume or re-dispatch.

## 5. Verify, then report

- **Answer:** a nonblank `finalMessage`, with its claims checked against the
  inputs.
- **File:** the named output opened and read against the brief.
- **Code change:** all four passes in
  [verification.md](references/verification.md) — test diff, checks re-run, diff
  against the brief, defects the checks miss.

Commit only when the user explicitly authorized a commit.

Report the answer, or name the verified files, the checks you ran, the warnings
you accepted, and the gaps that remain. For several related tasks, keep the
order and progress record in
[dispatch.md](references/dispatch.md#queues-and-progress).

## Credentials (hard stop)

DSH headless does not use the key saved by the desktop app by default. If the
human has not confirmed authentication, tell them before the first run.

When `result.json` reports `status: "failed"` with `MISSING_CREDENTIAL` in
`error` or `stderrTail`:

- Stop; do not retry.
- Do not ask for the key here, in the brief, or on a command line.
- Tell the human to set it locally; the two options are in
  [credentials.md](references/credentials.md).

## References

| File | Read it when |
|---|---|
| [brief.md](references/brief.md) | Writing or repairing a brief; worked examples. |
| [dispatch.md](references/dispatch.md) | Dispatch options, artifacts, result fields, recovery, queues. |
| [verification.md](references/verification.md) | Accepting a file or code deliverable; the review checklist and commit boundary. |
| [credentials.md](references/credentials.md) | Authentication is missing, or before the first run. |
| [task-template.md](assets/task-template.md) | Starting a new brief. |

## Before reporting

- [ ] The mode was explicit and matched the deliverable type.
- [ ] I read `result.json`, not only the process exit.
- [ ] The completion gate passed, or I explained why not.
- [ ] I read `warnings` and opened the deliverable myself.
- [ ] I committed only with explicit authorization.
