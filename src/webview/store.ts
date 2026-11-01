import type {
  McpServer,
  OpenCodeEvent,
  PermissionRequest,
  PluginInfo,
  SessionInfo,
  SessionMessageInfo,
  SkillInfo,
} from "@opencode/client"
import { readFileDiffs } from "../shared/diff.ts"
import type { ModeId } from "../shared/modes.ts"
import type { ActiveFile, Bootstrap, ConnectionState, LoadedSession, ModelChoice } from "../shared/protocol.ts"
import { toUiForm, type UiForm } from "./forms.ts"
import { usableChoice } from "./models.ts"
import { contextTokens } from "./usage.ts"
import {
  fileLabel,
  toolOutput,
  toUiMessages,
  type UiAssistantMessage,
  type UiMessage,
  type UiPart,
  type UiToolPart,
} from "./messages.ts"

export type DraftTab = { kind: "draft"; key: string; mode: ModeId; modeChosen: boolean; model?: ModelChoice }
export type SessionTab = { kind: "session"; key: string; sessionID: string }
export type Tab = DraftTab | SessionTab

export type SessionStatusKind = "idle" | "busy" | "retry"

export type SessionView = {
  info?: SessionInfo
  messages: UiMessage[]
  permissions: PermissionRequest[]
  forms: UiForm[]
  status: SessionStatusKind
  retryMessage?: string
  error?: string
  loaded: boolean
}

export type State = {
  connection: ConnectionState
  bootstrap?: Bootstrap
  history: SessionInfo[]
  running: Record<string, true>
  sessions: Record<string, SessionView>
  tabs: Tab[]
  activeKey: string
  activeFile: ActiveFile
  attachActiveFile: boolean
  draftCounter: number
  // The model and mode last picked; new sessions start with them.
  lastModel?: ModelChoice
  lastMode?: ModeId
  // MCP servers and plugins OpenCode runs for this workspace, once loaded.
  mcp?: McpServer[]
  plugins?: PluginInfo[]
  skills?: SkillInfo[]
  // Skills attached to the next message.
  pendingSkills: string[]
  // Text to put back in the composer (after a rewind or fork); id changes each time.
  prefill?: { id: number; text: string }
  notice?: string
}

export type Persisted = { tabs: string[]; active?: string; attachActiveFile: boolean }

export type Action =
  | { type: "connection"; state: ConnectionState }
  | { type: "bootstrap"; bootstrap: Bootstrap }
  | { type: "history"; sessions: SessionInfo[]; running: string[] }
  | { type: "activeFile"; file: ActiveFile }
  | { type: "toggleAttach" }
  | { type: "event"; event: OpenCodeEvent }
  | { type: "sessionLoaded"; loaded: LoadedSession }
  | { type: "sessionMessages"; sessionID: string; messages: SessionMessageInfo[] }
  | { type: "sessionInfo"; info: SessionInfo }
  | { type: "sessionError"; sessionID: string; error: string | undefined }
  | { type: "openSession"; sessionID: string }
  | { type: "newDraft" }
  | { type: "closeTab"; key: string }
  | { type: "activate"; key: string }
  | { type: "draftMode"; key: string; mode: ModeId }
  | { type: "draftModel"; key: string; model: ModelChoice }
  | { type: "rememberModel"; model: ModelChoice }
  | { type: "rememberMode"; mode: ModeId }
  | { type: "draftCreated"; key: string; info: SessionInfo }
  | { type: "permissionResolved"; sessionID: string; requestID: string }
  | { type: "formResolved"; sessionID: string; formID: string }
  | { type: "notice"; text: string | undefined }
  | { type: "mcp"; servers: McpServer[] }
  | { type: "plugins"; plugins: PluginInfo[] }
  | { type: "skills"; skills: SkillInfo[] }
  | { type: "attachSkill"; id: string }
  | { type: "detachSkill"; id: string }
  | { type: "clearSkills" }
  | { type: "prefill"; text: string }

const draftTab = (counter: number, mode: ModeId, model?: ModelChoice): DraftTab => ({
  kind: "draft",
  key: `draft-${counter}`,
  mode,
  modeChosen: false,
  ...(model ? { model } : {}),
})

