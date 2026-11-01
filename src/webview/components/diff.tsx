import { useMemo } from "preact/hooks"
import { diffLines, type FileDiff } from "../../shared/diff.ts"
import { Icon } from "./icon.tsx"

const LINE_LIMIT = 400

const STATUS_ICONS: Record<FileDiff["status"], string> = {
  added: "diff-added",
  deleted: "diff-removed",
  modified: "diff-modified",
}

const PREFIX: Record<"add" | "del" | "ctx", string> = { add: "+", del: "-", ctx: " " }

type DiffViewProps = {
  diff: FileDiff
  onOpen?: () => void
}

export function DiffView({ diff, onOpen }: DiffViewProps) {
  const lines = useMemo(() => diffLines(diff.patch), [diff.patch])
  const shown = lines.slice(0, LINE_LIMIT)

  return (
    <div class="diff">
      <div class="diff-header">
        <Icon name={STATUS_ICONS[diff.status]} />
        <span class="diff-file" title={diff.file}>
          {diff.file}
        </span>
        <span class="diff-stats">
          <span class="diff-additions">+{diff.additions}</span>
          <span class="diff-deletions">-{diff.deletions}</span>
        </span>
        {onOpen ? (
          <button class="link-button" title="Open in VS Code's diff editor" onClick={onOpen}>
            Open diff
          </button>
        ) : null}
      </div>
      <div class="diff-body">
        {shown.map((line, index) =>
          line.kind === "hunk" ? (
            <div key={index} class="diff-line hunk">
              {line.text}
            </div>
          ) : (
            <div key={index} class={`diff-line ${line.kind}`}>
              <span class="diff-prefix">{PREFIX[line.kind]}</span>
              {line.text}
            </div>
          ),
        )}
        {lines.length > shown.length ? (
          <div class="diff-line hunk">… {lines.length - shown.length} more lines</div>
        ) : null}
      </div>
    </div>
  )
}
