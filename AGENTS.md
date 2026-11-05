# AGENTS.md

Guidance for AI agents working in this repository.

## Overview

A VS Code extension that puts an OpenCode 2 chat in the secondary side bar. It talks to OpenCode's background server (the one the TUI uses) through the official `@opencode/client` SDK: HTTP calls for actions, and the server's event stream for live updates. It does not run the CLI in a terminal. OpenCode 1.x is not supported.

## Commands

```bash
npm run build       # esbuild: src/extension -> dist/extension.js, src/webview -> dist/webview.js + .css
npm run watch
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run package     # vsce package --no-dependencies
```

All runtime dependencies are bundled, so they live in `devDependencies`.

## Layout

```
src/
├── shared/                 # Used by both sides; no Node or VS Code imports
│   ├── protocol.ts         # Messages between the extension host and the webview
│   ├── modes.ts            # Modes -> session permission rules
│   └── commands.ts         # Slash command parsing and matching
├── extension/              # Extension host (Node)
│   ├── extension.ts        # activate(): wiring, commands, settings
│   ├── connection.ts       # Finds or starts the background server, event stream, reconnects
│   ├── handlers.ts         # One handler per webview request (the only place that calls the SDK)
│   ├── chat-host.ts        # Side bar view and editor-tab webviews
│   └── paths.ts            # Windows path and executable handling
└── webview/                # Preact UI (browser)
    ├── store.ts            # Pure reducer: tabs, sessions, server events
    ├── controller.ts       # Requests and reloads (side effects)
    ├── messages.ts         # Server messages -> UI message model
    ├── forms.ts            # Agent questions (forms)
    └── components/
```

## Things to know

- **Modes are session permission rules.** OpenCode evaluates agent rules, then session rules, and the last match wins. `setSessionMode` swaps only the rules the previous mode added (stored in session metadata under `vscode`), so rules added by others survive. Plan mode also switches to the `plan` agent and remembers the previous one.
- **Directories are case-sensitive on the server.** VS Code reports `c:\...`; the TUI records `C:\...`. `serverDirectory()` upper-cases the drive so sessions match.
- **Windows spawn.** The SDK spawns the server without a shell, which can't run npm's `opencode.cmd` shim. `resolveOpencodeCommand()` finds the real `opencode.exe`.
- **Events aren't filtered by project.** Several session events carry no location. The webview only applies events to sessions it has loaded, and it reloads messages from the server when an execution ends, so the reducer's live updates don't have to be perfect.
- **Closing a tab stops its session.** Each webview reports its open session tabs (the `tabs` message). When a session's last tab closes, in a chat view or by closing an editor tab, `ChatHost` interrupts it if it's still running. Hiding the side bar doesn't count, because its tabs come back.
- **Webview requests are a fixed list** (`RequestMap` in `protocol.ts`). Add a handler there instead of passing SDK calls through.

## Style

- TypeScript strict, `verbatimModuleSyntax` (use `import type`), relative imports with `.ts`/`.tsx` extensions
- Named exports only (default imports are fine for packages that only offer them, like `markdown-it`)
- No semicolons, double quotes, 2-space indentation, trailing commas
- `kebab-case` file names, tests colocated as `*.test.ts`
- No `as any`, `@ts-ignore` or `@ts-expect-error`
- Webview colours come from `--vscode-*` theme variables
