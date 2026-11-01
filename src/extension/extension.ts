import { isAbsolute, join } from "node:path"
import * as vscode from "vscode"
import { DEFAULT_AUTO_ASK_PATTERNS, isModeId } from "../shared/modes.ts"
import type { ActiveFile, ModelChoice } from "../shared/protocol.ts"
import { ChatHost } from "./chat-host.ts"
import { Connection } from "./connection.ts"
import { DIFF_SCHEME, DiffDocuments, openDiff, pendingRequest } from "./diff-view.ts"
import { errorMessage } from "./errors.ts"
import { createHandlers, type Settings } from "./handlers.ts"
import { serverDirectory } from "./paths.ts"

const LAST_MODEL_KEY = "opencode.lastModel"
const LAST_MODE_KEY = "opencode.lastMode"

const readModelChoice = (value: unknown): ModelChoice | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const { providerID, id, variant } = value as Record<string, unknown>
  if (typeof providerID !== "string" || typeof id !== "string") return undefined
  return typeof variant === "string" ? { providerID, id, variant } : { providerID, id }
}

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("OpenCode", { log: true })
  const connection = new Connection(log)
  const diffDocuments = new DiffDocuments()

  const directory = () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    return folder ? serverDirectory(folder.uri.fsPath) : undefined
  }

  const activeFile = (): ActiveFile => {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.uri.scheme !== "file") return undefined
    const path = editor.document.uri.fsPath
    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false)
    const { selection } = editor
    if (selection.isEmpty) return { path, relativePath }
    return { path, relativePath, selection: { startLine: selection.start.line + 1, endLine: selection.end.line + 1 } }
  }

  const settings = (): Settings => {
    const config = vscode.workspace.getConfiguration("opencode")
    const mode = config.get<string>("defaultMode")
    return {
      defaultMode: isModeId(mode) ? mode : "manual",
      autoAskPatterns: config.get<string[]>("autoModeAskPatterns", [...DEFAULT_AUTO_ASK_PATTERNS]),
    }
  }

  const handlers = createHandlers({
    client: () => connection.getClient(),
    directory,
    activeFile,
    settings,
    openFile: async (path) => {
      const root = directory()
      const absolute = isAbsolute(path) || !root ? path : join(root, path)
      await vscode.window.showTextDocument(vscode.Uri.file(absolute), { preview: true })
    },
    openDiff: (request) => openDiff(diffDocuments, directory(), request),
    reconnect: async () => {
      await connection.reconnect()
    },
    lastModel: () => readModelChoice(context.globalState.get(LAST_MODEL_KEY)),
    lastMode: () => {
      const mode = context.globalState.get(LAST_MODE_KEY)
      return isModeId(mode) ? mode : undefined
    },
    remember: async ({ model, mode }) => {
      if (model) await context.globalState.update(LAST_MODEL_KEY, model)
      if (mode) await context.globalState.update(LAST_MODE_KEY, mode)
    },
  })

  const host = new ChatHost({ extensionUri: context.extensionUri, connection, handlers, activeFile, log })

  // Accept or reject an edit from the diff editor's title bar.
  const answerDiff = async (decision: "once" | "reject", uri?: vscode.Uri) => {
    const pending = pendingRequest(uri ?? vscode.window.activeTextEditor?.document.uri)
    if (!pending) return
    try {
      await handlers.replyPermission({ ...pending, decision })
    } catch (error) {
      log.warn(`Could not answer the edit: ${errorMessage(error)}`)
      void vscode.window.showWarningMessage("This change was already answered or has expired.")
    }
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
  }

  let selectionTimer: ReturnType<typeof setTimeout> | undefined
  context.subscriptions.push(
    log,
    connection,
    host,
    vscode.window.registerWebviewViewProvider(ChatHost.viewType, host, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("opencode.open", () => host.reveal()),
    vscode.commands.registerCommand("opencode.newSession", () => host.newSession()),
    vscode.commands.registerCommand("opencode.manage", () => host.showExtensions()),
    vscode.commands.registerCommand("opencode.openInTab", () => host.openInTab()),
    vscode.commands.registerCommand("opencode.reconnect", () => connection.reconnect().catch(() => undefined)),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffDocuments),
    vscode.commands.registerCommand("opencode.acceptDiff", (uri?: vscode.Uri) => answerDiff("once", uri)),
    vscode.commands.registerCommand("opencode.rejectDiff", (uri?: vscode.Uri) => answerDiff("reject", uri)),
    vscode.window.onDidChangeActiveTextEditor(() => host.postActiveFile()),
    vscode.window.onDidChangeTextEditorSelection(() => {
      clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => host.postActiveFile(), 150)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("opencode.serverUrl") || event.affectsConfiguration("opencode.path")) {
        connection.reconnect().catch(() => undefined)
      }
    }),
    { dispose: () => clearTimeout(selectionTimer) },
  )
}

export function deactivate(): void {}
