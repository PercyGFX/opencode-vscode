import { describe, expect, it } from "vitest"
import { browserActivity, browserPageLabel } from "./browser.ts"
import type { UiMessage, UiToolPart } from "./messages.ts"

const assistant = (...parts: UiToolPart[]): UiMessage => ({
  kind: "assistant",
  id: `msg_${parts.length}_${Math.random()}`,
  agent: "build",
  created: 1,
  parts,
  keys: {},
  done: true,
})

const execute = (code: string, output: string, status: UiToolPart["status"] = "completed"): UiToolPart => ({
  kind: "tool",
  id: `call_${Math.random()}`,
  name: "execute",
  status,
  input: { code },
  output,
})

// Real output from the Playwright MCP, run through OpenCode's code tool.
const navigateOutput = `### Ran Playwright code
\`\`\`js
await page.goto('https://www.google.com');
\`\`\`
### Page
- Page URL: https://www.google.com/
- Page Title: Google
- Console: 13 errors, 0 warnings`

describe("browserActivity", () => {
  it("reads the page, title and console from Playwright output", () => {
    const activity = browserActivity([
      assistant(
        execute(
          'const nav = await tools.playwright.browser_navigate({ url: "https://www.google.com" });\nconst snap = await tools.playwright.browser_snapshot({});',
          navigateOutput,
        ),
      ),
    ])
    expect(activity).toMatchObject({
      server: "playwright",
      url: "https://www.google.com/",
      title: "Google",
      console: "13 errors, 0 warnings",
      running: false,
    })
    expect(activity?.actions.map((action) => action.label)).toEqual(["Opened www.google.com", "Read the page"])
    expect(browserPageLabel(activity!)).toBe("Google")
  })

  it("follows Chrome DevTools' selected page and keeps a running action", () => {
    const activity = browserActivity([
      assistant(
        execute(
          'const requests = await tools["chrome-devtools"].list_network_requests({})',
          "## Pages\n0: https://example.com/ \n1: https://app.local/dashboard [selected]",
          "running",
        ),
      ),
    ])
    expect(activity).toMatchObject({ server: "chrome-devtools", url: "https://app.local/dashboard", running: true })
    expect(activity?.actions).toEqual([{ label: "Read network requests", running: true }])
  })

  it("ignores tool discovery and unrelated tools", () => {
    expect(
      browserActivity([
        assistant(
          execute('const res = search({ namespace: "playwright" });', "{}"),
          { kind: "tool", id: "c", name: "read", status: "completed", input: { filePath: "a.ts" }, output: "" },
        ),
      ]),
    ).toBeUndefined()
  })

  it("drops the old title when the browser moves to a new page", () => {
    const activity = browserActivity([
      assistant(execute('await tools.playwright.browser_navigate({ url: "https://www.google.com" })', navigateOutput)),
      assistant(execute('await tools.playwright.browser_navigate({ url: "https://github.com" })', "")),
    ])
    expect(activity?.url).toBe("https://github.com")
    expect(activity?.title).toBeUndefined()
    expect(browserPageLabel(activity!)).toBe("github.com")
  })
})
