# 10k's Roblox Account Manager

A from-scratch, zero-dependency Roblox multi-account manager for Windows. It's a Node.js service plus a local web UI that opens in its own Edge app window.

## Run

On Windows x64, download and double-click the `Isa-Roblox-Account-Manager-*-win-x64.exe` release asset. The executable includes Node.js. It keeps your saved data in `%LOCALAPPDATA%\IsaRobloxAccountManager\data`.

To move existing accounts from the source version, quit both versions and copy `accounts.vault` from the project's `data` folder into the executable's data folder before adding new accounts there. A Windows-protected vault needs the original Windows account on the same PC. Keep a private backup of the original vault.

### Run from source

1. Install Node.js 22+ (already present on this PC: v24).
2. Double-click **`Start Manager.vbs`**, which runs without a console window. `start.bat` does the same but shows a console with live output. In Settings → App you can add a desktop shortcut.

Starting it again while it's running just reopens the window. Quit from the sidebar. Quitting stops the manager and all of its background processes; your Roblox clients keep running unless you tick **Also close Roblox clients**.

### Build a Windows executable

With x64 Node.js 22 or later installed, run `./tools/build-exe.ps1` from PowerShell in the project root. The executable is written to `dist` and can be attached to a GitHub Release. The build fetches the bundled Node.js version's license and packages the application files and runtime.

## Features

| Area | What it does |
|---|---|
| **Adding accounts** | **Login (browser)** opens a clean, isolated Edge/Chrome window on roblox.com/login. You log in and solve any captcha or 2FA yourself, and the session cookie is captured automatically. **Bulk login** takes `user:pass` lines, opens one window at a time and types the credentials in, so you only solve the captcha. **Import cookies** takes raw cookies, `user:pass:cookie` lines, or any text that contains a cookie. Re-adding an account updates it instead of duplicating it. |
| **Storage** | AES-256-GCM encrypted vault. The key is protected by Windows DPAPI by default, or by a master password (scrypt). Writes are atomic and encrypted backups rotate in `data/backups`. Cookies are redacted from all logs. |
| **Session health** | Validate checks that the cookie is alive, picks up username changes, bans/moderation and Robux. When Roblox rotates a cookie, the new one is saved automatically. **Refresh cookie** mints a fresh session. **Sign out** revokes a cookie on Roblox's side. |
| **Launching** | Uses auth tickets, so **no captcha is ever involved**. Supported targets: place ID or link, Job ID, private server link (`privateServerLinkCode`), new `roblox.com/share?code=…` links, `roblox://` deep links, profile links, and `@username` (follow). Launches run through a serialized queue with a configurable delay so Roblox doesn't throttle you. If your installed Roblox is already the current version, the game starts directly and skips the launcher's update check; otherwise the normal launcher runs and updates first (Settings → "Skip update check when current"). **"Don't update Roblox"** keeps your installed version: it starts the build Roblox registered as installed (or the **Test Roblox executable**, if set) directly and disables Roblox's own updater (`RobloxPlayerInstaller.exe` is renamed to `RobloxPlayerInstaller.exe.iram-blocked` in each Player version folder, and any updater process that starts is closed). Without its updater, the client logs "Updater not found. Skipping update" and keeps running the old build. Turn the setting off to restore the updater. Roblox may refuse to join games on an outdated client (error 280). |
| **Same server** | "Put all selected in the same server": the first account joins, its JobId is read from presence, and the rest join that exact server. If the JobId can't be read, the rest follow the first account. |
| **Multi-instance** | A small detached lock-holder process (`src/lockholder.ps1`) owns `ROBLOX_singletonMutex`. It outlives the manager, so **restarting or crashing the manager never makes your clients close each other**. It exits by itself once the manager is gone and no clients are left. If a client started outside the manager grabbed the lock, the manager refuses to launch more (instead of silently closing the others) and tells you to close all clients once. |
| **Anti-AFK** | Roblox kicks after 20 idle minutes. Every N minutes (default 12) each client briefly gets focus and one real input: jump, a W/S step, a right-click (camera) or a custom key. Your active window and cursor are restored straight after, and minimized clients stay minimized. It waits for you to pause typing, but never more than 3 minutes. It can be turned off per account, and "Nudge all now" runs it immediately. |
| **Fast kick detection** | The manager reads each client's own Roblox log, matched by its unique launch tag so it can't mix clients up. It knows the exact server a client joined and spots kicks and lost connections within seconds. A client stuck on Roblox's "Disconnected" screen is restarted after 25 s instead of after minutes of presence checks. Teleports, which reconnect within seconds, are ignored. On "same account launched elsewhere" (code 264/273) keep-alive pauses instead of fighting the other session. Roblox presence remains as a fallback. |
| **Audio** | Mute all clients, or let only the focused client play sound (Windows volume mixer, per process). Per-account overrides: always muted / never muted. |
| **Discord alerts** | Webhook alerts for crash, kick/disconnect, signed-in-elsewhere, login expired/moderated, relaunch limit reached and (optional) launch failures. Per-account cooldown and Discord rate-limit handling, so a looping problem can't spam the channel. Includes a test button. |
| **Runs in the background** | `Start Manager.vbs` / the desktop shortcut (Settings → App) start it with no console window. Quit from the sidebar. Optional start with Windows. Quitting stops every background process the manager started: `node.exe`, the window helper and the multi-instance lock holder. The lock holder is the one exception while Roblox clients are still open, because without it they would close each other; it exits by itself after the last one closes. Ending the `.exe` in Task Manager also ends its `node.exe`. Quitting or crashing never closes your Roblox clients unless you ask it to. |
| **Restart / Rejoin / Server hop** | Restart relaunches into the same server (no keep-alive needed). Rejoin (launch with an empty target) sends each account back to its last game. Server hop moves an account to a different open server (or the emptiest one), and keep-alive follows it. |
| **Performance** | Set client CPU priority (Normal / Below normal / Idle). Periodic memory trim (in testing, 3 clients went from 3.9 GB to 0.5 GB of working memory). FPS cap. All apply live to running clients. |
| **Favorites** | Save games and servers with name and icon; launch the selection into one with a single click. |
| **UI** | Stats overview, live countdowns, right-click menu on accounts, floating action bar for the selection, drag-to-reorder, group filter chips, and shortcuts: Ctrl+A select all, Enter launch, Del remove, Esc clear, Ctrl+F search. |
| **Process tracking** | Every launch gets a unique browser-tracker ID. The manager reads it back from the process command line, so each PID maps to its account exactly. This survives manager restarts, because running clients are re-adopted. |
| **Windows** | Rename windows to the account name, tile them in a grid, focus or minimize them. You can also close selected clients, all clients, or Roblox windows the manager didn't start. |
| **Keep-alive watchdog** | Relaunches when a client crashes or is closed, restarts frozen clients (hung window), and detects **kicks and disconnects**: if the process is alive but presence says "not in game" twice in a row, it restarts it. Failures back off exponentially, there is a per-hour relaunch cap, an optional scheduled restart to fight memory leaks, and a fallback from a dead JobId to any public server. |
| **Server browser** | Lists servers with players, ping and FPS, and loads more pages on request. Join with the selected accounts, or use a server as the launch target. Find a user's server by username and join it. |
| **Client tweaks** | FPS cap and custom FFlags are merged into `ClientAppSettings.json` in every Roblox version folder. |
| **Utilities** | Groups, aliases, descriptions, custom key/value fields, search and sort, friend the selected accounts with each other, export cookies, and open a browser logged in as any account (cookie changes in that browser are synced back). |
| **Local API** | Off by default, with an optional password. Endpoints: `GET /api/accounts`, `/api/status`, `/api/launch?account=NAME&placeId=ID[&jobId=]`, `/api/kill?account=`, `/api/keepalive?account=&placeId=&enabled=true`, `/api/field?account=&key=[&value=]`, and `/api/cookie?account=` (only if explicitly allowed and a password is set). |

