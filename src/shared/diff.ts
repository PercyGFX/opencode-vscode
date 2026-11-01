// Unified diffs that OpenCode attaches to edit permissions and edit tool
// results: parsing for display, and applying a patch to show the proposed file.

export type FileDiffStatus = "added" | "deleted" | "modified"

export type FileDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: FileDiffStatus
}

export type DiffLine = { kind: "hunk" | "add" | "del" | "ctx"; text: string }

type Hunk = { oldStart: number; oldLines: number; lines: DiffLine[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const isHeader = (line: string) =>
  line.startsWith("Index: ") || line.startsWith("===") || line.startsWith("--- ") || line.startsWith("+++ ")

// Display lines, without the file headers.
export function diffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const line of patch.split(/\r?\n/)) {
    if (isHeader(line) || line.startsWith("\\")) continue
    if (line.startsWith("@@")) lines.push({ kind: "hunk", text: line })
    else if (line.startsWith("+")) lines.push({ kind: "add", text: line.slice(1) })
    else if (line.startsWith("-")) lines.push({ kind: "del", text: line.slice(1) })
    else if (line.startsWith(" ")) lines.push({ kind: "ctx", text: line.slice(1) })
  }
  // A trailing empty context line comes from the patch's final newline.
  while (lines.at(-1)?.kind === "ctx" && lines.at(-1)?.text === "") lines.pop()
  return lines
}

const countLines = (patch: string) => {
  const lines = diffLines(patch)
  return {
    additions: lines.filter((line) => line.kind === "add").length,
    deletions: lines.filter((line) => line.kind === "del").length,
  }
}

const toFileDiff = (value: unknown): FileDiff[] => {
  if (!isRecord(value) || typeof value.file !== "string" || typeof value.patch !== "string") return []
  const counted = countLines(value.patch)
  const status = value.status === "added" || value.status === "deleted" ? value.status : "modified"
  return [
    {
      file: value.file,
      patch: value.patch,
      additions: typeof value.additions === "number" ? value.additions : counted.additions,
      deletions: typeof value.deletions === "number" ? value.deletions : counted.deletions,
      status,
    },
  ]
}

// The edit and write tools send { files: FileDiff[] }; the patch tool sends
// { filepath, diff } with one unified diff for every file it touches.
export function readFileDiffs(metadata: unknown): FileDiff[] {
  if (!isRecord(metadata)) return []
  if (Array.isArray(metadata.files)) return metadata.files.flatMap(toFileDiff)
  if (typeof metadata.diff === "string" && metadata.diff.trim()) {
    const file = typeof metadata.filepath === "string" ? metadata.filepath : "changes"
    return [{ file, patch: metadata.diff, ...countLines(metadata.diff), status: "modified" }]
  }
  return []
}

const parseHunks = (patch: string): Hunk[] => {
  const hunks: Hunk[] = []
  let current: Hunk | undefined
  for (const line of patch.split(/\r?\n/)) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line)
    if (header) {
      current = { oldStart: Number(header[1]), oldLines: header[2] === undefined ? 1 : Number(header[2]), lines: [] }
      hunks.push(current)
      continue
    }
    if (!current || isHeader(line) || line.startsWith("\\")) continue
    if (line.startsWith("+")) current.lines.push({ kind: "add", text: line.slice(1) })
    else if (line.startsWith("-")) current.lines.push({ kind: "del", text: line.slice(1) })
    else if (line.startsWith(" ")) current.lines.push({ kind: "ctx", text: line.slice(1) })
  }
  return hunks
}

const matchesAt = (source: readonly string[], expected: readonly string[], at: number) =>
  expected.every((line, offset) => source[at + offset] === line)

// Where a hunk's old lines sit: at the stated line, or the nearest match
// after the previous hunk if the file shifted a little.
const findHunk = (source: readonly string[], expected: readonly string[], preferred: number, minimum: number) => {
  const start = Math.max(preferred, minimum)
  if (matchesAt(source, expected, start)) return start
  for (let distance = 1; distance <= source.length; distance += 1) {
    for (const at of [start - distance, start + distance]) {
      if (at >= minimum && at + expected.length <= source.length && matchesAt(source, expected, at)) return at
    }
  }
  return undefined
}

// Returns the patched file, or undefined if the patch no longer fits.
export function applyPatch(original: string, patch: string): string | undefined {
  const hunks = parseHunks(patch)
  if (!hunks.length) return undefined
  const eol = original.includes("\r\n") ? "\r\n" : "\n"
  const source = original.split(/\r?\n/)
  const output: string[] = []
  let cursor = 0
  for (const hunk of hunks) {
    const expected = hunk.lines.filter((line) => line.kind !== "add").map((line) => line.text)
    // An insert-only hunk ("-n,0") goes after line n; others start at line n.
    const preferred = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1
    const at = findHunk(source, expected, preferred, cursor)
    if (at === undefined) return undefined
    output.push(...source.slice(cursor, at))
    for (const line of hunk.lines) if (line.kind !== "del") output.push(line.text)
    cursor = at + expected.length
  }
  output.push(...source.slice(cursor))
  return output.join(eol)
}
