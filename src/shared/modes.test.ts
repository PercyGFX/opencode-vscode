import { describe, expect, it } from "vitest"
import { META_KEY, modeMetaJson, modeRules, nextMode, readModeMeta, replaceRules } from "./modes.ts"

describe("modeRules", () => {
  it("asks before edits and commands in manual mode", () => {
    expect(modeRules("manual")).toEqual([
      { action: "edit", resource: "*", effect: "ask" },
      { action: "shell", resource: "*", effect: "ask" },
    ])
  })

  it("allows edits but asks before commands when editing automatically", () => {
    expect(modeRules("acceptEdits")).toEqual([
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "ask" },
    ])
  })

  it("leaves edits to the plan agent in plan mode", () => {
    expect(modeRules("plan")).toEqual([{ action: "shell", resource: "*", effect: "ask" }])
  })

  it("allows everything in auto mode, then asks for risky commands", () => {
    const rules = modeRules("auto", ["*git push*"])
    expect(rules).toEqual([
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "allow" },
      { action: "shell", resource: "*git push*", effect: "ask" },
    ])
  })
})

describe("replaceRules", () => {
  it("swaps the previous mode's rules and keeps rules added by others", () => {
    const foreign = { action: "browser", resource: "*", effect: "allow" as const }
    const previous = modeRules("manual")
    const current = [...previous, foreign]
    const next = modeRules("acceptEdits")
    expect(replaceRules(current, previous, next)).toEqual([foreign, ...next])
  })

  it("removes one copy per previous rule, starting from the end", () => {
    const ask = { action: "shell", resource: "*", effect: "ask" as const }
    expect(replaceRules([ask, ask], [ask], [])).toEqual([ask])
  })

  it("appends when nothing was applied before", () => {
    const next = modeRules("plan")
    expect(replaceRules([], [], next)).toEqual(next)
  })
})

describe("readModeMeta", () => {
  it("reads what modeMetaJson wrote", () => {
    const meta = { mode: "plan" as const, rules: modeRules("plan"), previousAgent: "build" }
    expect(readModeMeta({ [META_KEY]: modeMetaJson(meta) })).toEqual(meta)
  })

  it("ignores missing or invalid metadata", () => {
    expect(readModeMeta(undefined)).toBeUndefined()
    expect(readModeMeta({ [META_KEY]: { mode: "yolo" } })).toBeUndefined()
    expect(readModeMeta({ [META_KEY]: "manual" })).toBeUndefined()
  })

  it("drops malformed rules", () => {
    const meta = readModeMeta({ [META_KEY]: { mode: "auto", rules: [{ action: "edit" }, modeRules("manual")[0]] } })
    expect(meta?.rules).toEqual([modeRules("manual")[0]])
  })
})

describe("modeMetaJson", () => {
  it("leaves out an unset previous agent", () => {
    expect(modeMetaJson({ mode: "manual", rules: [] })).toEqual({ mode: "manual", rules: [] })
  })
})

describe("nextMode", () => {
  it("cycles through the modes in menu order", () => {
    expect(nextMode(undefined)).toBe("manual")
    expect(nextMode("manual")).toBe("acceptEdits")
    expect(nextMode("acceptEdits")).toBe("plan")
    expect(nextMode("plan")).toBe("auto")
    expect(nextMode("auto")).toBe("manual")
  })
})
