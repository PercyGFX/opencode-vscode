// Slash commands: OpenCode's commands (built-in and the user's custom ones,
// listed by the server) plus a few that the chat handles itself.

export type SlashCommand = { name: string; description?: string; builtin: boolean }

export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  { name: "new", description: "Start a new session", builtin: true },
  { name: "compact", description: "Summarize the conversation to free up context", builtin: true },
]

export function allCommands(server: ReadonlyArray<{ name: string; description?: string }>): SlashCommand[] {
  const builtinNames = new Set(BUILTIN_COMMANDS.map((command) => command.name))
  const fromServer = server
    .filter((command) => !builtinNames.has(command.name))
    .map((command): SlashCommand => ({ ...command, builtin: false }))
  return [...BUILTIN_COMMANDS, ...fromServer]
}

export function parseSlash(text: string): { name: string; args: string } | undefined {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return undefined
  return { name: match[1]!, args: (match[2] ?? "").trim() }
}

// Commands to suggest while the user is still typing the command name.
export function matchCommands(commands: readonly SlashCommand[], text: string): SlashCommand[] {
  if (!text.startsWith("/") || /\s/.test(text)) return []
  const prefix = text.slice(1).toLowerCase()
  return commands.filter((command) => command.name.toLowerCase().startsWith(prefix))
}
