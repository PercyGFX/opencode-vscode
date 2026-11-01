import { basename, isAbsolute, join } from "node:path"
import * as vscode from "vscode"
import { applyPatch, type FileDiffStatus } from "../shared/diff.ts"

export const DIFF_SCHEME = "opencode-diff"

export type DiffRequest = {
  file: string
  patch: string
  status: FileDiffStatus
  // Set while the edit waits for approval, so the diff editor can accept or reject it.
  sessionID?: string
  requestID?: string
}

// Serves OpenCode's proposed file contents to VS Code's diff editor.
export class DiffDocuments implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>()
  private counter = 0

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? ""
  }

  create(name: string, content: string, query: Record<string, string>): vscode.Uri {
    this.counter += 1
    const params = new URLSearchParams({ ...query, n: String(this.counter) })
    const uri = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${name}`, query: params.toString() })
    this.contents.set(uri.toString(), content)
    return uri
  }
}

export function pendingRequest(uri: vscode.Uri | undefined): { sessionID: string; requestID: string } | undefined {
  if (uri?.scheme !== DIFF_SCHEME) return undefined
  const params = new URLSearchParams(uri.query)
  const sessionID = params.get("session")
  const requestID = params.get("request")
  return sessionID && requestID ? { sessionID, requestID } : undefined
}

const readText = async (uri: vscode.Uri): Promise<string | undefined> => {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
  } catch {
    return undefined
  }
}

export async function openDiff(documents: DiffDocuments, root: string | undefined, request: DiffRequest): Promise<void> {
  const absolute = isAbsolute(request.file) || !root ? request.file : join(root, request.file)
  const fileUri = vscode.Uri.file(absolute)
  const name = basename(request.file)
  const original = request.status === "added" ? "" : await readText(fileUri)
  const proposed = request.status === "deleted" ? "" : applyPatch(original ?? "", request.patch)

  // The file changed since OpenCode wrote the patch: show the patch itself.
  if (proposed === undefined) {
    const document = await vscode.workspace.openTextDocument({ content: request.patch, language: "diff" })
    await vscode.window.showTextDocument(document, { preview: true })
    return
  }

  const pending: Record<string, string> =
    request.sessionID && request.requestID ? { session: request.sessionID, request: request.requestID } : {}
  const left = original === undefined || request.status === "added" ? documents.create(name, "", {}) : fileUri
  const right = documents.create(name, proposed, pending)
  await vscode.commands.executeCommand("vscode.diff", left, right, `${name} ↔ OpenCode's change`, { preview: true })
}
