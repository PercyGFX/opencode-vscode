import type { HostToWebview, RequestMap, RequestMethod, WebviewToHost } from "../shared/protocol.ts"
import type { Persisted } from "./store.ts"

type VsCodeApi = {
  postMessage(message: WebviewToHost): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

const api = acquireVsCodeApi()

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

let nextID = 1
const pending = new Map<number, Pending>()
const listeners = new Set<(message: HostToWebview) => void>()

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data
  if (message.type !== "response") {
    for (const listener of listeners) listener(message)
    return
  }
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.ok) entry.resolve(message.result)
  else entry.reject(new Error(message.error))
})

export function request<M extends RequestMethod>(
  method: M,
  params: RequestMap[M]["params"],
): Promise<RequestMap[M]["result"]> {
  const id = nextID++
  return new Promise<RequestMap[M]["result"]>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as RequestMap[M]["result"]), reject })
    api.postMessage({ type: "request", id, method, params })
  })
}

export function onHostMessage(listener: (message: HostToWebview) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyReady(): void {
  api.postMessage({ type: "ready" })
}

export function loadPersisted(): Persisted | undefined {
  const raw = api.getState()
  if (typeof raw !== "object" || raw === null) return undefined
  const candidate = raw as Record<string, unknown>
  const tabs = Array.isArray(candidate.tabs) ? candidate.tabs.filter((tab): tab is string => typeof tab === "string") : []
  return {
    tabs,
    ...(typeof candidate.active === "string" ? { active: candidate.active } : {}),
    attachActiveFile: candidate.attachActiveFile !== false,
  }
}

export function savePersisted(state: Persisted): void {
  api.setState(state)
}
