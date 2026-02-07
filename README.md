# Codex Intel Rebuilder

This project allows you to port the official Arm64 (Apple Silicon) Codex Desktop App to run on Intel Macs.

## Prerequisites

1.  **Node.js**: Installed on your system.
2.  **Codex CLI**: You must have the official `@openai/codex` CLI installed globally, as we need its x64 binary.
    ```bash
    npm install -g @openai/codex
    ```
3.  **Codex.dmg**: The official Arm64 installer (place it in this directory).
    -   Download: [https://persistent.oaistatic.com/codex-app-prod/Codex.dmg](https://persistent.oaistatic.com/codex-app-prod/Codex.dmg)

## How to Build

Run the rebuild script:

```bash
node rebuild_codex.js
```

This script will:
1.  Mount `Codex.dmg` and extract the app logic (`app.asar`), icon, and configuration.
2.  Download the compatible x64 Electron runtime.
3.  Rebuild native modules (`better-sqlite3`, `node-pty`) for Intel architecture.
4.  Copy the x64 `codex` binary from your local CLI installation.
5.  Generate `Codex_Intel.app`.

## How to Run

Open the generated app:

```bash
open Codex_Intel.app
```

If you see "App is damaged", run:
```bash
xattr -cr Codex_Intel.app
```

## Updates

**Note:** This is a manual port. Auto-updates will **not** work.

To update:
1.  Download the new `Codex.dmg` from OpenAI.
2.  Replace the old `Codex.dmg` in this folder.
3.  Run `node rebuild_codex.js` again.
4.  If the Codex CLI also updated, run `npm update -g @openai/codex` before rebuilding.

## Troubleshooting

-   **Blank Window**: Usually means the executable name doesn't match `Info.plist`, triggering development mode. The script handles this by renaming `Electron` to `Codex`.
-   **Missing Binary**: Ensure the Codex CLI is installed at `/usr/local/lib/node_modules/@openai/codex`.
-   **Crashes**: Check console logs. If `sparkle.node` (auto-updater) crashes, ignore it; the app should still function.
