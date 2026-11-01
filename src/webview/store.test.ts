import { describe, expect, it } from "vitest"
import type { ModelInfo, OpenCodeEvent, SessionInfo, SessionMessageInfo, SkillInfo } from "@opencode/client"
import type { ModeId } from "../shared/modes.ts"
import type { ModelChoice } from "../shared/protocol.ts"
import { initialState, lastContextTokens, persistable, reducer, type State } from "./store.ts"

type EventOf<T extends OpenCodeEvent["type"]> = Extract<OpenCodeEvent, { type: T }>

// Only type and data matter to the reducer; the envelope fields are filler.
const event = <T extends OpenCodeEvent["type"]>(type: T, data: EventOf<T>["data"]): OpenCodeEvent =>
  ({ id: "evt_test", created: 1, type, data }) as unknown as OpenCodeEvent

const session = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  projectID: "prj_1",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "C:\\repo" },
  ...patch,
})

// State with one open, loaded session tab.
const withSession = (id = "ses_1", messages: SessionMessageInfo[] = []): State => {
  const opened = reducer(initialState(undefined), { type: "openSession", sessionID: id })
  return reducer(opened, {
    type: "sessionLoaded",
    loaded: { info: session(id), messages, permissions: [], forms: [], running: false },
  })
}

const apply = (state: State, ...events: OpenCodeEvent[]) =>
  events.reduce((current, next) => reducer(current, { type: "event", event: next }), state)

const step = { sessionID: "ses_1", assistantMessageID: "msg_a" }

describe("streaming", () => {
  it("builds assistant text from deltas", () => {
    const state = apply(
      withSession(),
      event("session.step.started", { ...step, agent: "build", model: { id: "m", providerID: "p" }, started: 1 }),
      event("session.text.started", { ...step, ordinal: 0 }),
      event("session.text.delta", { ...step, ordinal: 0, delta: "Hel" }),
      event("session.text.delta", { ...step, ordinal: 0, delta: "lo" }),
    )
    const view = state.sessions.ses_1!
    expect(view.status).toBe("busy")
    expect(state.running.ses_1).toBe(true)
    expect(view.messages).toMatchObject([{ kind: "assistant", agent: "build", parts: [{ kind: "text", text: "Hello" }] }])
  })

  it("continues the last text part when a delta arrives without a start", () => {
    const loaded = withSession("ses_1", [
      {
        id: "msg_a",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: 1 },
        content: [{ type: "text", text: "Partial" }],
      },
    ])
    const state = apply(loaded, event("session.text.delta", { ...step, ordinal: 0, delta: " answer" }))
    expect(state.sessions.ses_1!.messages).toMatchObject([{ parts: [{ kind: "text", text: "Partial answer" }] }])
  })

  it("tracks a tool call from input to result", () => {
    const state = apply(
      withSession(),
      event("session.tool.input.started", { ...step, id: "call_1", name: "read" }),
      event("session.tool.called", { ...step, id: "call_1", input: { filePath: "a.ts" }, executed: true }),
      event("session.tool.success", { ...step, id: "call_1", content: [{ type: "text", text: "file body" }], executed: true }),
    )
    expect(state.sessions.ses_1!.messages).toMatchObject([
      { parts: [{ kind: "tool", name: "read", status: "completed", input: { filePath: "a.ts" }, output: "file body" }] },
    ])
  })

  it("keeps the diff an edit made", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new\n"
    const state = apply(
      withSession(),
      event("session.tool.input.started", { ...step, id: "call_2", name: "edit" }),
      event("session.tool.success", {
        ...step,
        id: "call_2",
        content: [{ type: "text", text: "Edited" }],
        metadata: { files: [{ file: "a.ts", patch, additions: 1, deletions: 1, status: "modified" }] },
        executed: true,
      }),
    )
    expect(state.sessions.ses_1!.messages).toMatchObject([
      { parts: [{ kind: "tool", status: "completed", diffs: [{ file: "a.ts", additions: 1, deletions: 1 }] }] },
    ])
  })

  it("tracks session totals and the latest context size", () => {
    const usage = { input: 900, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }
    const state = apply(
      withSession(),
      event("session.step.started", { ...step, agent: "build", model: { id: "m", providerID: "p" }, started: 1 }),
      event("session.step.ended", { ...step, finish: "stop", cost: 0.01, tokens: usage }),
      event("session.usage.updated", { sessionID: "ses_1", cost: 0.05, tokens: usage }),
    )
    expect(lastContextTokens(state.sessions.ses_1)).toBe(1000)
    expect(state.sessions.ses_1!.info?.cost).toBe(0.05)
  })

  it("returns to idle when execution finishes", () => {
    const state = apply(
      withSession(),
      event("session.execution.started", { sessionID: "ses_1" }),
      event("session.execution.succeeded", { sessionID: "ses_1" }),
    )
    expect(state.sessions.ses_1!.status).toBe("idle")
    expect(state.running.ses_1).toBeUndefined()
  })

  it("ignores events for sessions that aren't open", () => {
    const state = withSession()
    expect(apply(state, event("session.text.delta", { ...step, sessionID: "ses_other", ordinal: 0, delta: "x" }))).toBe(state)
  })
})

