// Token and cost figures for the composer bar.

export type TokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

// Tokens a step put through the model: roughly how full the context window is
// going into the next turn.
export function contextTokens(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(cost < 1 ? 3 : 2)}`
}

export type UsageSummary = {
  label: string
  detail: string
  // Share of the context window in use, 0 to 1, when known.
  fill?: number
}

export function summarizeUsage(input: {
  totals?: { tokens: TokenUsage; cost: number }
  lastContext?: number
  contextLimit?: number
}): UsageSummary | undefined {
  const { totals, lastContext, contextLimit } = input
  const parts: string[] = []
  const details: string[] = []
  let fill: number | undefined

  if (lastContext !== undefined && contextLimit) {
    fill = Math.min(lastContext / contextLimit, 1)
    parts.push(`${Math.round(fill * 100)}%`)
    details.push(`Context: ${formatTokens(lastContext)} of ${formatTokens(contextLimit)} tokens`)
  } else if (lastContext !== undefined) {
    parts.push(formatTokens(lastContext))
    details.push(`Context: ${formatTokens(lastContext)} tokens`)
  }

  if (totals) {
    const { tokens, cost } = totals
    const total = contextTokens(tokens)
    if (total > 0) {
      const cached = tokens.cache.read + tokens.cache.write
      details.push(
        `Session: ${formatTokens(tokens.input)} in, ${formatTokens(tokens.output + tokens.reasoning)} out` +
          (cached ? `, ${formatTokens(cached)} cached` : ""),
      )
    }
    if (cost > 0) {
      parts.push(formatCost(cost))
      details.push(`Cost: ${formatCost(cost)}`)
    }
  }

  if (!parts.length) return undefined
  return { label: parts.join(" · "), detail: details.join("\n"), ...(fill !== undefined ? { fill } : {}) }
}
