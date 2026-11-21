#!/usr/bin/env node
/**
 * dsh-headless-delegate-skill dispatch script.
 *
 * Wraps `dsh --profile headless` so an orchestrating agent can dispatch a
 * self-contained brief, wait for the run, and read a structured result.
 *
 * Node built-ins only. No dependencies, no network calls of its own, no
 * credentials, no telemetry. It launches `dsh` and `git` and never commits.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const VERSION = '0.1.0'
const IS_WIN = process.platform === 'win32'
const DEFAULT_PROFILE = 'headless'
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000
const PERMISSION_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access'])

function usage() {
  process.stdout.write(`dsh-headless-delegate-skill ${VERSION}

Usage:
  node scripts/dispatch.mjs --brief <file> [options]
  cat brief.txt | node scripts/dispatch.mjs [options]

Options:
  --brief <file>       Brief file; omit or use - to read stdin
  --cd <dir>           Working root for DSH (default: current directory)
  --permission-mode <mode>  Required: read-only, workspace-write, or
                       danger-full-access
  --session <id>       Continue a DSH session from a prior result.json
  --timeout <dur>      Watchdog: 30s, 5m, 2h, or 0 to disable (default: 2h)
  --out-dir <dir>      New directory for this run (default: fresh temp directory)
  --profile <name>     DSH profile (default: headless)
  --dsh <path>         DSH launcher (default: DSH_BIN or dsh on PATH)
  -h, --help           Show this help
  -V, --version        Show the script version

Artifacts:
  <out-dir>/result.json, events.jsonl, stderr.txt, brief.txt

Exit codes:
  0 completed, 1 failed, 2 usage error, 124 timeout, 127 dsh unavailable,
  130 interrupted (SIGINT), 143 terminated (SIGTERM)

Examples:
  node scripts/dispatch.mjs --permission-mode read-only --brief review.txt --cd /repo
  node scripts/dispatch.mjs --permission-mode workspace-write --brief fix.txt --cd /repo
  node scripts/dispatch.mjs --permission-mode danger-full-access --brief install.txt --cd /repo
`)
}

function fail(message, code = 2) {
  process.stderr.write(`dsh-headless-delegate-skill: ${message}\n`)
  process.exit(code)
}

function parseDuration(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(value).trim())
  if (!match) fail(`invalid duration: ${value} (use 30s, 5m, 2h, or 0)`)

  const amount = Number(match[1])
  const unit = match[2] || 's'
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000
  return Math.round(amount * multiplier)
}

function parseArgs(argv) {
  const options = {
    brief: undefined,
    cd: process.cwd(),
    permissionMode: undefined,
    session: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outDir: undefined,
    profile: DEFAULT_PROFILE,
    dsh: undefined,
    help: false,
    version: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const nextValue = () => {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) fail(`missing value for ${argument}`)
      index += 1
      return argv[index]
    }

    switch (argument) {
      case '--brief':
        options.brief = nextValue()
        break
      case '--cd':
        options.cd = nextValue()
        break
      case '--permission-mode':
        options.permissionMode = nextValue()
        break
      case '--session':
        options.session = nextValue()
        break
      case '--timeout':
        options.timeoutMs = parseDuration(nextValue())
        break
      case '--out-dir':
        options.outDir = nextValue()
        break
      case '--profile':
        options.profile = nextValue()
        break
      case '--dsh':
        options.dsh = nextValue()
        break
      case '-h':
      case '--help':
        options.help = true
        break
      case '-V':
      case '--version':
        options.version = true
        break
      case '--':
        index = argv.length
        break
      default:
        fail(`unknown option: ${argument}`)
    }
  }

  return options
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function resolveDir(value, label) {
  const directory = path.resolve(value)
  let stats
  try {
    stats = fs.statSync(directory)
  } catch {
    fail(`${label} does not exist: ${directory}`)
  }
  if (!stats.isDirectory()) fail(`${label} is not a directory: ${directory}`)
  return directory
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function makeOutDir(explicit) {
  const directory = explicit
    ? path.resolve(explicit)
    : path.join(os.tmpdir(), 'dsh-headless-delegate-skill', `${timestamp()}-${randomBytes(3).toString('hex')}`)
  fs.mkdirSync(path.dirname(directory), { recursive: true })
  try {
    fs.mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code === 'EEXIST') fail(`run directory already exists: ${directory}; choose a new --out-dir`)
    throw error
  }
  return directory
}

function winQuote(value) {
  const text = String(value)
  if (!/[\s"&|<>^()%!]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function shellFor(command, explicit) {
  if (!IS_WIN) return false
  if (!explicit) return true
  return /\.(cmd|bat)$/i.test(command)
}

function runPreflight(command, explicit) {
  const useShell = shellFor(command, explicit)
  const result = useShell
    ? spawnSync(`${winQuote(command)} --version`, {
        shell: true,
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
      })
    : spawnSync(command, ['--version'], {
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
      })

  if (result.error) {
    return {
      ok: false,
      unavailable: result.error.code === 'ENOENT',
      version: null,
      error: result.error.message,
    }
  }

  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  const version = lines.length > 0 ? lines[lines.length - 1] : null

  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim()
    const unavailable = IS_WIN && /is not recognized|not found|No such file/i.test(stderr)
    return {
      ok: false,
      unavailable,
      version,
      error: stderr || `dsh --version exited with ${result.status}`,
    }
  }

  return { ok: true, unavailable: false, version, error: null }
}

function spawnDsh(command, args, options, explicit) {
  if (!shellFor(command, explicit)) return spawn(command, args, options)

  const line = [winQuote(command), ...args.map(winQuote)].join(' ')
  return spawn(line, { ...options, shell: true })
}

function killTree(child) {
  if (!child || typeof child.pid !== 'number') return

  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }

  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }, 5000).unref()
}

function readTail(file, maxBytes = 64 * 1024, maxLines = 20) {
  try {
    const stats = fs.statSync(file)
    const start = Math.max(0, stats.size - maxBytes)
    const length = stats.size - start
    if (length === 0) return null
    const buffer = Buffer.alloc(length)
    const descriptor = fs.openSync(file, 'r')
    try {
      fs.readSync(descriptor, buffer, 0, length, start)
    } finally {
      fs.closeSync(descriptor)
    }

    const lines = buffer.toString('utf8').split(/\r?\n/).filter((line) => line.trim())
    return lines.length > 0 ? lines.slice(-maxLines).join('\n') : null
  } catch {
    return null
  }
}

function readEvents(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const events = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (typeof event?.type === 'string') events.push(event)
      } catch {
        // A partial trailing line is not an event.
      }
    }
    return events
  } catch {
    return []
  }
}

function readGitStatus(workdir) {
  const result = spawnSync('git', ['--no-optional-locks', '-C', workdir, 'status', '--porcelain=v1'], {
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })

  if (result.error) return { state: 'unavailable', error: result.error.message }
  if (result.status !== 0) {
    const message = String(result.stderr || '').trim()
    if (/not a git repository|must be run in a work tree/i.test(message)) {
      return { state: 'not_applicable' }
    }
    return { state: 'unavailable', error: message || `git status exited with ${result.status}` }
  }
  const stdout = String(result.stdout || '')
  return { state: 'available', entries: stdout.split(/\r?\n/).filter(Boolean) }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function buildResult(fields) {
  return {
    schema: 'dsh-delegate.result',
    status: fields.status,
    exitCode: fields.exitCode,
    signal: fields.signal ?? null,
    abortSignal: fields.abortSignal ?? null,
    timeoutMs: fields.timeoutMs ?? null,
    dshVersion: fields.dshVersion ?? null,
    sessionId: fields.sessionId ?? null,
    finalMessage: fields.finalMessage ?? '',
    reason: fields.reason ?? null,
    gitStatus: fields.gitStatus ?? null,
    permissionMode: fields.permissionMode,
    warnings: fields.warnings ?? [],
    profile: fields.profile,
    workdir: fields.workdir,
    outDir: fields.outDir,
    briefPath: fields.briefPath,
    eventsPath: fields.eventsPath,
    stderrPath: fields.stderrPath,
    startedAt: fields.startedAt,
    finishedAt: fields.finishedAt,
    durationMs: fields.durationMs,
    stderrTail: fields.stderrTail ?? null,
    error: fields.error ?? null,
  }
}

function writeResult(outDir, result) {
  const pending = path.join(outDir, 'result.json.tmp')
  fs.writeFileSync(pending, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  fs.renameSync(pending, path.join(outDir, 'result.json'))
}

function printSummary(result) {
  const seconds = (result.durationMs / 1000).toFixed(1)
  const session = result.sessionId ? ` · ${result.sessionId}` : ''
  process.stdout.write(
    `[dsh-headless-delegate-skill] ${result.status} · exit ${result.exitCode} · ${seconds}s${session} · ${result.outDir}\n`,
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    usage()
    return
  }
  if (options.version) {
    process.stdout.write(`dsh-headless-delegate-skill ${VERSION}\n`)
    return
  }

  if (options.permissionMode === undefined) {
    fail('--permission-mode is required (read-only, workspace-write, or danger-full-access)')
  }
  if (!PERMISSION_MODES.has(options.permissionMode)) {
    fail('--permission-mode must be read-only, workspace-write, or danger-full-access')
  }

  const workdir = resolveDir(options.cd, '--cd')
  const profile = options.profile
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    fail('--profile must contain only letters, digits, dot, underscore, or hyphen')
  }
  if (options.session !== undefined && !/^[A-Za-z0-9._:-]+$/.test(options.session)) {
    fail('--session must contain only letters, digits, dot, underscore, colon, or hyphen')
  }

  if (!options.brief && process.stdin.isTTY) {
    fail('provide --brief <file> or pipe a brief on stdin')
  }

  let brief
  if (options.brief && options.brief !== '-') {
    const briefFile = path.resolve(options.brief)
    try {
      brief = fs.readFileSync(briefFile, 'utf8')
    } catch (error) {
      fail(`cannot read --brief: ${error.message}`)
    }
  } else {
    brief = await readStdin()
  }
  if (!brief.trim()) fail('the brief is empty')

  const outDir = makeOutDir(options.outDir)
  process.stderr.write(`[dsh-headless-delegate-skill] run directory: ${outDir}\n`)
  const briefPath = path.join(outDir, 'brief.txt')
  fs.writeFileSync(briefPath, brief, 'utf8')

  const eventsPath = path.join(outDir, 'events.jsonl')
  const stderrPath = path.join(outDir, 'stderr.txt')
  const permissionMode = options.permissionMode

  const warnings = []
  if (permissionMode === 'danger-full-access') {
    warnings.push('danger-full-access disables the file sandbox; use only for trusted tasks or disposable environments')
  }
  if (isInside(workdir, outDir)) {
    warnings.push('run directory is inside the working directory; its artifacts may appear in gitStatus')
  }
  for (const warning of warnings) {
    process.stderr.write(`[dsh-headless-delegate-skill] warning: ${warning}\n`)
  }

  const dsh = options.dsh || process.env.DSH_BIN || 'dsh'
  const explicit = Boolean(options.dsh)

  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const preflight = runPreflight(dsh, explicit)

  if (!preflight.ok) {
    const status = preflight.unavailable ? 'dsh_unavailable' : 'failed'
    const exitCode = preflight.unavailable ? 127 : 1
    const result = buildResult({
      status,
      exitCode,
      signal: null,
      abortSignal: null,
      timeoutMs: options.timeoutMs,
      dshVersion: preflight.version,
      sessionId: null,
      finalMessage: '',
      reason: null,
      permissionMode,
      warnings,
      profile,
      workdir,
      outDir,
      briefPath,
      eventsPath,
      stderrPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      stderrTail: null,
      error: preflight.error,
    })
    writeResult(outDir, result)
    printSummary(result)
    process.exitCode = exitCode
    return
  }

  const args = [
    '--profile',
    profile,
    '--json',
    '--permission-mode',
    permissionMode,
    '--approval-policy',
    'never',
  ]
  if (options.session) args.push('--session-id', options.session)
  args.push('-')

  const gitBefore = readGitStatus(workdir)
  if (permissionMode === 'workspace-write' && gitBefore.state === 'available' && gitBefore.entries.length > 0) {
    const warning = 'working tree had pre-existing changes; gitStatus before/after cannot isolate this run\'s edits'
    warnings.push(warning)
    process.stderr.write(`[dsh-headless-delegate-skill] warning: ${warning}\n`)
  }
  let eventsFd
  let stderrFd
  let child
  let spawnError = null
  try {
    eventsFd = fs.openSync(eventsPath, 'wx')
    stderrFd = fs.openSync(stderrPath, 'wx')
    child = spawnDsh(
      dsh,
      args,
      {
        cwd: workdir,
        env: process.env,
        stdio: ['pipe', eventsFd, stderrFd],
        windowsHide: true,
        detached: !IS_WIN,
      },
      explicit,
    )
  } catch (error) {
    if (eventsFd === undefined || stderrFd === undefined) throw error
    spawnError = error
  } finally {
    if (stderrFd !== undefined) fs.closeSync(stderrFd)
    if (eventsFd !== undefined) fs.closeSync(eventsFd)
  }

  let timedOut = false
  let aborted = false
  let abortSignal = null
  let exit = { code: null, signal: null }

  if (child) {
    if (child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(brief, 'utf8')
    }

    const timeoutTimer = options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          killTree(child)
        }, options.timeoutMs)
      : null

    const onSigint = () => {
      if (aborted) return
      aborted = true
      abortSignal = 'SIGINT'
      killTree(child)
    }
    const onSigterm = () => {
      if (aborted) return
      aborted = true
      abortSignal = 'SIGTERM'
      killTree(child)
    }
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)

    exit = await new Promise((resolve) => {
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      child.on('close', (code, signal) => done({ code, signal }))
      child.on('error', (error) => {
        spawnError = spawnError || error
        setTimeout(() => done({ code: null, signal: null }), 500).unref()
      })
    })

    if (timeoutTimer) clearTimeout(timeoutTimer)
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
  }

  const events = readEvents(eventsPath)
  const sessionEvent = events.find((event) => event.type === 'session')
  const finalEvent = [...events].reverse().find((event) => event.type === 'final')
  const errorEvent = [...events].reverse().find((event) => event.type === 'error')
  if (permissionMode === 'workspace-write') {
    const sandboxFailure = events.some((event) => {
      if (event.type !== 'tool_result' || event.status !== 'error') return false
      const code = event.error?.code
      const text = typeof event.result === 'string' ? event.result : ''
      return code === 'SANDBOX_PREPARATION_FAILED' || /SANDBOX_PREPARATION_FAILED|SetNamedSecurityInfoW/.test(text)
    })
    const warning = 'workspace-write could not provision the sandbox for shell commands; shell-dependent checks did not run'
    if (sandboxFailure && !warnings.includes(warning)) {
      warnings.push(warning)
      process.stderr.write(`[dsh-headless-delegate-skill] warning: ${warning}\n`)
    }
  }
  const reason = finalEvent?.reason ?? null
  const sessionId = finalEvent?.sessionId ?? sessionEvent?.sessionId ?? options.session ?? null
  const finalMessage = typeof finalEvent?.text === 'string' ? finalEvent.text : ''
  const gitAfter = readGitStatus(workdir)

  let status
  if (aborted) status = 'aborted'
  else if (timedOut) status = 'timeout'
  else if (spawnError?.code === 'ENOENT') status = 'dsh_unavailable'
  else if (exit.code === 0 && reason?.kind === 'completed') status = 'completed'
  else status = 'failed'

  let exitCode
  if (status === 'completed') exitCode = 0
  else if (status === 'aborted') exitCode = abortSignal === 'SIGTERM' ? 143 : 130
  else if (status === 'timeout') exitCode = 124
  else if (status === 'dsh_unavailable') exitCode = 127
  else exitCode = typeof exit.code === 'number' && exit.code !== 0 ? exit.code : 1

  const errorMessage =
    errorEvent?.message ??
    spawnError?.message ??
    (timedOut ? `timeout after ${options.timeoutMs}ms` : null) ??
    (status === 'aborted' ? `aborted by ${abortSignal ?? 'signal'}` : null) ??
    (status === 'failed' && !finalEvent ? 'missing terminal final event' : null) ??
    (status === 'failed' && !reason?.kind ? 'missing final.reason.kind' : null) ??
    (status === 'failed' && typeof exit.code === 'number' && exit.code !== 0 ? `child exited with ${exit.code}` : null) ??
    (reason && reason.kind !== 'completed' ? `turn ended: ${reason.kind}` : null)

  const result = buildResult({
    status,
    exitCode,
    signal: exit.signal ?? null,
    abortSignal,
    timeoutMs: options.timeoutMs,
    dshVersion: preflight.version,
    sessionId,
    finalMessage,
    reason,
    gitStatus: { before: gitBefore, after: gitAfter },
    permissionMode,
    warnings,
    profile,
    workdir,
    outDir,
    briefPath,
    eventsPath,
    stderrPath,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    stderrTail: readTail(stderrPath),
    error: errorMessage,
  })

  writeResult(outDir, result)
  printSummary(result)
  process.exitCode = exitCode
}

main().catch((error) => {
  fail(error?.stack || String(error), 1)
})