const emptyView = (): SessionView => ({ messages: [], permissions: [], forms: [], status: "idle", loaded: false })

export function initialState(persisted: Persisted | undefined): State {
  const sessionTabs: Tab[] = (persisted?.tabs ?? []).map((sessionID) => ({ kind: "session", key: sessionID, sessionID }))
  const tabs = sessionTabs.length ? sessionTabs : [draftTab(1, "manual")]
  const active = persisted?.active
  return {
    connection: { status: "connecting" },
    history: [],
    running: {},
    sessions: {},
    tabs,
    activeKey: active && tabs.some((tab) => tab.key === active) ? active : tabs[0]!.key,
    activeFile: undefined,
    attachActiveFile: persisted?.attachActiveFile ?? true,
    draftCounter: 2,
    pendingSkills: [],
  }
}

export function persistable(state: State): Persisted {
  const tabs = state.tabs.flatMap((tab) => (tab.kind === "session" ? [tab.sessionID] : []))
  const active = state.tabs.find((tab) => tab.key === state.activeKey)
  return {
    tabs,
    ...(active?.kind === "session" ? { active: active.sessionID } : {}),
    attachActiveFile: state.attachActiveFile,
  }
}

export function activeTab(state: State): Tab | undefined {
  return state.tabs.find((tab) => tab.key === state.activeKey)
}

// Context size after the most recent step that reported tokens.
export function lastContextTokens(view: SessionView | undefined): number | undefined {
  if (!view) return undefined
  for (let index = view.messages.length - 1; index >= 0; index -= 1) {
    const message = view.messages[index]
    if (message?.kind === "assistant" && message.contextTokens !== undefined) return message.contextTokens
  }
  return undefined
}

const defaultMode = (state: State): ModeId => state.lastMode ?? state.bootstrap?.defaultMode ?? "manual"

// ---------------------------------------------------------------------------
// Helpers that update one session view

const updateView = (state: State, sessionID: string, update: (view: SessionView) => SessionView): State => {
  const view = state.sessions[sessionID]
  if (!view) return state
  const next = update(view)
  return next === view ? state : { ...state, sessions: { ...state.sessions, [sessionID]: next } }
}

const patchInfo = (state: State, sessionID: string, patch: (info: SessionInfo) => SessionInfo): State => {
  let next = updateView(state, sessionID, (view) => (view.info ? { ...view, info: patch(view.info) } : view))
  const index = next.history.findIndex((session) => session.id === sessionID)
  if (index !== -1) {
    const history = [...next.history]
    history[index] = patch(history[index]!)
    next = { ...next, history }
  }
  return next
}

const setRunning = (state: State, sessionID: string, running: boolean): State => {
  if (Boolean(state.running[sessionID]) === running) return state
  const next = { ...state.running }
  if (running) next[sessionID] = true
  else delete next[sessionID]
  return { ...state, running: next }
}

const setStatus = (state: State, sessionID: string, status: SessionStatusKind, retryMessage?: string): State => {
  const next = updateView(state, sessionID, (view) => {
    const { retryMessage: _previous, ...rest } = view
    return retryMessage ? { ...rest, status, retryMessage } : { ...rest, status }
  })
  return setRunning(next, sessionID, status !== "idle")
}

const isAssistant = (message: UiMessage): message is UiAssistantMessage => message.kind === "assistant"

// Finds (or creates) the assistant message a stream event belongs to.
const updateAssistant = (
  state: State,
  sessionID: string,
  messageID: string,
  update: (message: UiAssistantMessage) => UiAssistantMessage,
  agent = "",
): State =>
  updateView(state, sessionID, (view) => {
    const index = view.messages.findIndex((message) => message.id === messageID)
    const existing = index === -1 ? undefined : view.messages[index]
    if (existing && !isAssistant(existing)) return view
    const base: UiAssistantMessage = existing ?? {
      kind: "assistant",
      id: messageID,
      agent,
      created: Date.now(),
      parts: [],
      keys: {},
      done: false,
    }
    const updated = update(base)
    const messages = [...view.messages]
    if (index === -1) messages.push(updated)
    else messages[index] = updated
    return { ...view, messages }
  })

