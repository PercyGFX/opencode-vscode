# Changelog

## 1.0.1

- Closing a chat tab, or an editor tab with chats in it, now stops its running sessions, as pressing Esc does. Before, they kept running in the background and spending tokens. A session still open in another view keeps running.

## 1.0.0

First public release.

- Chat panel in the secondary side bar, connected to the OpenCode 2 background server, so sessions stay in sync with the TUI
- Session tabs and history, including sessions started in the TUI
- Manual, Edit automatically, Plan and Auto modes, saved on the session
- Searchable model picker and per-model effort levels; new sessions reuse your last choices
- Permission prompts and agent questions inline; edit prompts show diffs and can be accepted or rejected in VS Code's diff editor
- Fork or rewind the conversation (and optionally your files) from any of your messages
- Slash commands, current-file attachment, pasted images, and a context and cost gauge
- MCP servers, plugins and skills in one menu, with one-click Chrome DevTools for browser control
- Browser activity strip showing the page the agent's browser is on and what it did
- Claude Code-style timeline, syntax-highlighted code blocks with copy buttons
