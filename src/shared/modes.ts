// Permission modes map onto OpenCode 2 session permission rules. OpenCode
// evaluates the agent's rules first, then the session's, and the last matching
// rule wins, so the rules below override the agent defaults for one session.
// The TUI enforces them too, because they live on the session.

export type ModeId = "manual" | "acceptEdits" | "plan" | "auto"

export type PermissionEffect = "allow" | "deny" | "ask"

export type PermissionRuleInput = {
  action: string
  resource: string
  effect: PermissionEffect
}

export type ModeDefinition = {
  id: ModeId
  label: string
  description: string
  icon: string
}

export const MODES: readonly ModeDefinition[] = [
  {
    id: "manual",
    label: "Manual",
    description: "OpenCode will ask for approval before each edit or command",
    icon: "shield",
  },
  {
    id: "acceptEdits",
    label: "Edit automatically",
    description: "OpenCode will edit files without asking, and ask before commands",
    icon: "code",
  },
  {
    id: "plan",
    label: "Plan",
    description: "OpenCode will explore the code and present a plan before editing",
    icon: "checklist",
  },
  {
    id: "auto",
    label: "Auto",
    description: "OpenCode will approve edits and commands, and pause for risky ones",
    icon: "zap",
  },
]

export const MODE_IDS: readonly ModeId[] = MODES.map((mode) => mode.id)

export const DEFAULT_AUTO_ASK_PATTERNS: readonly string[] = [
  "*git push*",
  "*git reset --hard*",
  "*git clean*",
  "*rm -rf*",
  "*rm -r *",
  "*sudo *",
  "*npm publish*",
  "*Remove-Item*",
  "*rmdir*",
]

export const PLAN_AGENT = "plan"
export const BUILD_AGENT = "build"

// Session metadata key for the mode this extension applied.
export const META_KEY = "vscode"

export type SessionModeMeta = {
  mode: ModeId
  rules: PermissionRuleInput[]
  previousAgent?: string
}

const rule = (action: string, resource: string, effect: PermissionEffect): PermissionRuleInput => ({
  action,
  resource,
  effect,
})

export function modeRules(
  mode: ModeId,
  autoAskPatterns: readonly string[] = DEFAULT_AUTO_ASK_PATTERNS,
): PermissionRuleInput[] {
  switch (mode) {
    case "manual":
      return [rule("edit", "*", "ask"), rule("shell", "*", "ask")]
    case "acceptEdits":
      return [rule("edit", "*", "allow"), rule("shell", "*", "ask")]
    case "plan":
      // The plan agent already denies edits outside its plan files.
      return [rule("shell", "*", "ask")]
    case "auto":
      return [
        rule("edit", "*", "allow"),
        rule("shell", "*", "allow"),
        ...autoAskPatterns.map((pattern) => rule("shell", pattern, "ask")),
      ]
  }
}

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && (MODE_IDS as readonly string[]).includes(value)
}

export function modeDefinition(mode: ModeId): ModeDefinition {
  return MODES.find((definition) => definition.id === mode) ?? MODES[0]!
}

export function nextMode(mode: ModeId | undefined): ModeId {
  if (mode === undefined) return MODE_IDS[0]!
  const index = MODE_IDS.indexOf(mode)
  return MODE_IDS[(index + 1) % MODE_IDS.length]!
}

const sameRule = (a: PermissionRuleInput, b: PermissionRuleInput) =>
  a.action === b.action && a.resource === b.resource && a.effect === b.effect

// Swaps the rules a previous mode added for the new mode's rules, and keeps
// rules that something else added to the session (another client, a plugin,
// or OpenCode itself).
export function replaceRules(
  current: readonly PermissionRuleInput[],
  previous: readonly PermissionRuleInput[],
  next: readonly PermissionRuleInput[],
): PermissionRuleInput[] {
  const remaining = current.map((entry) => rule(entry.action, entry.resource, entry.effect))
  for (const old of previous) {
    const index = remaining.findLastIndex((entry) => sameRule(entry, old))
    if (index !== -1) remaining.splice(index, 1)
  }
  return [...remaining, ...next]
}

const isRule = (value: unknown): value is PermissionRuleInput => {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.action === "string" &&
    typeof candidate.resource === "string" &&
    (candidate.effect === "allow" || candidate.effect === "deny" || candidate.effect === "ask")
  )
}

export function readModeMeta(metadata: Readonly<Record<string, unknown>> | undefined): SessionModeMeta | undefined {
  const raw = metadata?.[META_KEY]
  if (typeof raw !== "object" || raw === null) return undefined
  const candidate = raw as Record<string, unknown>
  if (!isModeId(candidate.mode)) return undefined
  const rules = Array.isArray(candidate.rules) ? candidate.rules.filter(isRule) : []
  const previousAgent = typeof candidate.previousAgent === "string" ? candidate.previousAgent : undefined
  return previousAgent === undefined
    ? { mode: candidate.mode, rules }
    : { mode: candidate.mode, rules, previousAgent }
}

export type JsonObject = { [key: string]: JsonLike }
export type JsonLike = string | number | boolean | null | JsonLike[] | JsonObject

export function modeMetaJson(meta: SessionModeMeta): JsonObject {
  const json: JsonObject = {
    mode: meta.mode,
    rules: meta.rules.map((entry) => ({ action: entry.action, resource: entry.resource, effect: entry.effect })),
  }
  if (meta.previousAgent !== undefined) json.previousAgent = meta.previousAgent
  return json
}
