import { describe, expect, it } from "vitest"
import type { ModelInfo } from "@opencode/client"
import { filterModels, formatContext } from "./models.ts"
import { contextTokens, formatCost, formatTokens, summarizeUsage } from "./usage.ts"

describe("filterModels", () => {
  const model = (id: string, name: string, providerID: string) => ({ id, name, providerID }) as ModelInfo
  const models = [
    model("gemini-3.8-flash", "Gemini 3.8 Flash", "google-antigravity"),
    model("claude-sonnet-5-5", "Claude Sonnet 5.5", "google-antigravity"),
    model("openai/gpt-6.1-terra", "GPT 6.1 Terra", "openrouter"),
  ]

  it("matches every word against name, ID and provider", () => {
    expect(filterModels(models, "gemini flash").map((entry) => entry.id)).toEqual(["gemini-3.8-flash"])
    expect(filterModels(models, "antigravity").length).toBe(2)
    expect(filterModels(models, "OPENROUTER terra").map((entry) => entry.id)).toEqual(["openai/gpt-6.1-terra"])
  })

  it("returns everything for an empty query", () => {
    expect(filterModels(models, "  ").length).toBe(3)
  })
})

describe("formatContext", () => {
  it("shows context windows compactly", () => {
    expect(formatContext(200_000)).toBe("200k")
    expect(formatContext(1_048_576)).toBe("1M")
  })
})

const tokens = (input: number, output: number, read = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read, write: 0 },
})

describe("formatTokens", () => {
  it("abbreviates large counts", () => {
    expect(formatTokens(950)).toBe("950")
    expect(formatTokens(1234)).toBe("1.2k")
    expect(formatTokens(45_600)).toBe("46k")
    expect(formatTokens(2_500_000)).toBe("2.5M")
  })
})

describe("formatCost", () => {
  it("shows more precision below a dollar", () => {
    expect(formatCost(0.0123)).toBe("$0.012")
    expect(formatCost(3.456)).toBe("$3.46")
  })
})

describe("contextTokens", () => {
  it("adds every kind of token a step used", () => {
    expect(contextTokens({ input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 3 } })).toBe(120)
  })
})

describe("summarizeUsage", () => {
  it("shows context fill and cost", () => {
    const summary = summarizeUsage({ totals: { tokens: tokens(5000, 1000), cost: 0.25 }, lastContext: 50_000, contextLimit: 200_000 })
    expect(summary?.label).toBe("25% · $0.250")
    expect(summary?.fill).toBe(0.25)
    expect(summary?.detail).toContain("Context: 50k of 200k tokens")
    expect(summary?.detail).toContain("Session: 5.0k in, 1.0k out")
  })

  it("hides the cost when the provider reports none", () => {
    const summary = summarizeUsage({ totals: { tokens: tokens(5000, 1000), cost: 0 }, lastContext: 1000, contextLimit: 100_000 })
    expect(summary?.label).toBe("1%")
  })

  it("shows raw tokens when the context limit is unknown", () => {
    expect(summarizeUsage({ lastContext: 12_000 })?.label).toBe("12k")
  })

  it("shows nothing for a session with no usage yet", () => {
    expect(summarizeUsage({ totals: { tokens: tokens(0, 0), cost: 0 } })).toBeUndefined()
  })
})