## Test an older Roblox Player build

1. Keep a separate copy of the complete `version-…` folder for the build you want to test. Keep its files together so the executable can find its dependencies.
2. In the manager, open **Settings → Launching**. Set **Test Roblox executable** to the full path to that copy's `RobloxPlayerBeta.exe` and save.
3. Launch an account. The manager starts the selected executable directly, including for keep-alive retries. If that copy is missing or fails to start, the manager reports the error and skips the Windows protocol fallback. Clear the setting when you're done.

The manager's version check and launcher selection are separate from Roblox Player's own update checks. The selected player can still start its updater or be refused an online join with [Roblox error 280](https://en.help.roblox.com/hc/en-us/articles/36792120219284-Error-Code-280-Your-version-of-Roblox-may-be-out-of-date-Please-update-Roblox-and-try-again). To inspect an older build's startup without downloads, use an offline VM with a copy of the version folder. In supported editions of Windows, you can use [Windows Sandbox with networking disabled](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file). The manager's normal account launch requires a live Roblox authentication ticket.

## About captchas

This manager does **not** auto-solve or bypass Roblox's captcha. It doesn't need to for unattended play:

- A captcha appears only at **login**. You do that once per account in the login window.
- After that, launching, relaunching, keep-alive and server-hopping all use the stored session and authentication tickets, which never show a captcha.
- Sessions last a long time. Roblox's own cookie rotations are saved automatically, and "Validate" tells you if an account ever needs a fresh login.

## Security model

- The UI and API listen on `127.0.0.1` only. Host and Origin headers are checked, which blocks DNS-rebinding and cross-site requests.
- The UI needs a per-run random token (set as an HttpOnly, SameSite=Strict cookie by the link `start.bat` opens).
- `data/` holds your encrypted vault. Don't share it. With DPAPI mode it only decrypts under your Windows user.

## Troubleshooting

- **"Multi-instance waiting" / launch refused:** a Roblox client started outside the manager (or while the lock holder wasn't running) owns the lock. Click **Close all** once; the lock is taken automatically and keep-alive accounts come back on their own.
- **"Roblox did not start within Xs":** usually a Roblox update in progress. The client is adopted automatically if it shows up later. Raise the timeout in Settings if your PC is slow.
- **Account shows `invalid`:** the session was revoked (password change, "log out all sessions", or expiry). Use Details → Re-login.
- Logs: Logs tab, or `data/logs/manager.log`.

## Development

```
npm test        # unit tests (vault crypto, target parsing, launch URIs, watchdog state machine)
node src/main.js --no-ui
```

Set `IRAM_DATA_DIR` to use a different data folder, and `IRAM_DEBUG=1` for verbose logs.

Layout: `src/winhelper.ps1` (Win32 + DPAPI helper), `roblox.js` (API client), `vault.js`, `accounts.js`, `launcher.js`, `watchdog.js`, `browser.js` (DevTools-protocol login), `server.js`, `main.js`; the UI is in `public/`.
