import { randomBytes } from "node:crypto"
import * as vscode from "vscode"
import type { OpenCodeEvent } from "@opencode/client"
import type { ActiveFile, HostToWebview, RequestMethod, WebviewToHost } from "../shared/protocol.ts"
import type { Connection } from "./connection.ts"
import { errorMessage } from "./errors.ts"
import type { Handlers } from "./handlers.ts"

// Event types the chat UI reacts to. The webview ignores events for sessions
// it hasn't loaded, so these aren't filtered by project.
const FORWARDED_PREFIXES = ["session.", "permission.", "form."]
const FORWARDED_TYPES = new Set([
  "server.connected",
  "agent.updated",
  "command.updated",
  "model.updated",
  "provider.updated",
  "config.updated",
  "integration.updated",
  "credential.switched",
  "mcp.status.changed",
  "plugin.updated",
  "skill.updated",
])

const isForwarded = (event: OpenCodeEvent) =>
  FORWARDED_TYPES.has(event.type) || FORWARDED_PREFIXES.some((prefix) => event.type.startsWith(prefix))

export type ChatHostOptions = {
  extensionUri: vscode.Uri
  connection: Connection
  handlers: Handlers
  activeFile: () => ActiveFile
  log: vscode.LogOutputChannel
}

// One webview that shows the chat: the side bar view or an editor tab.
class ChatSurface implements vscode.Disposable {
  private ready = false
  private readonly queued: HostToWebview[] = []
  private readonly subscription: vscode.Disposable

  constructor(
    readonly webview: vscode.Webview,
    onMessage: (surface: ChatSurface, message: WebviewToHost) => void,
  ) {
    this.subscription = webview.onDidReceiveMessage((message: WebviewToHost) => onMessage(this, message))
  }

  markReady(initial: HostToWebview[]) {
    this.ready = true
    for (const message of [...initial, ...this.queued.splice(0)]) void this.webview.postMessage(message)
  }

  post(message: HostToWebview, queueUntilReady = false) {
    if (this.ready) void this.webview.postMessage(message)
    else if (queueUntilReady) this.queued.push(message)
  }

  dispose() {
    this.subscription.dispose()
  }
}

export class ChatHost implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "opencode.chat"
  static readonly panelType = "opencode.chatTab"

  private readonly surfaces = new Set<ChatSurface>()
  private sidebar: ChatSurface | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly dist: vscode.Uri

  constructor(private readonly options: ChatHostOptions) {
    this.dist = vscode.Uri.joinPath(options.extensionUri, "dist")
    this.disposables.push(
      options.connection.onDidChangeState((state) => this.broadcast({ type: "connection", state })),
      options.connection.onEvent((event) => {
        if (isForwarded(event)) this.broadcast({ type: "event", event })
      }),
    )
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.dist] }
    const surface = this.attach(view.webview)
    this.sidebar = surface
    view.onDidDispose(() => {
      this.detach(surface)
      if (this.sidebar === surface) this.sidebar = undefined
    })
  }

  openInTab(): void {
    const panel = vscode.window.createWebviewPanel(ChatHost.panelType, "OpenCode", vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.dist],
    })
    panel.iconPath = vscode.Uri.joinPath(this.options.extensionUri, "media", "opencode.svg")
    const surface = this.attach(panel.webview)
    panel.onDidDispose(() => this.detach(surface))
  }

  // Shows the side bar chat, opening the secondary side bar if it's hidden.
  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${ChatHost.viewType}.focus`)
  }

  async newSession(): Promise<void> {
    await this.reveal()
    this.sidebar?.post({ type: "command", command: "newSession" }, true)
  }

  postActiveFile(): void {
    this.broadcast({ type: "activeFile", file: this.options.activeFile() })
  }

  dispose(): void {
    for (const surface of this.surfaces) surface.dispose()
    this.surfaces.clear()
    vscode.Disposable.from(...this.disposables).dispose()
  }

  private attach(webview: vscode.Webview): ChatSurface {
    const surface = new ChatSurface(webview, (from, message) => void this.receive(from, message))
    webview.html = renderHtml(webview, this.dist)
    this.surfaces.add(surface)
    return surface
  }

  private detach(surface: ChatSurface) {
    surface.dispose()
    this.surfaces.delete(surface)
  }

  private broadcast(message: HostToWebview) {
    for (const surface of this.surfaces) surface.post(message)
  }

  private async receive(surface: ChatSurface, message: WebviewToHost) {
    if (message.type === "ready") {
      surface.markReady([
        { type: "connection", state: this.options.connection.currentState },
        { type: "activeFile", file: this.options.activeFile() },
      ])
      this.options.connection.connect().catch(() => undefined)
      return
    }
    if (message.type !== "request") return

    const { handlers, log } = this.options
    if (!Object.hasOwn(handlers, message.method)) {
      surface.post({ type: "response", id: message.id, ok: false, error: `Unknown request: ${message.method}` })
      return
    }
    try {
      const handler = handlers[message.method as RequestMethod] as (params: unknown) => Promise<unknown>
      const result = await handler(message.params)
      surface.post({ type: "response", id: message.id, ok: true, result })
    } catch (error) {
      const text = errorMessage(error)
      log.error(`${message.method} failed: ${text}`)
      surface.post({ type: "response", id: message.id, ok: false, error: text })
    }
  }
}

function renderHtml(webview: vscode.Webview, dist: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64")
  const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.js"))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.css"))
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ")
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
  <title>OpenCode</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}
