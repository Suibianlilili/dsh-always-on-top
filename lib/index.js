// dsh-always-on-top host half.
//
// Owns the "is this window pinned" state and flips the Win32 WS_EX_TOPMOST
// bit on the DSH Desktop window. The window belongs to the Electron main
// process, which is our parent process (the host is spawned by it), so we
// locate it through process.ppid instead of guessing by title.
//
// Routes (same origin as the web UI):
//   GET  /dsh-always-on-top/status -> { supported, pinned, desired }
//   POST /dsh-always-on-top/toggle -> { supported, pinned, desired }
//   POST /dsh-always-on-top/set    -> { supported, pinned, desired }   body: { on: boolean }
//
// `pinned` is the live window state; `desired` is what the user asked for and
// survives restarts (stored under $DSH_HOME). The client re-applies `desired`
// once the window exists again.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const execFileP = promisify(execFile)

export const name = 'dsh-always-on-top'
export const inject = ['webServer']

const BASE = '/dsh-always-on-top'
const PS_TIMEOUT_MS = 15000

// Only the packaged Electron desktop on Windows has both a parent window and
// the user32 surface this plugin drives. Everywhere else the button stays hidden.
const SUPPORTED = process.platform === 'win32' && /deepseek harness/i.test(basename(process.execPath))

let pinned = false
let desired = false
let chain = Promise.resolve()

const STATE_DIR = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_FILE = join(STATE_DIR, 'dsh-always-on-top.json')

async function loadDesired() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    desired = parsed !== null && typeof parsed === 'object' && parsed.pinned === true
  } catch {
    desired = false
  }
}

async function saveDesired() {
  try {
    await mkdir(STATE_DIR, { recursive: true })
    await writeFile(STATE_FILE, `${JSON.stringify({ pinned: desired }, null, 2)}\n`, 'utf8')
  } catch {
    /* persistence is best effort; the pin still works without it */
  }
}

function remember(value) {
  pinned = value
  desired = value
  void saveDesired()
}

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace DshPin {
  public static class Native {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  }
}
"@
$targetPid = __PID__
$proc = Get-Process -Id $targetPid -ErrorAction Stop
$hwnd = $proc.MainWindowHandle
if ($hwnd.ToInt64() -eq 0) { throw 'DSH window not found' }
if ($proc.MainWindowTitle -notlike '*DeepSeek Harness*') { throw 'not a DSH Desktop window' }
$ex = [DshPin.Native]::GetWindowLong($hwnd, -20)
$isTopmost = (($ex -band 8) -ne 0)
$mode = '__MODE__'
$want = if ($mode -eq 'toggle') { -not $isTopmost } elseif ($mode -eq 'on') { $true } else { $false }
if ($want -ne $isTopmost) {
  $after = if ($want) { [IntPtr](-1) } else { [IntPtr](-2) }
  [void][DshPin.Native]::SetWindowPos($hwnd, $after, 0, 0, 0, 0, 0x0013)
}
$ex2 = [DshPin.Native]::GetWindowLong($hwnd, -20)
$nowTopmost = (($ex2 -band 8) -ne 0)
if ($nowTopmost -ne $want) { throw 'window state did not change' }
if ($nowTopmost) { 'pinned' } else { 'unpinned' }
} catch {
  'ERROR:' + $_.Exception.Message
}
`

function runPinScript(mode, targetPid) {
  const script = PS_SCRIPT.replaceAll('__PID__', String(targetPid)).replaceAll('__MODE__', mode)
  return execFileP(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: PS_TIMEOUT_MS, windowsHide: true },
  ).then(({ stdout }) => {
    const lines = String(stdout)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
    const last = lines.at(-1)
    if (last === 'pinned') return true
    if (last === 'unpinned') return false
    if (last !== undefined && last.startsWith('ERROR:')) throw new Error(last.slice('ERROR:'.length).trim())
    throw new Error(last === undefined ? 'pin helper returned no result' : `unexpected pin helper output: ${last}`)
  })
}

function describeError(error) {
  const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
  const text = stderr.trim() || (error instanceof Error ? error.message : String(error))
  return text.replace(/\s+/gu, ' ').slice(0, 300)
}

/** Serialize pin changes so two clicks cannot race each other. */
function enqueue(task) {
  const next = chain.then(task, task)
  chain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/**
 * Flip the window's topmost bit.
 * @param {'toggle' | 'on' | 'off'} mode - Requested transition.
 * @param {number} [targetPid] - Window owner; defaults to the Electron main process.
 * @returns {Promise<boolean>} Whether the window is topmost afterwards.
 */
export function setWindowPinned(mode, targetPid = process.ppid) {
  if (!SUPPORTED) return Promise.reject(new Error('only DSH Desktop on Windows is supported'))
  return enqueue(() =>
    runPinScript(mode, targetPid).then(
      (value) => {
        remember(value)
        return value
      },
      (error) => {
        throw new Error(describeError(error))
      },
    ),
  )
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  let raw = ''
  for await (const chunk of request) raw += chunk
  if (raw === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function register(ctx, path, handler) {
  return ctx.webServer.register({ kind: 'exact', path: `${BASE}${path}`, handler })
}

export async function apply(ctx) {
  await loadDesired()
  ctx.effect(() => {
    const disposeStatus = register(ctx, '/status', (_request, response) => {
      sendJson(response, 200, { supported: SUPPORTED, pinned, desired })
    })

    const disposeToggle = register(ctx, '/toggle', (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'POST required' })
        return
      }
      if (!SUPPORTED) {
        sendJson(response, 200, { supported: false, pinned: false, desired: false })
        return
      }
      setWindowPinned('toggle').then(
        (value) => sendJson(response, 200, { supported: true, pinned: value, desired }),
        (error) => sendJson(response, 500, { supported: true, pinned, desired, error: error.message }),
      )
    })

    const disposeSet = register(ctx, '/set', (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'POST required' })
        return
      }
      if (!SUPPORTED) {
        sendJson(response, 200, { supported: false, pinned: false, desired: false })
        return
      }
      readJsonBody(request).then(
        (body) => setWindowPinned(body.on === true ? 'on' : 'off'),
        () => setWindowPinned('off'),
      ).then(
        (value) => sendJson(response, 200, { supported: true, pinned: value, desired }),
        (error) => sendJson(response, 500, { supported: true, pinned, desired, error: error.message }),
      )
    })

    return () => {
      disposeStatus()
      disposeToggle()
      disposeSet()
    }
  }, 'dsh-always-on-top: routes')
}
