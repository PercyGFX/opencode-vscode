import { describe, expect, it, vi } from "vitest"
import type { SessionInfo, SessionUpdateInput } from "@opencode/client"
import { META_KEY, modeRules, readModeMeta } from "../shared/modes.ts"
import { setSessionMode, type ModeClient } from "./handlers.ts"

const baseSession = (patch: Partial<SessionInfo> = {}): SessionInfo => ({
  id: "ses_1",
  projectID: "prj_1",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "C:\\repo" },
  ...patch,
})

// A fake session API that applies updates the way the server would.
const fakeSessions = (initial: SessionInfo) => {
  let session = initial
  const client: ModeClient = {
    get: vi.fn(async () => session),
    update: vi.fn(async (input: SessionUpdateInput) => {
      session = {
        ...session,
        ...(input.permissions ? { permissions: [...input.permissions] } : {}),
        ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
      }
    }),
    switchAgent: vi.fn(async ({ agent }: { agent: string }) => {
      session = { ...session, agent }
    }),
  }
  return { client, current: () => session }
}

describe("setSessionMode", () => {
  it("switches to the plan agent and remembers the previous one", async () => {
    const { client, current } = fakeSessions(baseSession({ agent: "build" }))
    await setSessionMode(client, "ses_1", "plan", [])
    expect(client.switchAgent).toHaveBeenCalledWith({ sessionID: "ses_1", agent: "plan" })
    expect(current().agent).toBe("plan")
    expect(readModeMeta(current().metadata)).toEqual({ mode: "plan", rules: modeRules("plan"), previousAgent: "build" })
  })

  it("restores the previous agent when leaving plan mode", async () => {
    const { client, current } = fakeSessions(baseSession({ agent: "build" }))
    await setSessionMode(client, "ses_1", "plan", [])
    await setSessionMode(client, "ses_1", "acceptEdits", [])
    expect(current().agent).toBe("build")
    expect(current().permissions).toEqual(modeRules("acceptEdits"))
    expect(readModeMeta(current().metadata)?.previousAgent).toBeUndefined()
  })

  it("keeps rules and metadata that other clients added", async () => {
    const foreign = { action: "browser", resource: "*", effect: "allow" as const }
    const { client, current } = fakeSessions(
      baseSession({ permissions: [foreign], metadata: { other: "value" } }),
    )
    await setSessionMode(client, "ses_1", "manual", [])
    await setSessionMode(client, "ses_1", "auto", ["*rm -rf*"])
    expect(current().permissions).toEqual([foreign, ...modeRules("auto", ["*rm -rf*"])])
    expect(current().metadata?.other).toBe("value")
    expect(current().metadata?.[META_KEY]).toBeDefined()
    expect(client.switchAgent).not.toHaveBeenCalled()
  })
})