describe("prompts", () => {
  const enqueued = event("session.inbox.enqueued", {
    sessionID: "ses_1",
    inboxID: "msg_u",
    item: { type: "user", payload: { text: "Fix the bug" }, delivery: "steer" },
  })

  it("shows a queued prompt until it is delivered", () => {
    const queued = apply(withSession(), enqueued)
    expect(queued.sessions.ses_1!.messages).toMatchObject([{ kind: "user", text: "Fix the bug", pending: true }])
    const delivered = apply(queued, event("session.inbox.delivered", { sessionID: "ses_1", inboxID: "msg_u" }))
    expect(delivered.sessions.ses_1!.messages).toMatchObject([{ kind: "user", pending: false }])
  })

  it("keeps queued prompts when messages reload", () => {
    const queued = apply(withSession(), enqueued)
    const reloaded = reducer(queued, { type: "sessionMessages", sessionID: "ses_1", messages: [] })
    expect(reloaded.sessions.ses_1!.messages).toMatchObject([{ id: "msg_u", pending: true }])
  })
})

describe("permissions", () => {
  const asked = event("permission.asked", { id: "per_1", sessionID: "ses_1", action: "shell", resources: ["npm test"] })

  it("clears prompts the server dropped when the run stopped", () => {
    const stopped = apply(
      withSession(),
      event("session.execution.started", { sessionID: "ses_1" }),
      asked,
      event("session.execution.interrupted", { sessionID: "ses_1", reason: "user" }),
    )
    expect(stopped.sessions.ses_1!.permissions).toHaveLength(0)
    expect(stopped.sessions.ses_1!.error).toBeUndefined()
  })

  it("explains interruptions the user didn't cause", () => {
    const stopped = apply(withSession(), asked, event("session.execution.interrupted", { sessionID: "ses_1", reason: "inactivity" }))
    expect(stopped.sessions.ses_1!.error).toBe("Stopped after a period of inactivity")
  })

  it("adds a request when asked and removes it when answered", () => {
    const asked = apply(
      withSession(),
      event("permission.asked", { id: "per_1", sessionID: "ses_1", action: "shell", resources: ["npm test"] }),
    )
    expect(asked.sessions.ses_1!.permissions).toHaveLength(1)
    const replied = apply(asked, event("permission.replied", { sessionID: "ses_1", requestID: "per_1", reply: "once" }))
    expect(replied.sessions.ses_1!.permissions).toHaveLength(0)
  })
})

describe("remembered model and mode", () => {
  const model = (id: string, variants: string[]) =>
    ({ id, modelID: id, providerID: "p", name: id, variants: variants.map((variant) => ({ id: variant })) }) as unknown as ModelInfo
  const bootstrap = (lastModel: ModelChoice | null, lastMode: ModeId | null) => ({
    directory: "C:\\repo",
    agents: [],
    models: [model("fast", []), model("smart", ["low", "high"])],
    defaultModel: null,
    defaultMode: "manual" as const,
    commands: [],
    lastModel,
    lastMode,
  })

  it("starts new tabs with the last model, effort and mode", () => {
    let state = reducer(initialState(undefined), {
      type: "bootstrap",
      bootstrap: bootstrap({ providerID: "p", id: "smart", variant: "high" }, "auto"),
    })
    expect(state.tabs[0]).toMatchObject({ mode: "auto", model: { id: "smart", variant: "high" } })
    state = reducer(withSession(), { type: "rememberMode", mode: "plan" })
    state = reducer(state, { type: "rememberModel", model: { providerID: "p", id: "fast" } })
    state = reducer(state, { type: "newDraft" })
    expect(state.tabs.at(-1)).toMatchObject({ kind: "draft", mode: "plan", model: { id: "fast" } })
  })

  it("remembers picks made in a new tab", () => {
    const initial = initialState(undefined)
    const key = initial.tabs[0]!.key
    let state = reducer(initial, { type: "draftMode", key, mode: "acceptEdits" })
    state = reducer(state, { type: "draftModel", key, model: { providerID: "p", id: "smart" } })
    expect(state.lastMode).toBe("acceptEdits")
    expect(state.lastModel).toEqual({ providerID: "p", id: "smart" })
  })

  it("drops a remembered model the server no longer offers, and unknown effort levels", () => {
    const gone = reducer(initialState(undefined), {
      type: "bootstrap",
      bootstrap: bootstrap({ providerID: "p", id: "removed" }, null),
    })
    expect(gone.lastModel).toBeUndefined()
    const staleEffort = reducer(initialState(undefined), {
      type: "bootstrap",
      bootstrap: bootstrap({ providerID: "p", id: "fast", variant: "max" }, null),
    })
    expect(staleEffort.lastModel).toEqual({ providerID: "p", id: "fast" })
  })
})

