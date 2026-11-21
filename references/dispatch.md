# Running a task

`scripts/dispatch.mjs` launches one DSH process, writes the brief to its stdin,
and records the outcome. It runs in the foreground and exits when the worker
does; there is no polling loop. Node 18+, no dependencies.

## Command line

| Flag | Meaning |
|---|---|
| `--brief <file>` | Brief file, read relative to your directory. Omit or pass `-` to use stdin. |
| `--cd <dir>` | Existing working directory for the task. Defaults to your directory. |
| `--permission-mode <mode>` | Required: `read-only`, `workspace-write`, or `danger-full-access`. |
| `--session <id>` | Continue a session from a prior `result.json`. Also needs an explicit mode. |
| `--timeout <duration>` | Watchdog such as `30s`, `5m`, `2h`; `0` disables it. Default `2h`. |
| `--out-dir <dir>` | New directory for this invocation; the parent may exist. Defaults to a fresh temp directory. |
| `--profile <name>` | DSH profile, default `headless`. |
| `--dsh <path>` | Launcher, default `DSH_BIN` then `dsh` on PATH. |
| `-h`, `--help`, `-V`, `--version` | Script help or version. |

The dispatch script writes nothing outside `--out-dir` and never commits.

## Artifacts

The run directory is printed on stderr before the worker starts. It holds:

- `brief.txt` — exactly what was sent.
- `events.jsonl` — the DSH event stream; opens with `session`, ends with `final`.
- `stderr.txt` — diagnostics.
- `result.json` — the structured contract described next.

Keep run directories outside the task's inputs. Artifacts inside a repository
appear in `gitStatus` and can contaminate a comparison.

## Result contract

`schema: "dsh-delegate.result"`.

| Field | Meaning |
|---|---|
| `status` | `completed`, `failed`, `timeout`, `aborted`, or `dsh_unavailable`. |
| `exitCode`, `signal`, `abortSignal` | Process outcome; signal fields when one applies. |
| `timeoutMs` | Watchdog budget (`0` = disabled). `status` says whether it fired. |
| `reason`, `finalMessage` | Terminal DSH reason and the worker's own report. |
| `sessionId`, `profile`, `dshVersion` | Inputs for rework and diagnostics. |
| `permissionMode` | The mode this run was dispatched with. |
| `warnings` | Script observations; read them before trusting `gitStatus`. |
| `gitStatus` | `before`/`after` porcelain snapshots, or `unavailable` / `not_applicable`. Observations, not attribution. |
| `workdir`, `outDir`, `briefPath`, `eventsPath`, `stderrPath` | Locations for this attempt. |
| `startedAt`, `finishedAt`, `durationMs` | Timing. |
| `error`, `stderrTail` | Diagnostics; the tail keeps up to 20 nonblank lines from the last 64 KiB. |

Completion requires `status === "completed"`, meaning exit 0 and a terminal
`final.reason.kind === "completed"`. Nothing about the content is implied.

## Outcomes and exit codes

- `completed` (0): the run ended normally. Inspect the deliverable.
- `failed` (1 or the child's code): read `error`, `stderrTail`, and
  `events.jsonl`. A missing terminal event fails even on exit 0.
- `timeout` (124): the watchdog requested termination. DSH may catch the signal
  and exit 0; trust `status`, not the child's code.
- `aborted` (130 or 143): the dispatch script received `SIGINT` or `SIGTERM`;
  `abortSignal` names it.
- `dsh_unavailable` (127): the launcher was not found; pin it with `--dsh` or
  `DSH_BIN`.
- Usage errors exit 2, before a run directory exists.

## Recovery

Inspect partial output before any retry: the working tree may already contain
edits.

- **Resume** with `--session <id>`, a delta brief, the same directory and
  profile, a fresh `--out-dir`, and an explicit mode (`read-only` to review,
  `workspace-write` to continue writing).
- **Re-dispatch** a fresh session when the premise changed or the run produced
  nothing usable.
- **Do not retry** a `MISSING_CREDENTIAL` failure; fix credentials first.
- **Dirty pre-run tree warnings** mean the snapshots cannot isolate this run;
  compare the diff with the brief instead.
- **Sandbox warnings** under `workspace-write` mean shell checks did not run;
  verify files directly or escalate for approval.

## Queues and progress

One brief per independently reviewable deliverable, one run directory per task.
Order dependent tasks so each starts from the verified output of the previous
one. Keep a progress record outside the task inputs:

```json
{"task":"compare-configs","run":"runs/compare-01","permissionMode":"read-only","status":"completed","accepted":true,"deliverable":"finalMessage"}
{"task":"summarize-notes","run":"runs/notes-01","permissionMode":"workspace-write","status":"completed","accepted":false,"deliverable":"summary.md","gap":"Missing a recorded action item"}
```

Read-only workers can share stable inputs. Isolate writers so one run cannot
change another's inputs during review; separate worktrees work well for
concurrent code changes. Record a commit only when one was authorized and made.

## Windows

`workspace-write` grants the workspace and a private temp directory to
PowerShell/terminal/PTC. npm cache and global prefixes sit outside, so
dependency installation normally needs a prepared environment or
`danger-full-access`; `--add-dir` does not change subprocess ACLs. ACL
provisioning can fail with `SetNamedSecurityInfoW` (Win32 5), leaving shell
commands unavailable while file tools still work.

## Credentials

The key comes from the launch environment, `<--cd>/.env`, or `$DSH_HOME/.env`.
Setup, precedence, and the missing-credential procedure:
[credentials.md](credentials.md).
