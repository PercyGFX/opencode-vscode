import { useState } from "preact/hooks"
import type { PermissionRequest } from "@opencode/client"
import { readFileDiffs, type FileDiff } from "../../shared/diff.ts"
import type { FormAnswerValue } from "../../shared/protocol.ts"
import { initialAnswer, missingFields, type UiForm, type UiFormField } from "../forms.ts"
import { DiffView } from "./diff.tsx"
import { Icon } from "./icon.tsx"

const ACTION_LABELS: Record<string, string> = {
  edit: "edit files",
  shell: "run a command",
  read: "read a file",
  glob: "search for files",
  grep: "search file contents",
  webfetch: "fetch a URL",
  websearch: "search the web",
  external_directory: "work outside the workspace",
  subagent: "start a subagent",
  skill: "load a skill",
}

type PermissionCardProps = {
  request: PermissionRequest
  onReply: (decision: "once" | "always" | "reject") => void
  onOpenDiff: (diff: FileDiff) => void
}

export function PermissionCard({ request, onReply, onOpenDiff }: PermissionCardProps) {
  const label = ACTION_LABELS[request.action] ?? request.action
  const always = request.save?.length ? `Always allow: ${request.save.join(", ")}` : "Allow this for the rest of the session"
  const diffs = request.action === "edit" ? readFileDiffs(request.metadata) : []
  return (
    <div class="card permission">
      <div class="card-title">
        <Icon name="shield" />
        <span>OpenCode wants to {label}</span>
      </div>
      {request.message ? <div class="card-message">{request.message}</div> : null}
      {diffs.length ? (
        diffs.map((diff) => <DiffView key={diff.file} diff={diff} onOpen={() => onOpenDiff(diff)} />)
      ) : request.resources.length ? (
        <div class="card-resources">
          {request.resources.map((resource) => (
            <code key={resource}>{resource}</code>
          ))}
        </div>
      ) : null}
      <div class="card-actions">
        <button class="button primary" onClick={() => onReply("once")}>
          Allow
        </button>
        <button class="button secondary" title={always} onClick={() => onReply("always")}>
          Always allow
        </button>
        <button class="button secondary" onClick={() => onReply("reject")}>
          Deny
        </button>
      </div>
    </div>
  )
}

type FormCardProps = {
  form: UiForm
  onSubmit: (answer: Record<string, FormAnswerValue>) => void
  onCancel: () => void
}

export function FormCard({ form, onSubmit, onCancel }: FormCardProps) {
  const [answer, setAnswer] = useState<Record<string, FormAnswerValue>>(() => initialAnswer(form))
  const [missing, setMissing] = useState<string[]>([])

  const set = (key: string, value: FormAnswerValue | undefined) => {
    setAnswer((current) => {
      const next = { ...current }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })
  }

  const submit = () => {
    const absent = missingFields(form, answer)
    setMissing(absent)
    if (!absent.length) onSubmit(answer)
  }

  return (
    <div class="card form">
      <div class="card-title">
        <Icon name="question" />
        <span>{form.title}</span>
      </div>
      {form.fields.map((field) => (
        <FieldView key={field.key} field={field} value={answer[field.key]} onChange={(value) => set(field.key, value)} />
      ))}
      {missing.length ? <div class="card-warning">Please answer: {missing.join(", ")}</div> : null}
      <div class="card-actions">
        <button class="button primary" onClick={submit}>
          Submit
        </button>
        <button class="button secondary" onClick={onCancel}>
          Skip
        </button>
      </div>
    </div>
  )
}

type FieldViewProps = {
  field: UiFormField
  value: FormAnswerValue | undefined
  onChange: (value: FormAnswerValue | undefined) => void
}

function FieldView({ field, value, onChange }: FieldViewProps) {
  const heading = (
    <div class="field-heading">
      <span class="field-title">
        {field.title}
        {field.required ? " *" : ""}
      </span>
      {field.description ? <span class="field-description">{field.description}</span> : null}
    </div>
  )

  switch (field.kind) {
    case "choice": {
      const known = field.options.some((option) => option.value === value)
      return (
        <div class="field">
          {heading}
          {field.options.map((option) => (
            <label key={option.value} class="option">
              <input type="radio" name={field.key} checked={value === option.value} onChange={() => onChange(option.value)} />
              <span>
                <span class="option-label">{option.label}</span>
                {option.description ? <span class="option-description">{option.description}</span> : null}
              </span>
            </label>
          ))}
          {field.custom ? (
            <input
              class="text-input"
              placeholder="Something else…"
              value={!known && typeof value === "string" ? value : ""}
              onInput={(event) => onChange(event.currentTarget.value || undefined)}
            />
          ) : null}
        </div>
      )
    }
    case "multiselect": {
      const selected = Array.isArray(value) ? value : []
      const toggle = (option: string) =>
        onChange(selected.includes(option) ? selected.filter((entry) => entry !== option) : [...selected, option])
      return (
        <div class="field">
          {heading}
          {field.options.map((option) => (
            <label key={option.value} class="option">
              <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
              <span>
                <span class="option-label">{option.label}</span>
                {option.description ? <span class="option-description">{option.description}</span> : null}
              </span>
            </label>
          ))}
        </div>
      )
    }
    case "text":
      return (
        <div class="field">
          {heading}
          <textarea
            class="text-input"
            rows={2}
            placeholder={field.placeholder}
            value={typeof value === "string" ? value : ""}
            onInput={(event) => onChange(event.currentTarget.value)}
          />
        </div>
      )
    case "number":
      return (
        <div class="field">
          {heading}
          <input
            class="text-input"
            type="number"
            step={field.integer ? 1 : "any"}
            value={typeof value === "number" ? String(value) : ""}
            onInput={(event) => {
              const raw = event.currentTarget.value
              onChange(raw === "" ? undefined : Number(raw))
            }}
          />
        </div>
      )
    case "boolean":
      return (
        <label class="field option">
          <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.currentTarget.checked)} />
          {heading}
        </label>
      )
    case "external":
      return (
        <div class="field">
          {heading}
          <a href={field.url}>{field.url}</a>
        </div>
      )
  }
}
