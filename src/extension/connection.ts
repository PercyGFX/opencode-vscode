import * as vscode from "vscode"
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import { Service, type Endpoint } from "@opencode/client/service"
import type { ConnectionState } from "../shared/protocol.ts"
import { errorMessage } from "./errors.ts"
import { resolveOpencodeCommand } from "./paths.ts"

const MIN_RETRY_MS = 1_000
const MAX_RETRY_MS = 15_000
const MAX_RETRIES = 8

// Connects to the OpenCode 2 background server, the same one the TUI uses, so
// sessions, messages and permission prompts stay in sync across clients.
export class Connection implements vscode.Disposable {
  private client: OpenCodeClient | undefined
  private opening: Promise<OpenCodeClient> | undefined
  private stream: AbortController | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retries = 0
  private disposed = false
  private state: ConnectionState = { status: "connecting" }
  private readonly stateEmitter = new vscode.EventEmitter<ConnectionState>()
  private readonly eventEmitter = new vscode.EventEmitter<OpenCodeEvent>()

  readonly onDidChangeState = this.stateEmitter.event
  readonly onEvent = this.eventEmitter.event

  constructor(private readonly log: vscode.LogOutputChannel) {}

  get currentState(): ConnectionState {
    return this.state
  }

  getClient(): Promise<OpenCodeClient> {
    return this.client ? Promise.resolve(this.client) : this.connect()
  }

  connect(): Promise<OpenCodeClient> {
    if (this.client) return Promise.resolve(this.client)
    this.opening ??= this.open().finally(() => {
      this.opening = undefined
    })
    return this.opening
  }

  reconnect(): Promise<OpenCodeClient> {
    this.close()
    this.retries = 0
    return this.connect()
  }

  dispose(): void {
    this.disposed = true
    this.close()
    this.stateEmitter.dispose()
    this.eventEmitter.dispose()
  }

  private close() {
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.stream?.abort()
    this.stream = undefined
    this.client = undefined
  }

  private setState(state: ConnectionState) {
    this.state = state
    if (!this.disposed) this.stateEmitter.fire(state)
  }

  private async open(): Promise<OpenCodeClient> {
    this.setState({ status: "connecting" })
    try {
      const endpoint = await this.findEndpoint()
      const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
      const info = await client.server.info()
      if (this.disposed) throw new Error("The extension is shutting down")
      this.client = client
      this.retries = 0
      this.log.info(`Connected to OpenCode ${info.version} at ${endpoint.url}`)
      this.setState({ status: "connected", url: endpoint.url, version: info.version })
      this.listen(client)
      return client
    } catch (error) {
      const message = errorMessage(error)
      this.log.error(`Could not connect to OpenCode: ${message}`)
      this.setState({ status: "error", message })
      throw error
    }
  }

  private async findEndpoint(): Promise<Endpoint> {
    const config = vscode.workspace.getConfiguration("opencode")
    const serverUrl = config.get<string>("serverUrl", "").trim()
    if (serverUrl) return { url: serverUrl }

    const running = await Service.discover()
    if (running) return running

    const command = resolveOpencodeCommand(config.get<string>("path", ""))
    this.log.info(`Starting the OpenCode background server: ${command} serve --service`)
    this.setState({ status: "connecting", detail: "Starting the OpenCode server…" })
    return Service.ensure({ command: [command, "serve", "--service"] })
  }

  private listen(client: OpenCodeClient) {
    const controller = new AbortController()
    this.stream = controller
    void (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: controller.signal })) {
          this.eventEmitter.fire(event)
        }
        if (!controller.signal.aborted) this.log.warn("The OpenCode event stream ended")
      } catch (error) {
        if (!controller.signal.aborted) this.log.warn(`The OpenCode event stream failed: ${errorMessage(error)}`)
      }
      if (!controller.signal.aborted && !this.disposed) this.scheduleRetry()
    })()
  }

  // The server can restart (an upgrade, `opencode service restart`), so look
  // it up again on each attempt instead of reusing the old URL.
  private scheduleRetry() {
    this.close()
    if (this.retries >= MAX_RETRIES) {
      this.setState({ status: "error", message: "Lost the connection to the OpenCode server" })
      return
    }
    const delay = Math.min(MIN_RETRY_MS * 2 ** this.retries, MAX_RETRY_MS)
    this.retries += 1
    this.setState({ status: "connecting", detail: "Reconnecting…" })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.connect().catch(() => this.scheduleRetry())
    }, delay)
  }
}
