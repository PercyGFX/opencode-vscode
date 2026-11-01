import MarkdownIt from "markdown-it"

// html: false escapes raw HTML in model output, so nothing it writes can run
// as markup in the webview.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

export function renderMarkdown(text: string): string {
  return md.render(text)
}
