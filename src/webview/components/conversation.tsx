import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import type { ComponentChildren } from "preact"
import type { FileDiff } from "../../shared/diff.ts"
import type { FormAnswerValue } from "../../shared/protocol.ts"
import { renderMarkdown } from "../markdown.ts"
import {
  toolSummary,
  type UiAssistantMessage,
  type UiMessage,
  type UiShellMessage,
  type UiToolPart,
  type UiUserMessage,
} from "../messages.ts"
import type { SessionView } from "../store.ts"
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

// A user prompt, or everything OpenCode did in reply to it (drawn as one timeline).
type Block = { kind: "user"; message: UiUserMessage } | { kind: "turn"; key: string; messages: UiMessage[] }

const groupBlocks = (messages: readonly UiMessage[]): Block[] => {
  const blocks: Block[] = []
  for (const message of messages) {
    if (message.kind === "user") {
      blocks.push({ kind: "user", message })
      continue
    }
    const last = blocks.at(-1)
    if (last?.kind === "turn") last.messages.push(message)
    else blocks.push({ kind: "turn", key: message.id, messages: [message] })
  }
  return blocks
}

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
const minuteOf = (timestamp: number) => Math.floor(timestamp / 60_000)

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

  const blocks = useMemo(() => groupBlocks(view.messages), [view.messages])
  const lastAssistant = view.messages.findLast((message) => message.kind === "assistant")
  const working = view.status !== "idle" && (!lastAssistant || lastAssistant.kind !== "assistant" || lastAssistant.done)
  const workingLabel = view.status === "retry" ? (view.retryMessage ?? "Retrying…") : "Working…"
  const lastBlock = blocks.at(-1)

  return (
    <div class="conversation" ref={scroller} onScroll={onScroll}>
      {!view.loaded && view.messages.length === 0 && !view.error ? (
        <div class="placeholder">
          <Icon name="loading" spin /> Loading session…
        </div>
      ) : null}
      {blocks.map((block) =>
        block.kind === "user" ? (
          <UserMessage key={block.message.id} message={block.message} />
        ) : (
          <Turn
            key={block.key}
            messages={block.messages}
            working={working && block === lastBlock ? workingLabel : undefined}
            onOpenFile={onOpenFile}
          />
        ),
      )}
      {working && lastBlock?.kind !== "turn" ? <Turn messages={[]} working={workingLabel} onOpenFile={onOpenFile} /> : null}
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

function UserMessage({ message }: { message: UiUserMessage }) {
  return (
    <div class="user-block">
      <div class="timestamp">{formatTime(message.created)}</div>
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
    </div>
  )
}

type DotKind = "text" | "thinking" | "note" | "error" | "working" | "streaming" | "running" | "completed"

// One item on the timeline: a dot on the rail, then its content.
function Row({ dot, children }: { dot: DotKind; children: ComponentChildren }) {
  return (
    <div class={`row dot-${dot}`}>
      <span class="row-dot" />
      <div class="row-content">{children}</div>
    </div>
  )
}

function Turn({
  messages,
  working,
  onOpenFile,
}: {
  messages: UiMessage[]
  working: string | undefined
  onOpenFile: (path: string) => void
}) {
  let lastMinute: number | undefined
  return (
    <div class="turn">
      {messages.map((message) => {
        const created = message.kind === "assistant" ? message.created : undefined
        const showTime = created !== undefined && minuteOf(created) !== lastMinute
        if (created !== undefined) lastMinute = minuteOf(created)
        return (
          <div key={message.id} class="turn-message">
            {showTime && created !== undefined ? <div class="timestamp">{formatTime(created)}</div> : null}
            <TurnMessage message={message} onOpenFile={onOpenFile} />
          </div>
        )
      })}
      {working ? (
        <Row dot="working">
          <span class="muted">{working}</span>
        </Row>
      ) : null}
    </div>
  )
}

function TurnMessage({ message, onOpenFile }: { message: UiMessage; onOpenFile: (path: string) => void }) {
  switch (message.kind) {
    case "assistant":
      return <AssistantRows message={message} onOpenFile={onOpenFile} />
    case "note":
      return (
        <Row dot={message.tone === "error" ? "error" : "note"}>
          <span class={message.tone === "error" ? "error-text" : "muted"}>{message.text}</span>
        </Row>
      )
    case "shell":
      return <ShellRow message={message} />
    case "user":
      return null
  }
}

function AssistantRows({ message, onOpenFile }: { message: UiAssistantMessage; onOpenFile: (path: string) => void }) {
  return (
    <>
      {message.parts.map((part, index) => {
        if (part.kind === "text") {
          return part.text.trim() ? (
            <Row key={index} dot="text">
              <Markdown text={part.text} />
            </Row>
          ) : null
        }
        if (part.kind === "reasoning") return part.text.trim() ? <Thinking key={index} text={part.text} done={part.done} /> : null
        return <ToolRow key={part.id} part={part} onOpenFile={onOpenFile} />
      })}
      {message.error ? (
        <Row dot="error">
          <span class="error-text">{message.error}</span>
        </Row>
      ) : null}
    </>
  )
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div class="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

function Thinking({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Row dot="thinking">
      <button class="row-toggle muted" onClick={() => setOpen(!open)}>
        {done ? "Thinking" : "Thinking…"}
        <Icon name={open ? "chevron-up" : "chevron-down"} />
      </button>
      {open ? <Markdown text={text} /> : null}
    </Row>
  )
}

const TOOL_LABELS: Record<string, string> = {
  shell: "Shell",
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  patch: "Patch",
  glob: "Glob",
  grep: "Grep",
  webfetch: "Fetch",
  websearch: "Search",
  subagent: "Agent",
  task: "Agent",
  todo: "Todos",
  todowrite: "Todos",
  question: "Question",
  skill: "Skill",
}

const SHELL_TOOLS = new Set(["shell", "bash"])

const toolLabel = (name: string) => TOOL_LABELS[name] ?? name

const filePathOf = (part: UiToolPart): string | undefined => {
  for (const key of ["filePath", "path", "file"]) {
    const value = part.input[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

const stringInput = (part: UiToolPart, key: string): string | undefined => {
  const value = part.input[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

// "Added 3 lines", "Removed 2 lines" or "+3 -2" for edits.
const changeSummary = (diffs: FileDiff[]): string => {
  const additions = diffs.reduce((sum, diff) => sum + diff.additions, 0)
  const deletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0)
  const lines = (count: number) => `${count} line${count === 1 ? "" : "s"}`
  if (additions && !deletions) return `Added ${lines(additions)}`
  if (deletions && !additions) return `Removed ${lines(deletions)}`
  return `Changed ${lines(additions + deletions)}: +${additions} -${deletions}`
}

function ToolRow({ part, onOpenFile }: { part: UiToolPart; onOpenFile: (path: string) => void }) {
  const isShell = SHELL_TOOLS.has(part.name)
  const [open, setOpen] = useState(isShell)
  const dot: DotKind = part.status === "error" ? "error" : part.status
  const command = isShell ? stringInput(part, "command") : undefined
  const summary = isShell ? (stringInput(part, "description") ?? command ?? "") : toolSummary(part)
  const filePath = isShell ? undefined : filePathOf(part)
  const input = JSON.stringify(part.input, null, 2)
  const hasDetails = Boolean(part.diffs?.length || part.output || part.error || input !== "{}")

  return (
    <Row dot={dot}>
      <div class="tool-heading">
        <button class="row-toggle" disabled={!hasDetails} onClick={() => setOpen(!open)}>
          <span class="tool-name">{toolLabel(part.name)}</span>
        </button>
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
          <span class="tool-summary" title={summary} onClick={() => hasDetails && setOpen(!open)}>
            {summary}
          </span>
        )}
      </div>
      {part.diffs?.length ? <div class="tool-caption">{changeSummary(part.diffs)}</div> : null}
      {open || part.status === "error" ? (
        part.diffs?.length ? (
          <div class="tool-diffs">
            {part.diffs.map((diff) => (
              <DiffView key={diff.file} diff={diff} />
            ))}
          </div>
        ) : (
          <IoBox
            input={command ?? (input !== "{}" ? input : undefined)}
            output={part.error ?? (part.output || undefined)}
            failed={Boolean(part.error)}
          />
        )
      ) : null}
    </Row>
  )
}

function ShellRow({ message }: { message: UiShellMessage }) {
  const dot: DotKind = message.status === "running" ? "running" : message.status === "exited" ? "completed" : "error"
  return (
    <Row dot={dot}>
      <div class="tool-heading">
        <span class="tool-name">Shell</span>
        <span class="tool-summary">{message.command}</span>
      </div>
      <IoBox input={message.command} output={message.output || undefined} failed={dot === "error"} />
    </Row>
  )
}

// Claude Code-style box: what went in, what came out.
function IoBox({ input, output, failed }: { input?: string; output?: string; failed?: boolean }) {
  if (!input && !output) return null
  return (
    <div class="io-box">
      {input ? (
        <div class="io-row">
          <span class="io-label">IN</span>
          <pre class="io-text">{clip(input)}</pre>
        </div>
      ) : null}
      {output ? (
        <div class="io-row">
          <span class="io-label">OUT</span>
          <pre class={`io-text${failed ? " error-text" : ""}`}>{clip(output)}</pre>
        </div>
      ) : null}
    </div>
  )
}

const clip = (text: string) =>
  text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n… ${text.length - OUTPUT_LIMIT} more characters` : text
