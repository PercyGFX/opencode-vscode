import { useLayoutEffect, useMemo, useRef } from "preact/hooks"
import type { FormAnswerValue } from "../../shared/protocol.ts"
import { renderMarkdown } from "../markdown.ts"
import { toolSummary, type UiAssistantMessage, type UiMessage, type UiPart, type UiToolPart } from "../messages.ts"
import type { SessionView } from "../store.ts"
import type { FileDiff } from "../../shared/diff.ts"
import { FormCard, PermissionCard } from "./cards.tsx"
import { DiffView } from "./diff.tsx"
import { Icon } from "./icon.tsx"

const OUTPUT_LIMIT = 6000

type ConversationProps = {
  view: SessionView
  onOpenFile: (path: string) => void
  onReplyPermission: (requestID: string, decision: "once" | "always" | "reject") => void
  onOpenDiff: (diff: FileDiff, requestID: string) => void
  onReplyForm: (formID: string, answer: Record<string, FormAnswerValue>) => void
  onCancelForm: (formID: string) => void
  onDismissError: () => void
}

export function Conversation({
  view,
  onOpenFile,
  onReplyPermission,
  onOpenDiff,
  onReplyForm,
  onCancelForm,
  onDismissError,
}: ConversationProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Follow new output while the user is at the bottom; leave them alone if
  // they scrolled up to read.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  })

  const onScroll = () => {
    const element = scroller.current
    if (element) stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }

  const lastAssistant = [...view.messages].reverse().find((message) => message.kind === "assistant")
  const working = view.status !== "idle"

  return (
    <div class="conversation" ref={scroller} onScroll={onScroll}>
      {!view.loaded && view.messages.length === 0 && !view.error ? (
        <div class="placeholder">
          <Icon name="loading" spin /> Loading session…
        </div>
      ) : null}
      {view.messages.map((message) => (
        <MessageView key={message.id} message={message} onOpenFile={onOpenFile} />
      ))}
      {working && (!lastAssistant || lastAssistant.kind !== "assistant" || lastAssistant.done) ? (
        <div class="working">
          <Icon name="loading" spin /> {view.status === "retry" ? (view.retryMessage ?? "Retrying…") : "Working…"}
        </div>
      ) : null}
      {view.error ? (
        <div class="banner error">
          <Icon name="error" />
          <span>{view.error}</span>
          <button class="icon-button" title="Dismiss" onClick={onDismissError}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}
      {view.permissions.map((request) => (
        <PermissionCard
          key={request.id}
          request={request}
          onReply={(decision) => onReplyPermission(request.id, decision)}
          onOpenDiff={(diff) => onOpenDiff(diff, request.id)}
        />
      ))}
      {view.forms.map((form) => (
        <FormCard
          key={form.id}
          form={form}
          onSubmit={(answer) => onReplyForm(form.id, answer)}
          onCancel={() => onCancelForm(form.id)}
        />
      ))}
    </div>
  )
}

function MessageView({ message, onOpenFile }: { message: UiMessage; onOpenFile: (path: string) => void }) {
  switch (message.kind) {
    case "user":
      return (
        <div class={`message user${message.pending ? " pending" : ""}`}>
          <div class="user-text">{message.text}</div>
          {message.files.length ? (
            <div class="user-files">
              {message.files.map((file) => (
                <span key={file} class="chip">
                  <Icon name="file" /> {file}
                </span>
              ))}
            </div>
          ) : null}
          {message.pending ? <div class="queued">Queued</div> : null}
        </div>
      )
    case "assistant":
      return <AssistantView message={message} onOpenFile={onOpenFile} />
    case "note":
      return <div class={`note ${message.tone}`}>{message.text}</div>
    case "shell":
      return (
        <details class="tool shell">
          <summary>
            <Icon name="terminal" />
            <span class="tool-name">$</span>
            <span class="tool-summary">{message.command}</span>
            <span class="tool-state">{message.status}</span>
          </summary>
          {message.output ? <pre class="tool-output">{clip(message.output)}</pre> : null}
        </details>
      )
  }
}

function AssistantView({ message, onOpenFile }: { message: UiAssistantMessage; onOpenFile: (path: string) => void }) {
  return (
    <div class="message assistant">
      {message.parts.map((part, index) => (
        <PartView key={index} part={part} onOpenFile={onOpenFile} />
      ))}
      {message.error ? (
        <div class="banner error">
          <Icon name="error" />
          <span>{message.error}</span>
        </div>
      ) : null}
    </div>
  )
}

function PartView({ part, onOpenFile }: { part: UiPart; onOpenFile: (path: string) => void }) {
  switch (part.kind) {
    case "text":
      return <Markdown text={part.text} />
    case "reasoning":
      if (!part.text.trim()) return null
      return (
        <details class="reasoning">
          <summary>
            {part.done ? <Icon name="lightbulb" /> : <Icon name="loading" spin />}
            <span>{part.done ? "Thought" : "Thinking…"}</span>
          </summary>
          <Markdown text={part.text} />
        </details>
      )
    case "tool":
      return <ToolView part={part} onOpenFile={onOpenFile} />
  }
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div class="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

const TOOL_ICONS: Record<string, string> = {
  read: "file",
  edit: "edit",
  write: "new-file",
  patch: "diff",
  shell: "terminal",
  bash: "terminal",
  glob: "search",
  grep: "search",
  webfetch: "globe",
  websearch: "globe",
  subagent: "organization",
  task: "organization",
  todo: "checklist",
  todowrite: "checklist",
  question: "question",
  skill: "book",
}

const filePathOf = (part: UiToolPart): string | undefined => {
  for (const key of ["filePath", "path", "file"]) {
    const value = part.input[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function ToolView({ part, onOpenFile }: { part: UiToolPart; onOpenFile: (path: string) => void }) {
  const summary = toolSummary(part)
  const filePath = filePathOf(part)
  const icon = part.status === "error" ? "error" : (TOOL_ICONS[part.name] ?? "tools")
  const busy = part.status === "streaming" || part.status === "running"
  const input = JSON.stringify(part.input, null, 2)

  return (
    <details class={`tool ${part.status}`}>
      <summary>
        {busy ? <Icon name="loading" spin /> : <Icon name={icon} />}
        <span class="tool-name">{part.name}</span>
        {filePath ? (
          <a
            class="tool-summary link"
            title={`Open ${filePath}`}
            onClick={(event) => {
              event.preventDefault()
              onOpenFile(filePath)
            }}
          >
            {summary}
          </a>
        ) : (
          <span class="tool-summary">{summary}</span>
        )}
      </summary>
      {part.diffs?.length ? (
        <div class="tool-diffs">
          {part.diffs.map((diff) => (
            <DiffView key={diff.file} diff={diff} />
          ))}
        </div>
      ) : (
        <>
          {input !== "{}" ? <pre class="tool-input">{clip(input)}</pre> : null}
          {part.output ? <pre class="tool-output">{clip(part.output)}</pre> : null}
        </>
      )}
      {part.error ? <pre class="tool-output error">{part.error}</pre> : null}
    </details>
  )
}

const clip = (text: string) =>
  text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n… ${text.length - OUTPUT_LIMIT} more characters` : text
