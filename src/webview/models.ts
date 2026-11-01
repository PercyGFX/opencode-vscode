import type { ModelInfo } from "@opencode/client"
import type { Bootstrap, ModelChoice } from "../shared/protocol.ts"

export type ModelRefLike = { id: string; providerID: string; variant?: string }

export type ResolvedModel = {
  info?: ModelInfo
  variant?: string
  // True when the session hasn't picked a model and uses OpenCode's default.
  isDefault: boolean
}

export function modelKey(model: { providerID: string; id: string }): string {
  return `${model.providerID}/${model.id}`
}

export function findModel(models: readonly ModelInfo[], ref: ModelRefLike): ModelInfo | undefined {
  return models.find((model) => model.providerID === ref.providerID && (model.id === ref.id || model.modelID === ref.id))
}

export function resolveModel(bootstrap: Bootstrap | undefined, ref: ModelRefLike | undefined): ResolvedModel {
  const models = bootstrap?.models ?? []
  if (ref) {
    const info = findModel(models, ref)
    return { ...(info ? { info } : {}), ...(ref.variant ? { variant: ref.variant } : {}), isDefault: false }
  }
  const fallback = bootstrap?.defaultModel
  return fallback ? { info: fallback, isDefault: true } : { isDefault: true }
}

// A remembered model is only reused while the server still offers it.
export function usableChoice(models: readonly ModelInfo[], choice: ModelChoice | null | undefined): ModelChoice | undefined {
  if (!choice) return undefined
  const model = findModel(models, choice)
  if (!model) return undefined
  const variant = choice.variant && model.variants.some((entry) => entry.id === choice.variant) ? choice.variant : undefined
  return toChoice(model, variant)
}

export function toChoice(model: ModelInfo, variant?: string): ModelChoice {
  return variant ? { providerID: model.providerID, id: model.id, variant } : { providerID: model.providerID, id: model.id }
}

export function variantLabel(variant: string): string {
  const named: Record<string, string> = { xhigh: "Extra high", max: "Max", none: "None" }
  return named[variant] ?? variant.charAt(0).toUpperCase() + variant.slice(1)
}

// Every word of the query has to appear in the model's name, ID or provider.
export function filterModels(models: readonly ModelInfo[], query: string): ModelInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...models]
  return models.filter((model) => {
    const haystack = `${model.name} ${model.id} ${model.providerID}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  return `${Math.round(tokens / 1000)}k`
}

export function groupByProvider(models: readonly ModelInfo[]): Array<[string, ModelInfo[]]> {
  const groups = new Map<string, ModelInfo[]>()
  for (const model of models) {
    const group = groups.get(model.providerID) ?? []
    group.push(model)
    groups.set(model.providerID, group)
  }
  return [...groups.entries()]
}