const addPart = (message: UiAssistantMessage, key: string, part: UiPart): UiAssistantMessage => {
  if (message.keys[key] !== undefined) return message
  return { ...message, parts: [...message.parts, part], keys: { ...message.keys, [key]: message.parts.length } }
}

const replacePart = (message: UiAssistantMessage, index: number, part: UiPart): UiAssistantMessage => {
  const parts = [...message.parts]
  parts[index] = part
  return { ...message, parts }
}

// Text deltas can arrive for a part we never saw start, when a tab is opened
// mid-stream. Continue the last part of the same kind in that case.
const streamText = (
  message: UiAssistantMessage,
  key: string,
  kind: "text" | "reasoning",
  update: (text: string) => string,
  done?: boolean,
): UiAssistantMessage => {
  let index = message.keys[key]
  let next = message
  if (index === undefined) {
    const last = message.parts.length - 1
    if (last >= 0 && message.parts[last]?.kind === kind) {
      index = last
      next = { ...message, keys: { ...message.keys, [key]: last } }
    } else {
      next = addPart(message, key, kind === "text" ? { kind, text: "" } : { kind, text: "", done: false })
      index = next.keys[key]!
    }
  }
  const part = next.parts[index]
  if (!part || part.kind !== kind) return next
  const text = update(part.text)
  return replacePart(next, index, part.kind === "reasoning" ? { ...part, text, done: done ?? part.done } : { ...part, text })
}

const updateTool = (
  message: UiAssistantMessage,
  toolID: string,
  update: (part: UiToolPart) => UiToolPart,
): UiAssistantMessage => {
  const key = `tool:${toolID}`
  const withPart = addPart(message, key, { kind: "tool", id: toolID, name: "tool", status: "running", input: {}, output: "" })
  const index = withPart.keys[key]!
  const part = withPart.parts[index]
  return part?.kind === "tool" ? replacePart(withPart, index, update(part)) : withPart
}

// Why a run stopped, when it wasn't the user pressing Stop.
const INTERRUPT_REASONS: Record<"user" | "shutdown" | "superseded" | "inactivity", string | undefined> = {
  user: undefined,
  superseded: "Stopped because a newer request took over",
  inactivity: "Stopped after a period of inactivity",
  shutdown: "Stopped because the OpenCode server shut down",
}

// When a run ends, the server drops anything it was still waiting on without
// sending a reply event, so clear those prompts here.
const finishExecution = (state: State, sessionID: string, error?: string): State =>
  updateView(setStatus(state, sessionID, "idle"), sessionID, (view) => ({
    ...view,
    permissions: [],
    forms: [],
    ...(error ? { error } : {}),
  }))

const removeSessionEverywhere = (state: State, sessionID: string): State => {
  const history = state.history.filter((session) => session.id !== sessionID)
  const hasTab = state.tabs.some((tab) => tab.kind === "session" && tab.sessionID === sessionID)
  const next = { ...state, history }
  return hasTab ? reducer(next, { type: "closeTab", key: sessionID }) : next
}

// ---------------------------------------------------------------------------
// Server events

