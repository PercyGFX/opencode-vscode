// The chat's own message model. Server messages and live stream events both
// map onto it, so the components only deal with one shape.

import type { SessionMessageInfo } from "@opencode/client"
import { readFileDiffs, type FileDiff } from "../shared/diff.ts"
import { contextTokens } from "./usage.ts"

export type ToolStatus = "streaming" | "running" | "completed" | "error"

export type UiTextPart = { kind: "text"; text: string }
export type UiReasoningPart = { kind: "reasoning"; text: string; done: boolean }
export type UiToolPart = {
  kind: "tool"
  id: string
  name: string
  status: ToolStatus
  input: Record<string, unknown>
  output: string
  error?: string
  // File changes an edit, write or patch call made.
  diffs?: FileDiff[]
}
export type UiPart = UiTextPart | UiReasoningPart | UiToolPart

export type UiUserMessage = { kind: "user"; id: string; text: string; files: string[]; pending: boolean; created: number }
export type UiAssistantMessage = {
  kind: "assistant"
  id: string
  agent: string
  created: number
  parts: UiPart[]
  // Stream key ("text:0", "tool:<id>") → index in parts.
  keys: Record<string, number>
  error?: string
  done: boolean
  // Tokens this step put through the model, for the context gauge.
  contextTokens?: number
}
export type UiNoteMessage = { kind: "note"; id: string; text: string; tone: "info" | "error" }
export type UiShellMessage = { kind: "shell"; id: string; command: string; output: string; status: string }
export type UiMessage = UiUserMessage | UiAssistantMessage | UiNoteMessage | UiShellMessage

type ToolContentLike = { type: "text"; text: string } | { type: "file"; uri: string; name?: string | null }

export function toolOutput(content: readonly ToolContentLike[] | undefined): string {
  return (content ?? []).map((item) => (item.type === "text" ? item.text : `[file] ${item.name ?? item.uri}`)).join("\n")
}

export function fileLabel(file: { name?: string | null; uri?: string }): string {
  return file.name ?? file.uri ?? "file"
}

export function toUiMessage(message: SessionMessageInfo): UiMessage | undefined {
  switch (message.type) {
    case "user":
      return {
        kind: "user",
        id: message.id,
        text: message.text,
        files: (message.files ?? []).map(fileLabel),
        pending: false,
        created: message.time.created,
      }
    case "assistant": {
      const keys: Record<string, number> = {}
      const parts = message.content.map((part, index): UiPart => {
        if (part.type === "text") return { kind: "text", text: part.text }
        if (part.type === "reasoning") return { kind: "reasoning", text: part.text, done: true }
        keys[`tool:${part.id}`] = index
        const state = part.state
        const input = typeof state.input === "string" ? {} : state.input
        if (state.status === "completed") {
          const diffs = readFileDiffs(state.metadata)
          return {
            kind: "tool",
            id: part.id,
            name: part.name,
            status: "completed",
            input,
            output: toolOutput(state.content),
            ...(diffs.length ? { diffs } : {}),
          }
        }
        if (state.status === "error") {
          return {
            kind: "tool",
            id: part.id,
            name: part.name,
            status: "error",
            input,
            output: toolOutput(state.content),
            error: state.error.message,
          }
        }
        return { kind: "tool", id: part.id, name: part.name, status: state.status, input, output: "" }
      })
      const assistant: UiAssistantMessage = {
        kind: "assistant",
        id: message.id,
        agent: message.agent,
        created: message.time.created,
        parts,
        keys,
        done: message.time.completed !== undefined || message.finish !== undefined || message.error !== undefined,
        ...(message.tokens ? { contextTokens: contextTokens(message.tokens) } : {}),
      }
      return message.error ? { ...assistant, error: message.error.message } : assistant
    }
    case "synthetic":
      return { kind: "note", id: message.id, text: message.description ?? message.text, tone: "info" }
    case "shell":
      return { kind: "shell", id: message.id, command: message.command, output: message.output?.output ?? "", status: message.status }
    case "agent-switched":
      return { kind: "note", id: message.id, text: `Switched to the ${message.agent} agent`, tone: "info" }
    case "model-switched": {
      const variant = message.model.variant ? ` (${message.model.variant})` : ""
      return { kind: "note", id: message.id, text: `Switched to ${message.model.id}${variant}`, tone: "info" }
    }
    case "compaction":
      if (message.status === "failed") {
        return { kind: "note", id: message.id, text: `Compaction failed: ${message.error.message}`, tone: "error" }
      }
      return {
        kind: "note",
        id: message.id,
        text: message.status === "running" ? "Compacting the conversation…" : "Conversation compacted",
        tone: "info",
      }
    case "skill":
      return { kind: "note", id: message.id, text: `Loaded the ${message.name} skill`, tone: "info" }
    default:
      return undefined
  }
}

export function toUiMessages(messages: readonly SessionMessageInfo[]): UiMessage[] {
  return messages.flatMap((message) => toUiMessage(message) ?? [])
}

// Short description of what a tool call is working on, for the collapsed row.
export function toolSummary(part: UiToolPart): string {
  const { input } = part
  const firstLine = (value: string) => value.trim().split("\n")[0] ?? ""
  for (const key of ["filePath", "path", "file", "command", "pattern", "url", "query", "description", "prompt"]) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return firstLine(value)
  }
  // MCP tools use their own argument names; show the first text argument.
  const fallback = Object.values(input).find((value): value is string => typeof value === "string" && value.trim() !== "")
  return fallback ? firstLine(fallback) : ""
}