describe("rewind", () => {
  it("tracks a staged rewind until it is cleared", () => {
    const staged = apply(
      withSession(),
      event("session.revert.staged", { sessionID: "ses_1", revert: { messageID: "msg_u" } }),
    )
    expect(staged.sessions.ses_1!.info?.revert?.messageID).toBe("msg_u")
    const cleared = apply(staged, event("session.revert.cleared", { sessionID: "ses_1" }))
    expect(cleared.sessions.ses_1!.info?.revert).toBeUndefined()
  })

  it("loads text back into the composer each time", () => {
    const first = reducer(initialState(undefined), { type: "prefill", text: "fix it" })
    const second = reducer(first, { type: "prefill", text: "fix it" })
    expect(second.prefill).toEqual({ id: 2, text: "fix it" })
  })
})

describe("system reminders", () => {
  it("collapses reminders OpenCode adds for the model", () => {
    const loaded = withSession("ses_1", [
      {
        id: "msg_s",
        type: "synthetic",
        time: { created: 1 },
        text: "<system-reminder>\nYou are no longer in Plan mode.\n</system-reminder>",
      },
    ])
    expect(loaded.sessions.ses_1!.messages).toEqual([
      { kind: "note", id: "msg_s", text: "System reminder", detail: "You are no longer in Plan mode.", tone: "info" },
    ])
  })
})

describe("skills", () => {
  it("attaches skills once and clears them after sending", () => {
    let state = reducer(initialState(undefined), { type: "attachSkill", id: "review" })
    state = reducer(state, { type: "attachSkill", id: "review" })
    state = reducer(state, { type: "attachSkill", id: "tests" })
    expect(state.pendingSkills).toEqual(["review", "tests"])
    state = reducer(state, { type: "detachSkill", id: "review" })
    expect(state.pendingSkills).toEqual(["tests"])
    expect(reducer(state, { type: "clearSkills" }).pendingSkills).toEqual([])
  })

  it("drops attached skills that disappear", () => {
    const skill = { id: "tests", name: "tests", path: "C:\\skills\\tests.md", content: "" } as SkillInfo
    let state = reducer(initialState(undefined), { type: "attachSkill", id: "gone" })
    state = reducer(state, { type: "attachSkill", id: "tests" })
    state = reducer(state, { type: "skills", skills: [skill] })
    expect(state.pendingSkills).toEqual(["tests"])
  })
})

describe("tabs", () => {
  it("opens a past session in place of the empty new-session tab", () => {
    const state = reducer(initialState(undefined), { type: "openSession", sessionID: "ses_1" })
    expect(state.tabs).toEqual([{ kind: "session", key: "ses_1", sessionID: "ses_1" }])
    expect(state.activeKey).toBe("ses_1")
  })

  it("turns a draft into a session tab once it is created", () => {
    const initial = initialState(undefined)
    const draftKey = initial.tabs[0]!.key
    const state = reducer(initial, { type: "draftCreated", key: draftKey, info: session("ses_new") })
    expect(state.tabs).toEqual([{ kind: "session", key: "ses_new", sessionID: "ses_new" }])
    expect(state.activeKey).toBe("ses_new")
    expect(state.history.map((entry) => entry.id)).toEqual(["ses_new"])
  })

  it("opens a new draft after the last tab closes", () => {
    const state = reducer(withSession(), { type: "closeTab", key: "ses_1" })
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.kind).toBe("draft")
    expect(state.sessions.ses_1).toBeUndefined()
  })

  it("closes the tab when its session is deleted", () => {
    const state = apply(withSession(), event("session.deleted", { sessionID: "ses_1" }))
    expect(state.tabs.every((tab) => tab.kind === "draft")).toBe(true)
  })

  it("persists only session tabs", () => {
    const state = reducer(withSession(), { type: "newDraft" })
    expect(persistable(state)).toEqual({ tabs: ["ses_1"], attachActiveFile: true })
  })

  it("restores persisted tabs", () => {
    const state = initialState({ tabs: ["ses_1", "ses_2"], active: "ses_2", attachActiveFile: false })
    expect(state.tabs.map((tab) => tab.key)).toEqual(["ses_1", "ses_2"])
    expect(state.activeKey).toBe("ses_2")
    expect(state.attachActiveFile).toBe(false)
  })
})
