import { describe, expect, it } from "vitest"
import { renderMarkdown } from "./markdown.ts"

describe("renderMarkdown", () => {
  it("renders fenced code with a language header, copy button and highlighting", () => {
    const html = renderMarkdown("```ts\nconst a = 1\n```")
    expect(html).toContain('<div class="code-block">')
    expect(html).toContain('<span class="code-language">ts</span>')
    expect(html).toContain('class="code-copy"')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
  })

  it("escapes code in languages it doesn't know", () => {
    const html = renderMarkdown("```madeup\n<script>alert(1)</script>\n```")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
  })

  it("escapes raw HTML in text", () => {
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).not.toContain("<img")
  })
})
