// MCP servers the extension can add in one click. They're generic tools, not
// tied to any plugin, and are saved to the user's global OpenCode config.

export type RecommendedMcp = {
  name: string
  title: string
  description: string
  command: string[]
  // Shown when the server fails, e.g. a one-time browser setting it needs.
  setupHint?: string
}

export const RECOMMENDED_MCP: readonly RecommendedMcp[] = [
  {
    name: "chrome-devtools",
    title: "Chrome DevTools",
    description:
      "Let OpenCode use the Chrome you have open: read pages, click and type, take screenshots, and read network, console and performance data",
    // --autoConnect attaches to your running Chrome instead of launching a new one.
    command: ["npx", "-y", "chrome-devtools-mcp@latest", "--autoConnect"],
    setupHint: "Open chrome://inspect/#remote-debugging in Chrome (144 or newer) and turn on remote debugging, then reconnect.",
  },
  {
    name: "playwright",
    title: "Playwright",
    description: "Scripted browser automation in a fresh browser: navigate, click, fill forms and take snapshots",
    command: ["npx", "-y", "@playwright/mcp@latest", "--isolated"],
  },
]
