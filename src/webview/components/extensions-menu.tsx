import { useEffect, useState } from "preact/hooks"
import type { McpServer, PluginInfo, SkillInfo } from "@opencode/client"
import { RECOMMENDED_MCP } from "../../shared/recommended-mcp.ts"
import type { State } from "../store.ts"
import { Icon } from "./icon.tsx"

export type ExtensionsTab = "mcp" | "plugins" | "skills"

type ExtensionsMenuProps = {
  state: State
  onClose: () => void
  onMcp: (server: string, connect: boolean) => Promise<void>
  onAddMcp: (name: string) => Promise<void>
  onCheckPlugins: () => Promise<void>
  onUpdatePlugin: (target: string) => Promise<void>
  onAttachSkill: (id: string) => void
  onOpenFile: (path: string) => void
}

// True when something needs the user's attention: a broken MCP server or plugin, or a plugin update.
export function extensionsNeedAttention(state: State): boolean {
  const mcp = state.mcp?.some((server) => server.status.status === "failed" || server.status.status === "needs_auth")
  const plugins = state.plugins?.some(
    (plugin) => plugin.state.status === "failed" || (plugin.source.type === "package" && plugin.source.outdated),
  )
  return Boolean(mcp || plugins)
}

export function ExtensionsMenu(props: ExtensionsMenuProps) {
  const { state, onClose } = props
  const [tab, setTab] = useState<ExtensionsTab>("mcp")

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const count = (items: unknown[] | undefined) => (items ? ` ${items.length}` : "")

  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class="popover extensions">
        <div class="extensions-tabs" role="tablist">
          <button class={tab === "mcp" ? "selected" : ""} onClick={() => setTab("mcp")}>
            MCP{count(state.mcp)}
          </button>
          <button class={tab === "plugins" ? "selected" : ""} onClick={() => setTab("plugins")}>
            Plugins{count(state.plugins?.filter(isUserPlugin))}
          </button>
          <button class={tab === "skills" ? "selected" : ""} onClick={() => setTab("skills")}>
            Skills{count(state.skills)}
          </button>
        </div>
        <div class="extensions-list">
          {tab === "mcp" ? <McpTab servers={state.mcp} onMcp={props.onMcp} onAdd={props.onAddMcp} /> : null}
          {tab === "plugins" ? (
            <PluginsTab plugins={state.plugins} onCheck={props.onCheckPlugins} onUpdate={props.onUpdatePlugin} />
          ) : null}
          {tab === "skills" ? (
            <SkillsTab
              skills={state.skills}
              attached={state.pendingSkills}
              onAttach={props.onAttachSkill}
              onOpenFile={props.onOpenFile}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

// Tracks which rows have an action in flight.
function useBusy() {
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy((current) => new Set(current).add(key))
    try {
      await action()
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }
  return { busy, run }
}

const setupHints = new Map(RECOMMENDED_MCP.flatMap((entry) => (entry.setupHint ? [[entry.name, entry.setupHint]] : [])))

const MCP_LABELS: Record<McpServer["status"]["status"], string> = {
  connected: "Connected",
  pending: "Connecting…",
  disabled: "Disabled",
  failed: "Failed",
  needs_auth: "Needs sign-in",
}

function McpTab({
  servers,
  onMcp,
  onAdd,
}: {
  servers: McpServer[] | undefined
  onMcp: ExtensionsMenuProps["onMcp"]
  onAdd: ExtensionsMenuProps["onAddMcp"]
}) {
  const { busy, run } = useBusy()
  if (!servers) return <Loading />
  const installed = new Set(servers.map((server) => server.name))
  const recommended = RECOMMENDED_MCP.filter((entry) => !installed.has(entry.name))
  return (
    <>
      {servers.length ? null : <Empty text="No MCP servers are configured for this workspace." />}
      {recommended.length ? (
        <div class="extensions-section">
          <div class="extensions-section-title">Recommended</div>
          {recommended.map((entry) => (
            <div key={entry.name} class="extension-item">
              <Icon name="globe" />
              <div class="extension-text">
                <span class="extension-name">{entry.title}</span>
                <span class="extension-detail">{entry.description}</span>
              </div>
              <button
                class="button primary small"
                disabled={busy.has(entry.name)}
                title="Add to your global OpenCode config and connect"
                onClick={() => void run(entry.name, () => onAdd(entry.name))}
              >
                {busy.has(entry.name) ? <Icon name="loading" spin /> : "Add"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {servers.length && recommended.length ? <div class="extensions-section-title">Installed</div> : null}
      {servers.map((server) => {
        const { status } = server.status
        const connected = status === "connected"
        const working = busy.has(server.name) || status === "pending"
        return (
          <div key={server.name} class="extension-item">
            <span class={`status-dot ${status}`} />
            <div class="extension-text">
              <span class="extension-name">{server.title ?? server.name}</span>
              <span class="extension-detail">
                {MCP_LABELS[status]}
                {"error" in server.status ? ` · ${server.status.error}` : ""}
              </span>
              {status === "failed" && setupHints.get(server.name) ? (
                <span class="extension-hint">{setupHints.get(server.name)}</span>
              ) : null}
            </div>
            <button
              class="button secondary small"
              disabled={working}
              onClick={() => void run(server.name, () => onMcp(server.name, !connected))}
            >
              {working ? <Icon name="loading" spin /> : connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        )
      })}
    </>
  )
}

const isUserPlugin = (plugin: PluginInfo) => plugin.source.type === "package" || plugin.source.type === "local"

const pluginName = (plugin: PluginInfo): string => {
  const { source } = plugin
  if (source.type === "package") return source.target
  if (source.type === "local") return source.path.split(/[\\/]/).filter(Boolean).pop() ?? source.path
  return plugin.id ?? source.type
}

const FEATURE_LABELS: Record<string, string> = { server: "server", tui: "TUI", rpc: "RPC", gui: "GUI" }

function PluginsTab({
  plugins,
  onCheck,
  onUpdate,
}: {
  plugins: PluginInfo[] | undefined
  onCheck: ExtensionsMenuProps["onCheckPlugins"]
  onUpdate: ExtensionsMenuProps["onUpdatePlugin"]
}) {
  const { busy, run } = useBusy()
  if (!plugins) return <Loading />
  const installed = plugins.filter(isUserPlugin)
  const builtin = plugins.filter((plugin) => !isUserPlugin(plugin))
  const checking = busy.has("check")

  return (
    <>
      <div class="extensions-toolbar">
        <button class="button secondary small" disabled={checking} onClick={() => void run("check", onCheck)}>
          {checking ? <Icon name="loading" spin /> : <Icon name="refresh" />} Check for updates
        </button>
      </div>
      {installed.length ? null : <Empty text="No plugins installed. Add them with opencode plugin add." />}
      {installed.map((plugin) => (
        <PluginRow key={pluginName(plugin)} plugin={plugin} busy={busy} run={run} onUpdate={onUpdate} />
      ))}
      {builtin.length ? (
        <details class="extensions-builtin">
          <summary>Built in ({builtin.length})</summary>
          {builtin.map((plugin) => (
            <PluginRow key={pluginName(plugin)} plugin={plugin} busy={busy} run={run} onUpdate={onUpdate} />
          ))}
        </details>
      ) : null}
    </>
  )
}

function PluginRow({
  plugin,
  busy,
  run,
  onUpdate,
}: {
  plugin: PluginInfo
  busy: Set<string>
  run: (key: string, action: () => Promise<void>) => Promise<void>
  onUpdate: ExtensionsMenuProps["onUpdatePlugin"]
}) {
  const { source, state } = plugin
  const failed = state.status === "failed"
  const features = Object.entries(plugin.features)
    .filter(([, enabled]) => enabled)
    .map(([feature]) => FEATURE_LABELS[feature] ?? feature)
  const updating = source.type === "package" && (source.updating || busy.has(source.target))

  return (
    <div class="extension-item">
      <span class={`status-dot ${failed ? "failed" : "connected"}`} />
      <div class="extension-text">
        <span class="extension-name">
          {pluginName(plugin)}
          {source.type === "package" && source.version ? <span class="extension-version">{source.version}</span> : null}
        </span>
        <span class="extension-detail">
          {failed ? `Failed · ${state.error}` : features.length ? features.join(" · ") : "Active"}
        </span>
      </div>
      {source.type === "package" && (source.outdated || updating) ? (
        <button
          class="button primary small"
          disabled={updating}
          onClick={() => void run(source.target, () => onUpdate(source.target))}
        >
          {updating ? <Icon name="loading" spin /> : "Update"}
        </button>
      ) : null}
    </div>
  )
}

function SkillsTab({
  skills,
  attached,
  onAttach,
  onOpenFile,
}: {
  skills: SkillInfo[] | undefined
  attached: string[]
  onAttach: (id: string) => void
  onOpenFile: (path: string) => void
}) {
  if (!skills) return <Loading />
  if (!skills.length) return <Empty text="No skills found for this workspace." />
  return (
    <>
      {skills.map((skill) => {
        const added = attached.includes(skill.id)
        return (
          <div key={skill.id} class="extension-item">
            <Icon name="book" />
            <div class="extension-text">
              <a class="extension-name link" title={`Open ${skill.path}`} onClick={() => onOpenFile(skill.path)}>
                {skill.name}
                {skill.autoinvoke ? <span class="extension-version">auto</span> : null}
              </a>
              {skill.description ? <span class="extension-detail">{skill.description}</span> : null}
            </div>
            <button
              class="button secondary small"
              disabled={added}
              title="Attach this skill to your next message"
              onClick={() => onAttach(skill.id)}
            >
              {added ? "Added" : "Use"}
            </button>
          </div>
        )
      })}
    </>
  )
}

const Loading = () => (
  <div class="history-empty">
    <Icon name="loading" spin /> Loading…
  </div>
)

const Empty = ({ text }: { text: string }) => <div class="history-empty">{text}</div>
