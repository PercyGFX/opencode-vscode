import type { OpenCodeEvent } from "@opencode/client"
import { allCommands, parseSlash } from "../shared/commands.ts"
import type { FileDiff } from "../shared/diff.ts"
import type { ModeId } from "../shared/modes.ts"
import type { FormAnswerValue, ModelChoice, PastedImage } from "../shared/protocol.ts"
import { activeTab, type Action, type State } from "./store.ts"
import { request } from "./vscode.ts"

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const BOOTSTRAP_EVENTS = new Set([
  "agent.updated",
  "command.updated",
  "model.updated",
  "provider.updated",
  "config.updated",
  "integration.updated",
  "credential.switched",
])

// Side effects for the chat: requests to the extension host, and reloads that
// keep tabs authoritative after streaming finishes.
export function createController(getState: () => State, dispatch: (action: Action) => void) {
  const loading = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const debounce = (key: string, delay: number, run: () => void) => {
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        run()
      }, delay),
    )
  }

  const notice = (error: unknown) => dispatch({ type: "notice", text: errorText(error) })

  const bootstrap = async () => {
    try {
      dispatch({ type: "bootstrap", bootstrap: await request("bootstrap", {}) })
    } catch (error) {
      notice(error)
    }
  }

  const refreshHistory = async (search?: string) => {
    try {
      const list = await request("listSessions", search ? { search } : {})
      dispatch({ type: "history", sessions: list.sessions, running: list.running })
    } catch (error) {
      notice(error)
    }
  }

  const loadSession = async (sessionID: string) => {
    if (loading.has(sessionID)) return
    loading.add(sessionID)
    try {
      dispatch({ type: "sessionLoaded", loaded: await request("loadSession", { sessionID }) })
    } catch (error) {
      dispatch({ type: "sessionError", sessionID, error: errorText(error) })
    } finally {
      loading.delete(sessionID)
    }
  }

  const reloadMessages = async (sessionID: string) => {
    if (!getState().sessions[sessionID]) return
    try {
      dispatch({ type: "sessionMessages", sessionID, messages: await request("loadMessages", { sessionID }) })
    } catch (error) {
      notice(error)
    }
  }

  const openSessionIDs = () =>
    getState().tabs.flatMap((tab) => (tab.kind === "session" ? [tab.sessionID] : []))

  const loadMcp = async () => {
    try {
      dispatch({ type: "mcp", servers: await request("listMcp", {}) })
    } catch (error) {
      notice(error)
    }
  }

  const setMcpConnected = async (server: string, connected: boolean) => {
    try {
      await request(connected ? "connectMcp" : "disconnectMcp", { server })
    } catch (error) {
      notice(error)
    }
    await loadMcp()
  }

  const loadPlugins = async (check = false) => {
    try {
      dispatch({ type: "plugins", plugins: await request("listPlugins", check ? { check: true } : {}) })
    } catch (error) {
      notice(error)
    }
  }

  const updatePlugins = async (targets: string[]) => {
    try {
      await request("updatePlugins", { targets })
    } catch (error) {
      notice(error)
    }
    await loadPlugins()
  }

  const loadSkills = async () => {
    try {
      dispatch({ type: "skills", skills: await request("listSkills", {}) })
    } catch (error) {
      notice(error)
    }
  }

  const refreshAll = () =>
    debounce("refreshAll", 200, () => {
      void bootstrap()
      void refreshHistory()
      void loadMcp()
      void loadPlugins()
      void loadSkills()
      for (const sessionID of openSessionIDs()) void loadSession(sessionID)
    })

  const onEvent = (event: OpenCodeEvent) => {
    if (event.type === "server.connected") {
      refreshAll()
      return
    }
    if (BOOTSTRAP_EVENTS.has(event.type)) {
      debounce("bootstrap", 300, () => void bootstrap())
      return
    }
    if (event.type === "mcp.status.changed") {
      debounce("mcp", 300, () => void loadMcp())
      return
    }
    if (event.type === "plugin.updated") {
      debounce("plugins", 300, () => void loadPlugins())
      return
    }
    if (event.type === "skill.updated") {
      debounce("skills", 300, () => void loadSkills())
      return
    }
    switch (event.type) {
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        void reloadMessages(event.data.sessionID)
        debounce("history", 500, () => void refreshHistory())
        return
      case "session.created":
        debounce("history", 300, () => void refreshHistory())
        return
      case "session.revert.committed":
        void reloadMessages(event.data.sessionID)
        return
    }
  }

  // The active tab's session, created first when the tab is still a draft.
  const ensureSession = async (): Promise<string | undefined> => {
    const tab = activeTab(getState())
    if (!tab) return undefined
    if (tab.kind === "session") return tab.sessionID
    const info = await request("createSession", { mode: tab.mode, ...(tab.model ? { model: tab.model } : {}) })
    dispatch({ type: "draftCreated", key: tab.key, info })
    return info.id
  }

  const send = async (text: string, images: PastedImage[] = []): Promise<boolean> => {
    const state = getState()
    const attachActiveFile = state.attachActiveFile && state.activeFile !== undefined
    const slash = parseSlash(text)
    const command = slash ? allCommands(state.bootstrap?.commands ?? []).find((entry) => entry.name === slash.name) : undefined
    try {
      if (command?.name === "new" && command.builtin) {
        dispatch({ type: "newDraft" })
        return true
      }
      if (command?.name === "compact" && command.builtin) {
        const tab = activeTab(state)
        if (tab?.kind !== "session") {
          dispatch({ type: "notice", text: "There's nothing to compact in a new session" })
          return false
        }
        await request("compact", { sessionID: tab.sessionID })
        return true
      }
      const sessionID = await ensureSession()
      if (!sessionID) return false
      const extras = {
        ...(state.pendingSkills.length ? { skills: state.pendingSkills } : {}),
        ...(images.length ? { images } : {}),
      }
      if (slash && command) {
        await request("command", { sessionID, name: command.name, text: slash.args, attachActiveFile, ...extras })
      } else {
        await request("prompt", { sessionID, text, attachActiveFile, ...extras })
      }
      dispatch({ type: "clearSkills" })
      dispatch({ type: "sessionError", sessionID, error: undefined })
      return true
    } catch (error) {
      notice(error)
      return false
    }
  }

  const stop = async () => {
    const tab = activeTab(getState())
    if (tab?.kind !== "session") return
    try {
      await request("interrupt", { sessionID: tab.sessionID })
    } catch (error) {
      notice(error)
    }
  }

  // Saved in the extension so every chat view and future session starts with it.
  const remember = (choice: { model?: ModelChoice; mode?: ModeId }) => {
    request("remember", choice).catch(notice)
  }

  const setMode = async (mode: ModeId) => {
    const tab = activeTab(getState())
    if (!tab) return
    remember({ mode })
    if (tab.kind === "draft") {
      dispatch({ type: "draftMode", key: tab.key, mode })
      return
    }
    dispatch({ type: "rememberMode", mode })
    try {
      dispatch({ type: "sessionInfo", info: await request("setMode", { sessionID: tab.sessionID, mode }) })
    } catch (error) {
      notice(error)
    }
  }

  const setModel = async (model: ModelChoice) => {
    const tab = activeTab(getState())
    if (!tab) return
    remember({ model })
    if (tab.kind === "draft") {
      dispatch({ type: "draftModel", key: tab.key, model })
      return
    }
    dispatch({ type: "rememberModel", model })
    try {
      dispatch({ type: "sessionInfo", info: await request("setModel", { sessionID: tab.sessionID, model }) })
    } catch (error) {
      notice(error)
    }
  }

  const replyPermission = async (sessionID: string, requestID: string, decision: "once" | "always" | "reject") => {
    try {
      await request("replyPermission", { sessionID, requestID, decision })
      dispatch({ type: "permissionResolved", sessionID, requestID })
    } catch (error) {
      // Already answered somewhere else (the TUI, another window) or expired.
      if (errorText(error).includes("not found")) dispatch({ type: "permissionResolved", sessionID, requestID })
      else notice(error)
    }
  }

  const replyForm = async (sessionID: string, formID: string, answer: Record<string, FormAnswerValue>) => {
    try {
      await request("replyForm", { sessionID, formID, answer })
      dispatch({ type: "formResolved", sessionID, formID })
    } catch (error) {
      if (/not found|already settled/i.test(errorText(error))) dispatch({ type: "formResolved", sessionID, formID })
      else notice(error)
    }
  }

  const cancelForm = async (sessionID: string, formID: string) => {
    try {
      await request("cancelForm", { sessionID, formID })
      dispatch({ type: "formResolved", sessionID, formID })
    } catch (error) {
      notice(error)
    }
  }

  const openFile = async (path: string) => {
    try {
      await request("openFile", { path })
    } catch (error) {
      notice(error)
    }
  }

  // Fork the conversation up to a message into a new tab, with that message ready to edit.
  const fork = async (sessionID: string, messageID: string, text: string) => {
    try {
      const info = await request("forkSession", { sessionID, before: messageID })
      dispatch({ type: "openSession", sessionID: info.id })
      dispatch({ type: "prefill", text })
    } catch (error) {
      notice(error)
    }
  }

  const rewind = async (sessionID: string, messageID: string, text: string, files: boolean) => {
    try {
      dispatch({ type: "sessionInfo", info: await request("rewind", { sessionID, messageID, files }) })
      dispatch({ type: "prefill", text })
    } catch (error) {
      notice(error)
    }
  }

  const undoRewind = async (sessionID: string) => {
    try {
      dispatch({ type: "sessionInfo", info: await request("undoRewind", { sessionID }) })
    } catch (error) {
      notice(error)
    }
  }

  const keepRewind = async (sessionID: string) => {
    try {
      await request("keepRewind", { sessionID })
      await reloadMessages(sessionID)
    } catch (error) {
      notice(error)
    }
  }

  const openDiff = async (sessionID: string, diff: FileDiff, requestID?: string) => {
    try {
      await request("openDiff", {
        file: diff.file,
        patch: diff.patch,
        status: diff.status,
        sessionID,
        ...(requestID ? { requestID } : {}),
      })
    } catch (error) {
      notice(error)
    }
  }

  const reconnect = async () => {
    try {
      await request("reconnect", {})
    } catch (error) {
      notice(error)
    }
  }

  return {
    onEvent,
    refreshAll,
    refreshHistory,
    loadSession,
    send,
    stop,
    setMode,
    setModel,
    replyPermission,
    replyForm,
    cancelForm,
    openFile,
    openDiff,
    fork,
    rewind,
    undoRewind,
    keepRewind,
    reconnect,
    loadMcp,
    setMcpConnected,
    loadPlugins,
    updatePlugins,
    loadSkills,
  }
}

export type Controller = ReturnType<typeof createController>
