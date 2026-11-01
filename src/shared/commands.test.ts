import { describe, expect, it } from "vitest"
import { allCommands, matchCommands, parseSlash } from "./commands.ts"

describe("parseSlash", () => {
  it("splits the command name from its arguments", () => {
    expect(parseSlash("/review src/app.ts carefully")).toEqual({ name: "review", args: "src/app.ts carefully" })
    expect(parseSlash("/compact")).toEqual({ name: "compact", args: "" })
  })

  it("ignores text that isn't a command", () => {
    expect(parseSlash("hello /there")).toBeUndefined()
    expect(parseSlash("/")).toBeUndefined()
    expect(parseSlash("/usr/bin is a path")).toBeUndefined()
  })
})

describe("allCommands", () => {
  it("puts the built-in commands first and drops server duplicates", () => {
    const commands = allCommands([{ name: "compact" }, { name: "review", description: "Review code" }])
    expect(commands.map((command) => command.name)).toEqual(["new", "compact", "review"])
    expect(commands.find((command) => command.name === "review")).toEqual({
      name: "review",
      description: "Review code",
      builtin: false,
    })
  })
})

describe("matchCommands", () => {
  const commands = allCommands([{ name: "review" }, { name: "release-notes" }])

  it("suggests commands while the name is being typed", () => {
    expect(matchCommands(commands, "/re").map((command) => command.name)).toEqual(["review", "release-notes"])
    expect(matchCommands(commands, "/").length).toBe(4)
  })

  it("stops suggesting once arguments start", () => {
    expect(matchCommands(commands, "/review ")).toEqual([])
    expect(matchCommands(commands, "review")).toEqual([])
  })
})
