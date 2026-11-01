import { useState } from "preact/hooks"
import { browserPageLabel, type BrowserActivity } from "../browser.ts"
import { Icon } from "./icon.tsx"

type BrowserStripProps = {
  activity: BrowserActivity
  // Whether the browser's MCP server is connected right now.
  connected: boolean
}

// Shows what the agent's browser is on and doing, like Claude Code's
// "Browser connected" bar. Expands to list recent browser actions.
export function BrowserStrip({ activity, connected }: BrowserStripProps) {
  const [open, setOpen] = useState(false)
  const [dismissedAt, setDismissedAt] = useState<number | undefined>(undefined)
  // Hidden until the browser does something new.
  if (dismissedAt !== undefined && activity.actions.length <= dismissedAt) return null

  const last = activity.actions.at(-1)
  return (
    <div class={`browser-strip${open ? " open" : ""}`}>
      <div class="browser-strip-bar">
        <button class="browser-strip-toggle" title={open ? "Hide browser activity" : "Show browser activity"} onClick={() => setOpen(!open)}>
          <span class={`status-dot ${activity.running ? "pending" : connected ? "connected" : "disabled"}`} />
          <Icon name="globe" />
          <span class="browser-page">{browserPageLabel(activity)}</span>
          {last ? (
            <span class="browser-last">
              · {last.label}
              {last.running ? "…" : ""}
            </span>
          ) : null}
          <Icon name={open ? "chevron-down" : "chevron-up"} />
        </button>
        <button class="icon-button" title="Hide" onClick={() => setDismissedAt(activity.actions.length)}>
          <Icon name="close" />
        </button>
      </div>
      {open ? (
        <div class="browser-details">
          {activity.url ? (
            <a class="browser-url" href={activity.url} title="Open in your browser">
              {activity.url}
            </a>
          ) : null}
          <div class="browser-meta">
            {connected ? `Connected through ${activity.server}` : `${activity.server} isn't connected`}
            {activity.console ? ` · Console: ${activity.console}` : ""}
          </div>
          <ol class="browser-actions">
            {[...activity.actions].reverse().map((action, index) => (
              <li key={index} class={action.running ? "running" : ""}>
                {action.label}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
