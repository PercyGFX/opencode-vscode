// Messages between the extension host and the chat webview.

import type {
  AgentInfo,
  CommandInfo,
  FormDetail,
  ModelInfo,
  OpenCodeEvent,
  PermissionRequest,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client"
import type { FileDiffStatus } from "./diff.ts"
import type { ModeId } from "./modes.ts"

export type ConnectionState =
  | { status: "connecting"; detail?: string }
  | { status: "connected"; url: string; version: string }
  | { status: "error"; message: string }

export type ModelChoice = {
  providerID: string
  id: string
  variant?: string
}

export type Bootstrap = {
  directory: string | undefined
  agents: AgentInfo[]
  models: ModelInfo[]
  defaultModel: ModelInfo | null
  defaultMode: ModeId
  commands: CommandInfo[]
  // The model and mode last picked in the chat, used for new sessions.
  lastModel: ModelChoice | null
  lastMode: ModeId | null
}

export type ActiveFile =
  | {
      path: string
      relativePath: string
      selection?: { startLine: number; endLine: number }
    }
  | undefined

export type SessionList = {
  sessions: SessionInfo[]
  running: string[]
}

export type LoadedSession = {
  info: SessionInfo
  messages: SessionMessageInfo[]
  permissions: PermissionRequest[]
  forms: FormDetail[]
  running: boolean
}

export type FormAnswerValue = string | number | boolean | string[]

export type RequestMap = {
  bootstrap: { params: Record<string, never>; result: Bootstrap }
  listSessions: { params: { search?: string }; result: SessionList }
  loadSession: { params: { sessionID: string }; result: LoadedSession }
  loadMessages: { params: { sessionID: string }; result: SessionMessageInfo[] }
  createSession: { params: { mode: ModeId; model?: ModelChoice }; result: SessionInfo }
  prompt: { params: { sessionID: string; text: string; attachActiveFile: boolean }; result: null }
  command: {
    params: { sessionID: string; name: string; text: string; attachActiveFile: boolean }
    result: null
  }
  compact: { params: { sessionID: string }; result: null }
  interrupt: { params: { sessionID: string }; result: null }
  setMode: { params: { sessionID: string; mode: ModeId }; result: SessionInfo }
  setModel: { params: { sessionID: string; model: ModelChoice }; result: SessionInfo }
  remember: { params: { model?: ModelChoice; mode?: ModeId }; result: null }
  replyPermission: {
    params: { sessionID: string; requestID: string; decision: "once" | "always" | "reject" }
    result: null
  }
  replyForm: {
    params: { sessionID: string; formID: string; answer: Record<string, FormAnswerValue> }
    result: null
  }
  cancelForm: { params: { sessionID: string; formID: string }; result: null }
  getForm: { params: { sessionID: string; formID: string }; result: FormDetail }
  openFile: { params: { path: string }; result: null }
  openDiff: {
    params: { file: string; patch: string; status: FileDiffStatus; sessionID?: string; requestID?: string }
    result: null
  }
  reconnect: { params: Record<string, never>; result: null }
}

export type RequestMethod = keyof RequestMap

export type WebviewToHost =
  | { type: "ready" }
  | { type: "request"; id: number; method: RequestMethod; params: unknown }

export type HostToWebview =
  | { type: "response"; id: number; ok: true; result: unknown }
  | { type: "response"; id: number; ok: false; error: string }
  | { type: "connection"; state: ConnectionState }
  | { type: "event"; event: OpenCodeEvent }
  | { type: "activeFile"; file: ActiveFile }
  | { type: "command"; command: "newSession" }
