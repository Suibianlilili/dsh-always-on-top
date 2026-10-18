# dsh-always-on-top

[![npm version](https://img.shields.io/npm/v/dsh-always-on-top.svg)](https://www.npmjs.com/package/dsh-always-on-top)
[![license](https://img.shields.io/npm/l/dsh-always-on-top.svg)](LICENSE)

English | [中文](README.zh.md)

> A pin button for the DSH Desktop title bar: click once to keep the window above every other window, click again to release it.

A small DSH plugin — one host route and one client script. No dependencies, no build step, ~30 KB unpacked.

![title bar](docs/titlebar.png)

Idle / pinned:

![idle](docs/pin-idle.png)
![pinned](docs/pin-active.png)

```
┌──────────────────────────────────────────────┐
│  App  Edit                         📌   ─ □ ✕ │
├──────────────────────────────────────────────┤
```

## Features

- A pin button in the title bar, immediately left of the Windows minimize button
- Toggles always-on-top through the Win32 `WS_EX_TOPMOST` window style
- Turns blue while pinned; the tooltip reads "Always on top — click to unpin"
- Remembers the state and re-applies it on the next launch
- Hides itself when not running inside DSH Desktop on Windows

## Install

The package is published on npm as `dsh-always-on-top`.

### From npm (recommended)

```powershell
# DSH CLI (web / tui profiles)
dsh plugin --profile web add dsh-always-on-top

# Or add it to the desktop profile directly
pnpm -C "$env:USERPROFILE\.dsh\profiles\desktop" add dsh-always-on-top

# Then add "dsh-always-on-top" to dsh.profile.bundles and restart the app
```

> The `desktop` profile is owned by the Electron app, so the CLI refuses to manage it.
> Use the command above, or install from the app's plugin settings.

### From GitHub

```powershell
pnpm -C "$env:USERPROFILE\.dsh\profiles\desktop" add "github:Suibianlilili/dsh-always-on-top"

# Then add "dsh-always-on-top" to dsh.profile.bundles and restart the app
```

### Manual

```powershell
# 1. install the package into the profile
pnpm -C "$env:USERPROFILE\.dsh\profiles\desktop" add dsh-always-on-top

# 2. add "dsh-always-on-top" to package.json -> dsh.profile.bundles

# 3. restart the app
```

## Usage

The pin sits at the right end of the title bar, left of the minimize button:

- grey: not pinned
- blue: always on top

Click to toggle. Tooltips follow the system language (English / Chinese).

## How it works

DSH Desktop is an Electron app, so the window belongs to the Electron main process. The plugin runs in the DSH host process, which the main process spawns — therefore `process.ppid` is exactly the process that owns the window.

1. Click → the client sends `POST /dsh-always-on-top/toggle`
2. The host resolves the main window handle with `Get-Process -Id <ppid>`
3. A short PowerShell script calls `user32!SetWindowPos` to set or clear `WS_EX_TOPMOST` (`HWND_TOPMOST` / `HWND_NOTOPMOST`)
4. The host reads `GetWindowLong(GWL_EXSTYLE)` back and only reports success when the bit actually changed

No Electron changes, no main-process injection, no undocumented APIs.

## Compatibility

| | Requirement |
| --- | --- |
| OS | Windows 10 / 11 |
| Runtime | DSH Desktop (Electron) |
| DSH | 0.2.x (`dsh.client` injection), tested on 0.2.1-rc.2 |

The button stays hidden in `dsh web` (browser) and on other operating systems.

### After a DSH upgrade

The button is positioned for the current title bar (42 px tall, ~138 px of window controls). If a future DSH release changes the title bar, adjust two numbers in the CSS in `lib/client.js`:

- button too far left/right or overlapping minimize → `right` (currently `146px`)
- button too high/low → `top` (currently `7px`)

## Limitations

- A toggle takes ~0.4–0.6 s (a PowerShell process compiles the P/Invoke declaration); the button shows a busy state
- State lives in `$DSH_HOME/dsh-always-on-top.json` (default `~/.dsh/`)
- Only the main window is affected; the welcome screen and update dialogs are not

## Development

```powershell
# the app must be running; pass the Electron main process PID
node scripts/toggle-test.mjs <pid>
```

## License

MIT
