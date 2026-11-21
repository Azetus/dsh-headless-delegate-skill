# Credentials

DSH headless does **not** use the API key or the account login saved by the DSH
desktop app by default. The headless bundle disables the managed credential
store and the account consumers:

```yaml
- id: credentials
  disabled: true
- id: authorization
  disabled: true
- id: deepseek-account
  disabled: true
```

The default headless model route is `deepseek-official`, which is the API-key
route. The account route (`deepseek-account`) is separate and does not fall
back to the API key, or the other way around.

## What headless reads

With the managed store disabled, the API-key route resolves
`DEEPSEEK_API_KEY` from, highest priority first:

1. The inherited launch environment of the `dsh` process.
2. `<invocation cwd>/.env` — for the dispatch script, this is the `--cd` directory.
3. `$DSH_HOME/.env` — the harness home's `.env` (on Windows, usually
   `%USERPROFILE%\.dsh\.env`; on POSIX, usually `~/.dsh/.env`).

An exported but empty `DEEPSEEK_API_KEY` shadows the `.env` fallbacks. Unset it
if it is empty.

If a profile enables the managed store, the normal order becomes:

1. `$DSH_HOME/.credentials.yaml` (stored value).
2. Inherited launch environment.
3. `<cwd>/.env`.
4. `$DSH_HOME/.env`.

## Option 1: `.env` (recommended)

Create `$DSH_HOME/.env`:

```dotenv
DEEPSEEK_API_KEY=sk-...
```

or a project-scoped `<--cd>/.env` with the same line.

Notes:

- `$DSH_HOME/.env` is a global fallback layer. It can affect other profiles that
  have no higher-priority credential; a desktop/Web key already in
  `$DSH_HOME/.credentials.yaml` wins over it.
- A project `<--cd>/.env` is higher priority than the home file, and is scoped to
  runs whose working directory is that project.
- `.env` is plaintext. Do not commit it.
- `DEEPSEEK_BASE_URL` is special: it is read only from the launch environment or
  `$DSH_HOME/.env`, never from a project `.env`. `DEEPSEEK_API_KEY` has no such
  restriction.
- Restart the orchestrating session after changing the environment. Each dispatch
  invocation is a new child process and inherits the environment it is given.

## Option 2: re-enable stored credentials

Edit `$DSH_HOME/profiles/headless/cordis.patch.yml`:

```yaml
- id: credentials
  disabled: false
- id: authorization
  disabled: false
- id: deepseek-account
  disabled: false
```

What each part buys:

- `credentials`: lets `deepseek-official` resolve the stored
  `refs.DEEPSEEK_API_KEY` from `$DSH_HOME/.credentials.yaml`.
- `authorization` + `deepseek-account`: re-enable the account login path.
- To use the **account route** rather than the API-key route, also change the
  default provider:

  ```yaml
  - id: agent-default-model
    config:
      provider: deepseek-account
      model: deepseek-flash
  ```

Tradeoffs:

- Stored credentials take precedence over inherited environment and `.env`. A
  stale desktop key will override a fresh `.env` value until you update or
  remove the stored key.
- Headless now depends on the desktop credential store and is less suitable for
  CI or a clean one-shot environment.
- The account route needs an existing desktop login; headless has no interactive
  login flow.

## Agent behavior on `MISSING_CREDENTIAL`

When `result.json` reports `status: "failed"` and `error` or `stderrTail`
contains `MISSING_CREDENTIAL`:

1. Stop. Do not retry the same dispatch.
2. Do not ask the human to paste the key into the conversation, the brief, or a
   command line.
3. Tell the human to set it locally using Option 1 or Option 2 above.
4. Wait for confirmation, then run a small smoke task:

   ```sh
   node "<skill-dir>/scripts/dispatch.mjs" --permission-mode read-only --brief smoke.txt --cd "/path/to/scratch"
   ```

5. Only after that succeeds, continue the original task.

## Security notes

- `.env` and `.credentials.yaml` are readable by processes running as your OS
  user; this is not a boundary against the agent's own tools.
- Never put a key in a brief, a prompt, a result file, or a shell command that
  will be logged.
- Prefer a dedicated key for delegation over copying the desktop key.
