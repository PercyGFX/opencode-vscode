import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import go from "highlight.js/lib/languages/go"
import ini from "highlight.js/lib/languages/ini"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import kotlin from "highlight.js/lib/languages/kotlin"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import powershell from "highlight.js/lib/languages/powershell"
import python from "highlight.js/lib/languages/python"
import ruby from "highlight.js/lib/languages/ruby"
import rust from "highlight.js/lib/languages/rust"
import scss from "highlight.js/lib/languages/scss"
import shell from "highlight.js/lib/languages/shell"
import sql from "highlight.js/lib/languages/sql"
import swift from "highlight.js/lib/languages/swift"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import MarkdownIt from "markdown-it"

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  powershell,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language)

// html: false escapes raw HTML in model output, so nothing it writes can run
// as markup in the webview.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

const highlight = (code: string, language: string): string => {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      // Fall through to plain text if the grammar chokes.
    }
  }
  return md.utils.escapeHtml(code)
}

// Fenced code: a header with the language and a copy button, then the
// highlighted code. The copy button is wired up by the Markdown component.
md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  if (!token) return ""
  const language = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  const label = language ? md.utils.escapeHtml(language) : "text"
  return (
    `<div class="code-block">` +
    `<div class="code-header"><span class="code-language">${label}</span>` +
    `<button class="code-copy" type="button" title="Copy code"><i class="codicon codicon-copy"></i><span>Copy</span></button></div>` +
    `<pre><code class="hljs">${highlight(token.content.replace(/\n$/, ""), language)}</code></pre>` +
    `</div>`
  )
}

export function renderMarkdown(text: string): string {
  return md.render(text)
}
