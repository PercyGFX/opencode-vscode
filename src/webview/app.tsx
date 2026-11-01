import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks"
import { allCommands } from "../shared/commands.ts"
import { readModeMeta, type ModeId } from "../shared/modes.ts"
import { browserActivity } from "./browser.ts"
import { BrowserStrip } from "./components/browser-strip.tsx"
import { Composer } from "./components/composer.tsx"
import { Conversation } from "./components/conversation.tsx"
import { Header, type HeaderMenu } from "./components/header.tsx"
import { Icon } from "./components/icon.tsx"
import { createController } from "./controller.ts"
import { resolveModel } from "./models.ts"
import { activeTab, initialState, lastContextTokens, persistable, reducer, type State } from "./store.ts"
import { summarizeUsage } from "./usage.ts"
import { loadPersisted, notifyReady, onHostMessage, savePersisted } from "./vscode.ts"

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(loadPersisted()))
  const stateRef = useRef<State>(state)
  stateRef.current = state
  const controller = useMemo(() => createController(() => stateRef.current, dispatch), [])
  const [headerMenu, setHeaderMenu] = useState<HeaderMenu | undefined>(undefined)

  const loadExtensions = () => {
    void controller.loadMcp()
    void controller.loadPlugins()
    void controller.loadSkills()
  }

  useEffect(() => {
    const unsubscribe = onHostMessage((message) => {
      switch (message.type) {
        case "connection":
          dispatch({ type: "connection", state: message.state })
          return
        case "activeFile":
          dispatch({ type: "activeFile", file: message.file })
          return
        case "command":
          if (message.command === "extensions") {
            loadExtensions()
            setHeaderMenu("extensions")
          } else {
            dispatch({ type: "newDraft" })
          }
          return
        case "event":
          dispatch({ type: "event", event: message.event })
          controller.onEvent(message.event)
          return
      }
    })
    notifyReady()
    return unsubscribe
  }, [controller])

  const connected = state.connection.status === "connected"
  const connectionKey = state.connection.status === "connected" ? state.connection.url : state.connection.status

  useEffect(() => {
    if (connected) controller.refreshAll()
  }, [connectionKey])

  useEffect(() => {
    savePersisted(persistable(state))
  }, [state.tabs, state.activeKey, state.attachActiveFile])

  // Esc stops OpenCode from anywhere in the panel, like Claude Code. Open menus
  // handle Esc themselves (closing), so leave it to them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (document.querySelector(".popover")) return
      const current = stateRef.current
      const active = activeTab(current)
      if (active?.kind !== "session") return
      if ((current.sessions[active.sessionID]?.status ?? "idle") === "idle") return
      event.preventDefault()
      void controller.stop()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [controller])

  // Load tabs that were restored or opened from history.
  useEffect(() => {
    if (!connected) return
    for (const tab of state.tabs) {
      if (tab.kind === "session" && !state.sessions[tab.sessionID]) void controller.loadSession(tab.sessionID)
    }
  }, [state.tabs, connected])

  const tab = activeTab(state)
  const view = tab?.kind === "session" ? state.sessions[tab.sessionID] : undefined
  const mode: ModeId | undefined = tab?.kind === "draft" ? tab.mode : readModeMeta(view?.info?.metadata)?.mode
  const modelRef = tab?.kind === "draft" ? tab.model : view?.info?.model
  const model = resolveModel(state.bootstrap, modelRef)
  const busy = view !== undefined && view.status !== "idle"
  const commands = useMemo(() => allCommands(state.bootstrap?.commands ?? []), [state.bootstrap])
  const browser = useMemo(() => (view ? browserActivity(view.messages) : undefined), [view?.messages])
  const browserConnected = Boolean(
    browser && state.mcp?.some((server) => server.name === browser.server && server.status.status === "connected"),
  )
  const lastContext = lastContextTokens(view)
  const usage = summarizeUsage({
    ...(view?.info ? { totals: { tokens: view.info.tokens, cost: view.info.cost } } : {}),
    ...(lastContext !== undefined ? { lastContext } : {}),
    ...(model.info ? { contextLimit: model.info.limit.context } : {}),
  })

  return (
    <div class="app">
      <Header
        state={state}
        onActivate={(key) => dispatch({ type: "activate", key })}
        onClose={(key) => dispatch({ type: "closeTab", key })}
        onNew={() => dispatch({ type: "newDraft" })}
        onOpenSession={(sessionID) => dispatch({ type: "openSession", sessionID })}
        onRefreshHistory={() => void controller.refreshHistory()}
        menu={headerMenu}
        onMenu={setHeaderMenu}
        extensions={{
          onOpen: loadExtensions,
          onMcp: controller.setMcpConnected,
          onAddMcp: controller.addMcp,
          onCheckPlugins: () => controller.loadPlugins(true),
          onUpdatePlugin: (target) => controller.updatePlugins([target]),
          onAttachSkill: (id) => dispatch({ type: "attachSkill", id }),
          onOpenFile: (path) => void controller.openFile(path),
        }}
      />
      <ConnectionBanner state={state} onRetry={() => void controller.reconnect()} />
      {state.notice ? (
        <div class="banner error notice">
          <Icon name="warning" />
          <span>{state.notice}</span>
          <button class="icon-button" title="Dismiss" onClick={() => dispatch({ type: "notice", text: undefined })}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}
      {tab?.kind === "session" ? (
        <Conversation
          view={view ?? { messages: [], permissions: [], forms: [], status: "idle", loaded: false }}
          onOpenFile={(path) => void controller.openFile(path)}
          onReplyPermission={(requestID, decision) => void controller.replyPermission(tab.sessionID, requestID, decision)}
          onOpenDiff={(diff, requestID) => void controller.openDiff(tab.sessionID, diff, requestID)}
          onReplyForm={(formID, answer) => void controller.replyForm(tab.sessionID, formID, answer)}
          onCancelForm={(formID) => void controller.cancelForm(tab.sessionID, formID)}
          onDismissError={() => dispatch({ type: "sessionError", sessionID: tab.sessionID, error: undefined })}
          busy={busy}
          onFork={(messageID, text) => void controller.fork(tab.sessionID, messageID, text)}
          onRewind={(messageID, text, files) => void controller.rewind(tab.sessionID, messageID, text, files)}
          onUndoRewind={() => void controller.undoRewind(tab.sessionID)}
          onKeepRewind={() => void controller.keepRewind(tab.sessionID)}
        />
      ) : (
        <EmptyState state={state} />
      )}
      {browser && tab?.kind === "session" ? (
        <BrowserStrip key={tab.sessionID} activity={browser} connected={browserConnected} />
      ) : null}
      <Composer
        disabled={!connected}
        busy={busy}
        canStop={busy}
        mode={mode}
        model={model}
        models={state.bootstrap?.models ?? []}
        commands={commands}
        usage={usage}
        skills={state.pendingSkills.map((id) => ({ id, name: state.skills?.find((skill) => skill.id === id)?.name ?? id }))}
        onDetachSkill={(id) => dispatch({ type: "detachSkill", id })}
        activeFile={state.activeFile}
        attachActiveFile={state.attachActiveFile}
        onToggleAttach={() => dispatch({ type: "toggleAttach" })}
        onSend={controller.send}
        onError={(text) => dispatch({ type: "notice", text })}
        prefill={state.prefill}
        onStop={() => void controller.stop()}
        onMode={(next) => void controller.setMode(next)}
        onModel={(next) => void controller.setModel(next)}
      />
    </div>
  )
}

function ConnectionBanner({ state, onRetry }: { state: State; onRetry: () => void }) {
  const { connection } = state
  if (connection.status === "connected") return null
  if (connection.status === "connecting") {
    return (
      <div class="banner info">
        <Icon name="loading" spin />
        <span>{connection.detail ?? "Connecting to OpenCode…"}</span>
      </div>
    )
  }
  return (
    <div class="banner error">
      <Icon name="debug-disconnect" />
      <span>{connection.message}</span>
      <button class="button secondary" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

function EmptyState({ state }: { state: State }) {
  const directory = state.bootstrap?.directory
  const folder = directory?.split(/[\\/]/).filter(Boolean).pop()
  return (
    <div class="conversation empty">
      <div class="empty-state">
        <div class="empty-title">OpenCode</div>
        <div class="empty-subtitle">
          {folder ? `New session in ${folder}` : "Open a folder to work on a project"}
        </div>
        <div class="empty-hints">
          <div>
            <kbd>Enter</kbd> to send, <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
          </div>
          <div>
            <kbd>Shift</kbd> + <kbd>Tab</kbd> to switch modes
          </div>
          <div>Sessions sync with the OpenCode TUI. Open past ones from the history button.</div>
        </div>
      </div>
    </div>
  )
}
