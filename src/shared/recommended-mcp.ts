// MCP servers the extension can add in one click. They're generic tools, not
// tied to any plugin, and are saved to the user's global OpenCode config.

export type RecommendedMcp = {
  name: string
  title: string
  description: string
  command: string[]
}

export const RECOMMENDED_MCP: readonly RecommendedMcp[] = [
  {
    name: "chrome-devtools",
    title: "Chrome DevTools",
    description: "Let OpenCode drive Chrome: open pages, click and type, take screenshots, and read network, console and performance data",
    command: ["npx", "-y", "chrome-devtools-mcp@latest"],
  },
  {
    name: "playwright",
    title: "Playwright",
    description: "Scripted browser automation in a fresh browser: navigate, click, fill forms and take snapshots",
    command: ["npx", "-y", "@playwright/mcp@latest", "--isolated"],
  },
]
