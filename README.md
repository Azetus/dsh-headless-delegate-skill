# dsh-headless-delegate-skill

An Agent Skill for delegating a bounded task to a local DeepSeek Harness
headless worker. Use it to obtain an independent answer, generate a file from
source materials, or implement a scoped code change. The orchestrating agent
chooses the permission mode, checks the deliverable against the user's brief,
and commits only when authorized.

## Status

Version `0.1.0`. Every dispatch and resume must pass `--permission-mode`; there
is no default mode.

Tested on Windows with DSH 0.2.2-rc.5: read-only, `workspace-write` through
file tools, resume, timeout and abort handling, `danger-full-access`, and usage
errors. Under `workspace-write`, shell provisioning fails with
`SetNamedSecurityInfoW` (Win32 5), so shell-dependent tasks need a prepared
environment or `danger-full-access`. macOS/Linux and shell-dependent
`workspace-write` remain unverified.

## Requirements

- Node.js 18+ for the dispatch script
- DSH 0.2.2-rc.5 or newer with a configured `headless` profile, and `dsh` on
  PATH or `DSH_BIN` set
- A DeepSeek API key in the environment, the working directory's `.env`, or
  `$DSH_HOME/.env`. Desktop-managed credentials use a separate store and are not
  read by headless unless the profile re-enables them.
- An existing working directory. Git is optional and supplies repository status
  observations when available.

## Install

Install it the way your agent installs skills: copy this directory into that
agent's skills root, or ask the agent to install it for you. Keep the directory
named `dsh-headless-delegate-skill` — the Agent Skills spec requires the folder
name to match the frontmatter `name`.

The skill starts a local DSH process, so the machine running your agent needs
DSH installed and a DeepSeek API key configured. Your agent must also be
allowed to start Node processes and reach the DeepSeek API.

## Quick start

Prepare a brief from the [template](assets/task-template.md). Select a working
directory containing its inputs.

```sh
node "<skill-dir>/scripts/dispatch.mjs" \
  --permission-mode read-only \
  --brief review.txt \
  --cd "/path/to/documents"
```

Then read `result.json` in the run directory printed by the dispatch script.

## Permission modes

Every dispatch and every resume requires exactly one mode:

| Task | Mode |
|---|---|
| Answer, review, diagnosis | `read-only` |
| Create or edit files inside the working directory | `workspace-write` |
| Code change | `workspace-write` in a prepared worktree |
| Install dependencies or write outside the working directory | Prepare the environment first; otherwise `danger-full-access` with explicit human approval, or use a container/VM |

`danger-full-access` disables the file sandbox. It is never a default.

On Windows, `workspace-write` only grants the workspace and a private temp
directory to PowerShell/terminal/PTC. npm cache and global prefixes live
outside, so dependency installation normally needs a prepared environment or
`danger-full-access`; `--add-dir` does not change subprocess ACLs. ACL
provisioning can also fail (`SetNamedSecurityInfoW`, Win32 5), leaving shell
commands unavailable while file tools still work.

## What is in the box

```text
dsh-headless-delegate-skill/
├── SKILL.md
├── scripts/dispatch.mjs
├── references/
│   ├── brief.md
│   ├── dispatch.md
│   ├── verification.md
│   └── credentials.md
└── assets/task-template.md
```

## How it works

`dispatch.mjs` runs:

```text
dsh --profile <profile> --json \
    --permission-mode <read-only|workspace-write|danger-full-access> \
    --approval-policy never \
    [--session-id <id>] \
    -
```

with the brief on stdin and the target directory as the working directory. It
parses the `--json` event stream, writes `result.json`, and never commits.

Artifacts per run:

- `result.json` — the structured contract
- `events.jsonl` — the raw event stream
- `stderr.txt` — diagnostics and reasoning deltas
- `brief.txt` — the exact brief sent

## Result contract

`result.json` uses `dsh-delegate.result`. See
[dispatch.md](references/dispatch.md) for every field. The short
version: `status`, `exitCode`, `signal`, `abortSignal`, `timeoutMs`,
`sessionId`, `finalMessage`, `reason`, `permissionMode`, `warnings`,
`gitStatus` observations, and the log paths.

A run is complete only when `status === "completed"`, which requires the script
to see exit 0 and `final.reason.kind === "completed"`. Correctness is still the
orchestrator's review.

## Trust

- Node built-ins only; no dependencies.
- No network calls of its own, no credentials, no telemetry.
- It launches `dsh` and `git`; it never commits, pushes, or deletes.
- It writes only to its `--out-dir`.
- `gitStatus` is an observation, not attribution; the orchestrator still owns
  verification.

Read `scripts/dispatch.mjs` before running it.