export function applyEvent(state: State, event: OpenCodeEvent): State {
  switch (event.type) {
    case "session.inbox.enqueued": {
      const { sessionID, inboxID, item } = event.data
      if (item.type !== "user") return state
      return updateView(state, sessionID, (view) =>
        view.messages.some((message) => message.id === inboxID)
          ? view
          : {
              ...view,
              messages: [
                ...view.messages,
                {
                  kind: "user",
                  id: inboxID,
                  text: item.payload.text,
                  files: (item.payload.files ?? []).map(fileLabel),
                  pending: true,
                  created: event.created,
                },
              ],
            },
      )
    }
    case "session.inbox.delivered": {
      const { sessionID, inboxID } = event.data
      return updateView(state, sessionID, (view) => ({
        ...view,
        messages: view.messages.map((message) =>
          message.id === inboxID && message.kind === "user" ? { ...message, pending: false } : message,
        ),
      }))
    }
    case "session.inbox.cancelled": {
      const { sessionID, inboxID } = event.data
      return updateView(state, sessionID, (view) => ({
        ...view,
        messages: view.messages.filter((message) => !(message.id === inboxID && message.kind === "user" && message.pending)),
      }))
    }
    case "session.step.started": {
      const { sessionID, assistantMessageID, agent, started } = event.data
      const next = updateAssistant(
        state,
        sessionID,
        assistantMessageID,
        (message) => ({ ...message, agent, created: started }),
        agent,
      )
      return setStatus(next, sessionID, "busy")
    }
    case "session.text.started": {
      const { sessionID, assistantMessageID, ordinal } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        addPart(message, `text:${ordinal}`, { kind: "text", text: "" }),
      )
    }
    case "session.text.delta": {
      const { sessionID, assistantMessageID, ordinal, delta } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        streamText(message, `text:${ordinal}`, "text", (text) => text + delta),
      )
    }
    case "session.text.ended": {
      const { sessionID, assistantMessageID, ordinal, text } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        streamText(message, `text:${ordinal}`, "text", () => text),
      )
    }
    case "session.reasoning.started": {
      const { sessionID, assistantMessageID, ordinal } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        addPart(message, `reasoning:${ordinal}`, { kind: "reasoning", text: "", done: false, started: event.created }),
      )
    }
    case "session.reasoning.delta": {
      const { sessionID, assistantMessageID, ordinal, delta } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        streamText(message, `reasoning:${ordinal}`, "reasoning", (text) => text + delta),
      )
    }
    case "session.reasoning.ended": {
      const { sessionID, assistantMessageID, ordinal, text } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) => {
        const next = streamText(message, `reasoning:${ordinal}`, "reasoning", () => text, true)
        const index = next.keys[`reasoning:${ordinal}`]
        const part = index === undefined ? undefined : next.parts[index]
        return part?.kind === "reasoning" ? replacePart(next, index!, { ...part, finished: event.created }) : next
      })
    }
    case "session.tool.input.started": {
      const { sessionID, assistantMessageID, id, name } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        updateTool(message, id, (part) => ({ ...part, name, status: "streaming" })),
      )
    }
    case "session.tool.called": {
      const { sessionID, assistantMessageID, id, input } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        updateTool(message, id, (part) => ({ ...part, status: "running", input })),
      )
    }
    case "session.tool.success": {
      const { sessionID, assistantMessageID, id, content, metadata } = event.data
      const diffs = readFileDiffs(metadata)
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        updateTool(message, id, (part) => ({
          ...part,
          status: "completed",
          output: toolOutput(content),
          ...(diffs.length ? { diffs } : {}),
        })),
      )
    }
    case "session.tool.failed": {
      const { sessionID, assistantMessageID, id, error, content } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) =>
        updateTool(message, id, (part) => ({ ...part, status: "error", error: error.message, output: toolOutput(content) })),
      )
    }
    case "session.step.ended": {
      const { sessionID, assistantMessageID, tokens } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) => ({
        ...message,
        done: true,
        contextTokens: contextTokens(tokens),
      }))
    }
    case "session.usage.updated": {
      const { sessionID, cost, tokens } = event.data
      return patchInfo(state, sessionID, (info) => ({ ...info, cost, tokens }))
    }
    case "session.step.failed": {
      const { sessionID, assistantMessageID, error } = event.data
      return updateAssistant(state, sessionID, assistantMessageID, (message) => ({
        ...message,
        done: true,
        error: error.message,
      }))
    }
    case "session.execution.started":
      return setStatus(state, event.data.sessionID, "busy")
    case "session.execution.succeeded":
    case "session.idle":
      return finishExecution(state, event.data.sessionID)
    case "session.execution.interrupted":
      return finishExecution(state, event.data.sessionID, INTERRUPT_REASONS[event.data.reason])
    case "session.execution.failed":
      return finishExecution(state, event.data.sessionID, event.data.error.message)
    case "session.status": {
      const { sessionID, status } = event.data
      return setStatus(state, sessionID, status.type, status.type === "retry" ? status.message : undefined)
    }
    case "permission.asked": {
      const request = event.data
      return updateView(state, request.sessionID, (view) =>
        view.permissions.some((existing) => existing.id === request.id)
          ? view
          : { ...view, permissions: [...view.permissions, request] },
      )
    }
    case "permission.replied":
      return reducer(state, {
        type: "permissionResolved",
        sessionID: event.data.sessionID,
        requestID: event.data.requestID,
      })
    case "form.created": {
      const form = toUiForm(event.data.form)
      return updateView(state, form.sessionID, (view) =>
        view.forms.some((existing) => existing.id === form.id) ? view : { ...view, forms: [...view.forms, form] },
      )
    }
    case "form.replied":
    case "form.cancelled":
      return reducer(state, { type: "formResolved", sessionID: event.data.sessionID, formID: event.data.id })
    case "session.agent.selected":
      return patchInfo(state, event.data.sessionID, (info) => ({ ...info, agent: event.data.agent }))
    case "session.model.selected":
      return patchInfo(state, event.data.sessionID, (info) => ({ ...info, model: event.data.model }))
    case "session.permissions":
      return patchInfo(state, event.data.sessionID, (info) => ({ ...info, permissions: event.data.permissions }))
    case "session.metadata.updated":
      return patchInfo(state, event.data.sessionID, (info) => ({ ...info, metadata: event.data.metadata }))
    case "session.renamed":
      return patchInfo(state, event.data.sessionID, (info) => ({ ...info, title: event.data.title }))
    case "session.revert.staged":
      return patchInfo(state, event.data.sessionID, (info) => ({ ...info, revert: event.data.revert }))
    case "session.revert.cleared":
    case "session.revert.committed":
      return patchInfo(state, event.data.sessionID, ({ revert: _revert, ...info }) => info)
    case "session.deleted":
    case "session.archived":
      return removeSessionEverywhere(state, event.data.sessionID)
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Reducer

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.state }

    case "bootstrap": {
      const { models } = action.bootstrap
      const lastModel = usableChoice(models, state.lastModel ?? action.bootstrap.lastModel)
      const lastMode = state.lastMode ?? action.bootstrap.lastMode ?? undefined
      const mode = lastMode ?? action.bootstrap.defaultMode
      const tabs = state.tabs.map((tab) => {
        if (tab.kind !== "draft") return tab
        const withMode = tab.modeChosen ? tab : { ...tab, mode }
        return withMode.model || !lastModel ? withMode : { ...withMode, model: lastModel }
      })
      const { lastModel: _model, lastMode: _mode, ...rest } = state
      return {
        ...rest,
        bootstrap: action.bootstrap,
        tabs,
        ...(lastModel ? { lastModel } : {}),
        ...(lastMode ? { lastMode } : {}),
      }
    }

    case "history":
      return {
        ...state,
        history: action.sessions,
        running: Object.fromEntries(action.running.map((id) => [id, true as const])),
      }

    case "activeFile":
      return { ...state, activeFile: action.file }

    case "toggleAttach":
      return { ...state, attachActiveFile: !state.attachActiveFile }

    case "event":
      return applyEvent(state, action.event)

    case "sessionLoaded": {
      const { info, messages, permissions, forms, running } = action.loaded
      const view: SessionView = {
        info,
        messages: toUiMessages(messages),
        permissions,
        forms: forms.map(toUiForm),
        status: running ? "busy" : "idle",
        loaded: true,
      }
      const next = { ...state, sessions: { ...state.sessions, [info.id]: view } }
      return setRunning(patchInfo(next, info.id, () => info), info.id, running)
    }

    case "sessionMessages":
      return updateView(state, action.sessionID, (view) => {
        const messages = toUiMessages(action.messages)
        const known = new Set(messages.map((message) => message.id))
        // Keep prompts that are still waiting in the inbox.
        const queued = view.messages.filter((message) => message.kind === "user" && message.pending && !known.has(message.id))
        return { ...view, messages: [...messages, ...queued] }
      })

    case "sessionInfo":
      return patchInfo(state, action.info.id, () => action.info)

    case "sessionError": {
      const { sessionID, error } = action
      const view = state.sessions[sessionID] ?? emptyView()
      const { error: _previous, ...rest } = view
      return { ...state, sessions: { ...state.sessions, [sessionID]: error ? { ...rest, error } : rest } }
    }

    case "openSession": {
      const { sessionID } = action
      if (state.tabs.some((tab) => tab.key === sessionID)) return { ...state, activeKey: sessionID }
      const tab: SessionTab = { kind: "session", key: sessionID, sessionID }
      const current = activeTab(state)
      // Opening a past session replaces an empty new-session tab, like a fresh chat would.
      const tabs =
        current?.kind === "draft"
          ? state.tabs.map((existing) => (existing.key === current.key ? tab : existing))
          : [...state.tabs, tab]
      return { ...state, tabs, activeKey: sessionID }
    }

    case "newDraft": {
      const existing = state.tabs.find((tab) => tab.kind === "draft")
      if (existing) return { ...state, activeKey: existing.key }
      const tab = draftTab(state.draftCounter, defaultMode(state), state.lastModel)
      return { ...state, tabs: [...state.tabs, tab], activeKey: tab.key, draftCounter: state.draftCounter + 1 }
    }

    case "closeTab": {
      const index = state.tabs.findIndex((tab) => tab.key === action.key)
      if (index === -1) return state
      const closing = state.tabs[index]!
      let tabs = state.tabs.filter((tab) => tab.key !== action.key)
      let draftCounter = state.draftCounter
      if (!tabs.length) {
        tabs = [draftTab(draftCounter, defaultMode(state), state.lastModel)]
        draftCounter += 1
      }
      const activeKey =
        state.activeKey === action.key ? tabs[Math.min(index, tabs.length - 1)]!.key : state.activeKey
      const sessions = { ...state.sessions }
      if (closing.kind === "session") delete sessions[closing.sessionID]
      return { ...state, tabs, activeKey, sessions, draftCounter }
    }

    case "activate":
      return state.tabs.some((tab) => tab.key === action.key) ? { ...state, activeKey: action.key } : state

    case "draftMode":
      return {
        ...state,
        lastMode: action.mode,
        tabs: state.tabs.map((tab) =>
          tab.kind === "draft" && tab.key === action.key ? { ...tab, mode: action.mode, modeChosen: true } : tab,
        ),
      }

    case "draftModel":
      return {
        ...state,
        lastModel: action.model,
        tabs: state.tabs.map((tab) => (tab.kind === "draft" && tab.key === action.key ? { ...tab, model: action.model } : tab)),
      }

    case "rememberModel":
      return { ...state, lastModel: action.model }

    case "rememberMode":
      return { ...state, lastMode: action.mode }

    case "draftCreated": {
      const { key, info } = action
      const tab: SessionTab = { kind: "session", key: info.id, sessionID: info.id }
      const tabs = state.tabs.map((existing) => (existing.key === key ? tab : existing))
      const view: SessionView = { ...emptyView(), info, loaded: true }
      const history = state.history.some((session) => session.id === info.id) ? state.history : [info, ...state.history]
      return {
        ...state,
        tabs,
        history,
        activeKey: state.activeKey === key ? info.id : state.activeKey,
        sessions: { ...state.sessions, [info.id]: view },
      }
    }

    case "permissionResolved":
      return updateView(state, action.sessionID, (view) => {
        const permissions = view.permissions.filter((request) => request.id !== action.requestID)
        return permissions.length === view.permissions.length ? view : { ...view, permissions }
      })

    case "formResolved":
      return updateView(state, action.sessionID, (view) => {
        const forms = view.forms.filter((form) => form.id !== action.formID)
        return forms.length === view.forms.length ? view : { ...view, forms }
      })

    case "notice":
      return action.text ? { ...state, notice: action.text } : { ...state, notice: undefined }

    case "mcp":
      return { ...state, mcp: action.servers }

    case "plugins":
      return { ...state, plugins: action.plugins }

    case "skills": {
      // Drop attached skills that no longer exist.
      const known = new Set(action.skills.map((skill) => skill.id))
      return { ...state, skills: action.skills, pendingSkills: state.pendingSkills.filter((id) => known.has(id)) }
    }

    case "attachSkill":
      return state.pendingSkills.includes(action.id) ? state : { ...state, pendingSkills: [...state.pendingSkills, action.id] }

    case "detachSkill":
      return { ...state, pendingSkills: state.pendingSkills.filter((id) => id !== action.id) }

    case "clearSkills":
      return state.pendingSkills.length ? { ...state, pendingSkills: [] } : state

    case "prefill":
      return { ...state, prefill: { id: (state.prefill?.id ?? 0) + 1, text: action.text } }
  }
}
