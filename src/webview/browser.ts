// What the agent's browser is doing, read from browser MCP tool calls in a
// session. MCP tools usually run through OpenCode's code tool ("execute"),
// so the calls show up as `tools.<server>.<tool>(...)` in its code.

import type { UiMessage, UiToolPart } from "./messages.ts"

export type BrowserAction = { label: string; running: boolean }

export type BrowserActivity = {
  server: string
  url?: string
  title?: string
  console?: string
  running: boolean
  // Most recent last.
  actions: BrowserAction[]
}

const BROWSER_SERVER = /^(playwright|chrome[-_]?devtools|[\w-]*browser[\w-]*)$/i
// tools.playwright.browser_click( or tools["chrome-devtools"].click(
const CODE_CALL = /tools(?:\.([\w-]+)|\[\s*["'`]([\w-]+)["'`]\s*\])\.(\w+)\s*\(/g
// MCP tools called directly are named "<server>_<tool>".
const DIRECT_CALL = /^(playwright|chrome[-_]?devtools)[_.](\w+)$/i

const ACTION_LABELS: Array<[RegExp, string]> = [
  [/navigate|new_page|goto|open/i, "Opened a page"],
  [/network/i, "Read network requests"],
  [/console/i, "Read console logs"],
  [/screenshot/i, "Took a screenshot"],
  [/snapshot/i, "Read the page"],
  [/click/i, "Clicked"],
  [/fill|type|press|select/i, "Typed"],
  [/hover|drag/i, "Moved the mouse"],
  [/performance|trace/i, "Profiled performance"],
  [/evaluate|script|run_code/i, "Ran a script"],
  [/emulate|resize/i, "Changed the viewport"],
  [/close/i, "Closed a page"],
  [/tabs|pages|select_page/i, "Switched tabs"],
  [/wait/i, "Waited"],
]

const actionLabel = (tool: string) =>
  ACTION_LABELS.find(([pattern]) => pattern.test(tool))?.[1] ?? tool.replace(/_/g, " ")

const lastMatch = (text: string, pattern: RegExp): string | undefined => {
  let found: string | undefined
  for (const match of text.matchAll(pattern)) found = match[1]?.trim()
  return found
}

// Browser calls a tool part made: [server, tool] pairs.
const browserCalls = (part: UiToolPart): Array<[string, string]> => {
  const direct = DIRECT_CALL.exec(part.name)
  if (direct) return [[direct[1]!, direct[2]!]]
  const code = typeof part.input.code === "string" ? part.input.code : ""
  return [...code.matchAll(CODE_CALL)]
    .map((match) => [match[1] ?? match[2] ?? "", match[3]!] as [string, string])
    .filter(([server]) => BROWSER_SERVER.test(server))
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function browserActivity(messages: readonly UiMessage[]): BrowserActivity | undefined {
  let activity: BrowserActivity | undefined
  for (const message of messages) {
    if (message.kind !== "assistant") continue
    for (const part of message.parts) {
      if (part.kind !== "tool") continue
      const calls = browserCalls(part)
      if (!calls.length) continue
      const running = part.status === "streaming" || part.status === "running"
      const current: BrowserActivity = activity ?? { server: calls[0]![0], running: false, actions: [] }
      const code = typeof part.input.code === "string" ? part.input.code : ""
      const text = `${part.output}\n${part.error ?? ""}`
      // Playwright reports "- Page URL: …"; Chrome DevTools lists pages with "[selected]".
      const url =
        lastMatch(text, /Page URL:\s*(\S+)/g) ??
        lastMatch(text, /^\s*\d+:\s*(https?:\/\/\S+)\s*\[selected\]/gm) ??
        lastMatch(code, /url:\s*["'`](https?:\/\/[^"'`]+)["'`]/g) ??
        (typeof part.input.url === "string" ? part.input.url : undefined)
      const actions = calls.map(([, tool]): BrowserAction => {
        const label = actionLabel(tool)
        return { label: label === "Opened a page" && url ? `Opened ${hostOf(url)}` : label, running }
      })
      // A new page makes the old page's title stale.
      const nextUrl = url ?? current.url
      const nextTitle = lastMatch(text, /Page Title:\s*(.+)/g) ?? (url && url !== current.url ? undefined : current.title)
      const nextConsole = lastMatch(text, /Console:\s*(.+)/g) ?? current.console
      activity = {
        server: calls.at(-1)![0],
        running,
        actions: [...current.actions, ...actions].slice(-12),
        ...(nextUrl ? { url: nextUrl } : {}),
        ...(nextTitle ? { title: nextTitle } : {}),
        ...(nextConsole ? { console: nextConsole } : {}),
      }
    }
  }
  return activity
}

export function browserPageLabel(activity: BrowserActivity): string {
  if (activity.title) return activity.title
  if (activity.url) return hostOf(activity.url)
  return "No page yet"
}
