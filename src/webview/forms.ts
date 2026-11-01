// Forms are how OpenCode agents ask the user questions mid-task. The session
// waits until the form is answered or cancelled.

import type { FormAnswerValue } from "../shared/protocol.ts"

export type UiFormOption = { value: string; label: string; description?: string }

type FieldBase = { key: string; title: string; description?: string; required: boolean }

export type UiFormField =
  | (FieldBase & { kind: "choice"; options: UiFormOption[]; custom: boolean; defaultValue?: string })
  | (FieldBase & { kind: "text"; placeholder?: string; defaultValue?: string })
  | (FieldBase & { kind: "number"; integer: boolean; defaultValue?: number })
  | (FieldBase & { kind: "boolean"; defaultValue: boolean })
  | (FieldBase & { kind: "multiselect"; options: UiFormOption[]; custom: boolean; defaultValue: string[] })
  | (FieldBase & { kind: "external"; url: string })

export type UiForm = { id: string; sessionID: string; title: string; fields: UiFormField[] }

type FormFieldLike = {
  key: string
  type: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  options?: readonly UiFormOption[]
  custom?: boolean
  default?: unknown
  placeholder?: string
  url?: string
}

type FormLike = { id: string; sessionID: string; title: string; fields: readonly FormFieldLike[] }

const toField = (field: FormFieldLike): UiFormField | undefined => {
  const base: FieldBase = {
    key: field.key,
    title: field.title ?? field.key,
    required: field.required ?? false,
    ...(field.description ? { description: field.description } : {}),
  }
  const fallback = field.default
  switch (field.type) {
    case "string":
      if (field.options?.length) {
        return {
          ...base,
          kind: "choice",
          options: [...field.options],
          custom: field.custom ?? false,
          ...(typeof fallback === "string" ? { defaultValue: fallback } : {}),
        }
      }
      return {
        ...base,
        kind: "text",
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(typeof fallback === "string" ? { defaultValue: fallback } : {}),
      }
    case "number":
    case "integer":
      return {
        ...base,
        kind: "number",
        integer: field.type === "integer",
        ...(typeof fallback === "number" ? { defaultValue: fallback } : {}),
      }
    case "boolean":
      return { ...base, kind: "boolean", defaultValue: fallback === true }
    case "multiselect":
      return {
        ...base,
        kind: "multiselect",
        options: [...(field.options ?? [])],
        custom: field.custom ?? false,
        defaultValue: Array.isArray(fallback) ? fallback.filter((value): value is string => typeof value === "string") : [],
      }
    case "external":
      return field.url ? { ...base, kind: "external", url: field.url } : undefined
    default:
      return undefined
  }
}

export function toUiForm(form: FormLike): UiForm {
  return {
    id: form.id,
    sessionID: form.sessionID,
    title: form.title,
    fields: form.fields.filter((field) => !field.hidden).flatMap((field) => toField(field) ?? []),
  }
}

export function initialAnswer(form: UiForm): Record<string, FormAnswerValue> {
  const answer: Record<string, FormAnswerValue> = {}
  for (const field of form.fields) {
    if (field.kind === "boolean" || field.kind === "multiselect") answer[field.key] = field.defaultValue
    else if (field.kind !== "external" && field.defaultValue !== undefined) answer[field.key] = field.defaultValue
  }
  return answer
}

export function missingFields(form: UiForm, answer: Readonly<Record<string, FormAnswerValue>>): string[] {
  return form.fields
    .filter((field) => {
      if (!field.required || field.kind === "external" || field.kind === "boolean") return false
      const value = answer[field.key]
      if (value === undefined) return true
      if (typeof value === "string") return value.trim() === ""
      if (Array.isArray(value)) return value.length === 0
      return false
    })
    .map((field) => field.title)
}
