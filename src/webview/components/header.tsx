import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import type { SessionInfo } from "@opencode/client"
import type { State, Tab } from "../store.ts"
import { Icon } from "./icon.tsx"

type HeaderProps = {
  state: State
  onActivate: (key: string) => void
  onClose: (key: string) => void
  onNew: () => void
  onOpenSession: (sessionID: string) => void
  onRefreshHistory: () => void
}

export function sessionTitle(info: SessionInfo | undefined): string {
  return info?.title?.trim() || "Untitled session"
}

const tabTitle = (state: State, tab: Tab): string => {
  if (tab.kind === "draft") return "New session"
  const info = state.sessions[tab.sessionID]?.info ?? state.history.find((session) => session.id === tab.sessionID)
  return info ? sessionTitle(info) : "Loading…"
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(timestamp).toLocaleDateString()
}

export function Header({ state, onActivate, onClose, onNew, onOpenSession, onRefreshHistory }: HeaderProps) {
  const [historyOpen, setHistoryOpen] = useState(false)

  const toggleHistory = () => {
    if (!historyOpen) onRefreshHistory()
    setHistoryOpen(!historyOpen)
  }

  return (
    <div class="header">
      <div class="tabs" role="tablist">
        {state.tabs.map((tab) => {
          const active = tab.key === state.activeKey
          const running = tab.kind === "session" && Boolean(state.running[tab.sessionID])
          return (
            <div
              key={tab.key}
              class={`tab${active ? " active" : ""}`}
              role="tab"
              aria-selected={active}
              title={tabTitle(state, tab)}
              onClick={() => onActivate(tab.key)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.key)
              }}
            >
              {running ? <Icon name="loading" spin /> : null}
              <span class="tab-title">{tabTitle(state, tab)}</span>
              <button
                class="tab-close"
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.key)
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          )
        })}
      </div>
      <div class="header-actions">
        <button class={`icon-button${historyOpen ? " pressed" : ""}`} title="Session history" onClick={toggleHistory}>
          <Icon name="history" />
        </button>
        <button class="icon-button" title="New session" onClick={onNew}>
          <Icon name="add" />
        </button>
      </div>
      {historyOpen ? (
        <HistoryMenu
          state={state}
          onClose={() => setHistoryOpen(false)}
          onOpen={(sessionID) => {
            setHistoryOpen(false)
            onOpenSession(sessionID)
          }}
        />
      ) : null}
    </div>
  )
}

type HistoryMenuProps = {
  state: State
  onClose: () => void
  onOpen: (sessionID: string) => void
}

function HistoryMenu({ state, onClose, onOpen }: HistoryMenuProps) {
  const [query, setQuery] = useState("")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const sessions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? state.history.filter((session) => sessionTitle(session).toLowerCase().includes(needle)) : state.history
  }, [state.history, query])

  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class="popover history">
        <div class="popover-search">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            placeholder="Search sessions"
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && sessions[0]) onOpen(sessions[0].id)
            }}
          />
        </div>
        <div class="history-list">
          {sessions.length === 0 ? (
            <div class="history-empty">{state.history.length ? "No matching sessions" : "No sessions in this workspace yet"}</div>
          ) : (
            sessions.map((session) => (
              <button key={session.id} class="history-item" onClick={() => onOpen(session.id)}>
                <span class={`history-dot${state.running[session.id] ? " running" : ""}`} />
                <span class="history-title">{sessionTitle(session)}</span>
                <span class="history-time">{relativeTime(session.time.updated)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
