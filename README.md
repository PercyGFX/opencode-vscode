# OpenCode for VS Code

A chat panel for [OpenCode 2](https://opencode.ai) that sits in VS Code's secondary side bar, like Claude Code or Copilot Chat.

It connects to the same background server as the OpenCode TUI, so sessions, messages and permission prompts stay in sync between the two. Your OpenCode providers, plugins, MCP servers, skills and agents all work, because they run in that server.

## Features

- **Open it from anywhere**: click the OpenCode icon in the editor title bar (top right of any open file), or run **OpenCode: Open OpenCode**.
- **Session tabs**: keep several sessions open at once. The history button (clock icon) lists the sessions in this workspace, including the ones started in the TUI.
- **Modes**: Manual, Edit automatically, Plan and Auto, from the mode button or with <kbd>Shift</kbd>+<kbd>Tab</kbd>. A mode is saved on the session, so the TUI respects it too.
- **Effort**: pick the model's reasoning level (its variants, such as low, high or max) from the mode menu.
- **Model picker**: switch the session's model from the composer.
- **Permission prompts and questions**: approve edits and commands, and answer the agent's questions, inline.
- **Diffs**: edit prompts show the change; **Open diff** opens it in VS Code's diff editor, where ✓ and ✕ accept or reject it.
- **MCP, plugins and skills** (plug icon): see each MCP server's status and connect or disconnect it, check plugins for errors and updates, and attach skills to your next message. Recommended servers, such as Chrome DevTools for browser control, can be added in one click. Chrome DevTools attaches to the Chrome you already have open: turn on remote debugging once at `chrome://inspect/#remote-debugging` (Chrome 144 or newer).
- **Browser activity**: when OpenCode drives a browser (Chrome DevTools or Playwright MCP), a strip above the composer shows the page it's on and what it last did, and expands to list recent actions and console counts.
- **Slash commands**: type `/` for OpenCode's commands, including your custom ones, plus `/new` and `/compact`.
- **Current file**: the file and selection you're on are attached to your message. Click the eye chip to leave them out.
- **Images**: paste or drop images into the composer to send them with your message.
- **Fork and rewind**: the ↺ button on any of your messages forks the conversation from there, or rewinds the conversation (and optionally your files) to it, with undo.
- **Readable replies**: a Claude Code-style timeline, syntax-highlighted code blocks with a copy button, and how long the model thought.
- **Open in New Tab**: open the chat as an editor tab next to your code.

## Requirements

- VS Code 1.105 or later
- OpenCode 2 (`npm install -g @opencode/cli`)

If the background server isn't running, the extension starts it with `opencode serve --service`, the same way the TUI does.

## How the modes work

| Mode | What it does |
| --- | --- |
| Manual | Asks before every edit and shell command |
| Edit automatically | Edits files without asking; asks before shell commands |
| Plan | Switches to OpenCode's read-only `plan` agent; asks before shell commands |
| Auto | Allows edits and commands, but asks before risky commands (see `opencode.autoModeAskPatterns`) |

Modes are written as session permission rules. OpenCode applies the agent's rules first and the session's rules last, so a mode overrides the agent's defaults for that session only. Sessions that the extension didn't create show "OpenCode default" until you pick a mode.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencode.defaultMode` | `manual` | Mode for new sessions |
| `opencode.autoModeAskPatterns` | `*git push*`, `*rm -rf*`, … | Shell commands that still need approval in Auto mode |
| `opencode.path` | empty | Path to the `opencode` executable, if it isn't on `PATH` |
| `opencode.serverUrl` | empty | Connect to this server instead of the local background server |

## Development

```bash
npm install
npm run build        # bundle to dist/
npm run watch        # rebuild on change
npm run typecheck
npm test
npm run package      # build a .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host. See [AGENTS.md](AGENTS.md) for how the code is organised.
