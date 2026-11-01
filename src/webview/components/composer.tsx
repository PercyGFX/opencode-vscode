import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks"
import type { ModelInfo } from "@opencode/client"
import { matchCommands, type SlashCommand } from "../../shared/commands.ts"
import { MODES, modeDefinition, nextMode, type ModeId } from "../../shared/modes.ts"
import type { ActiveFile, ModelChoice } from "../../shared/protocol.ts"
import { toChoice, variantLabel, type ResolvedModel } from "../models.ts"
import type { UsageSummary } from "../usage.ts"
import { Icon } from "./icon.tsx"
import { ModelMenu } from "./model-menu.tsx"

type ComposerProps = {
  disabled: boolean
  busy: boolean
  canStop: boolean
  mode: ModeId | undefined
  model: ResolvedModel
  models: ModelInfo[]
  commands: SlashCommand[]
  usage: UsageSummary | undefined
  activeFile: ActiveFile
  attachActiveFile: boolean
  onToggleAttach: () => void
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  onMode: (mode: ModeId) => void
  onModel: (model: ModelChoice) => void
}

export function Composer(props: ComposerProps) {
  const { disabled, busy, canStop, mode, model, models, activeFile, attachActiveFile } = props
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [menu, setMenu] = useState<"mode" | "model" | undefined>(undefined)
  const [highlight, setHighlight] = useState(0)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)

  const suggestions = suggestionsDismissed ? [] : matchCommands(props.commands, text)
  const highlighted = Math.min(highlight, Math.max(suggestions.length - 1, 0))

  const pickCommand = (command: SlashCommand) => {
    setText(`/${command.name} `)
    setHighlight(0)
    textarea.current?.focus()
  }

  const updateText = (value: string) => {
    setText(value)
    setHighlight(0)
    setSuggestionsDismissed(false)
  }

  const closeMenu = () => {
    setMenu(undefined)
    textarea.current?.focus()
  }

  const toggleMenu = (name: "mode" | "model") => setMenu(menu === name ? undefined : name)

  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`
  }, [text])

  useEffect(() => {
    textarea.current?.focus()
  }, [])

  const send = async () => {
    const value = text.trim()
    if (!value || sending || disabled) return
    setSending(true)
    updateText("")
    const ok = await props.onSend(value)
    setSending(false)
    if (!ok) updateText(value)
    textarea.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (suggestions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setHighlight((highlighted + step + suggestions.length) % suggestions.length)
        return
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        const command = suggestions[highlighted]
        // Enter on a fully typed command sends it; otherwise complete the name.
        if (command && !(event.key === "Enter" && text === `/${command.name}`)) {
          event.preventDefault()
          pickCommand(command)
          return
        }
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setSuggestionsDismissed(true)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void send()
    } else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault()
      props.onMode(nextMode(mode))
    } else if (event.key === "Escape" && canStop) {
      event.preventDefault()
      props.onStop()
    }
  }

  const current = mode ? modeDefinition(mode) : undefined

  return (
    <div class="composer">
      {menu === "mode" ? (
        <ModeMenu
          mode={mode}
          model={model}
          onClose={closeMenu}
          onMode={(next) => {
            props.onMode(next)
            closeMenu()
          }}
          onEffort={(variant) => {
            if (model.info) props.onModel(toChoice(model.info, variant))
          }}
        />
      ) : null}
      {menu === "model" ? (
        <ModelMenu
          models={models}
          selected={model.info}
          onClose={closeMenu}
          onPick={(picked) => {
            // Keep the effort level when the new model offers the same one.
            const variant = model.variant && picked.variants.some((entry) => entry.id === model.variant) ? model.variant : undefined
            props.onModel(toChoice(picked, variant))
            closeMenu()
          }}
        />
      ) : null}
      {suggestions.length && !menu ? (
        <div class="popover commands" role="listbox">
          {suggestions.map((command, index) => (
            <button
              key={command.name}
              class={`command-item${index === highlighted ? " selected" : ""}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                pickCommand(command)
              }}
            >
              <span class="command-name">/{command.name}</span>
              {command.description ? <span class="command-description">{command.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div class="input-box">
        <textarea
          ref={textarea}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={
            disabled ? "Connecting to OpenCode…" : busy ? "Send a message to steer OpenCode…" : "Ask OpenCode anything, / for commands"
          }
          onInput={(event) => updateText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <div class="toolbar">
          <button
            class={`chip-button${menu === "mode" ? " pressed" : ""}`}
            title="Mode (Shift+Tab to switch)"
            onClick={() => toggleMenu("mode")}
          >
            <Icon name={current?.icon ?? "settings"} />
            <span>{current?.label ?? "OpenCode default"}</span>
          </button>
          {models.length ? (
            <button
              class={`chip-button model${menu === "model" ? " pressed" : ""}`}
              title={model.isDefault ? "Model (OpenCode default)" : "Model"}
              onClick={() => toggleMenu("model")}
            >
              <span>{model.info?.name ?? "Pick a model"}</span>
              {model.variant ? <span class="model-variant">{variantLabel(model.variant)}</span> : null}
              <Icon name="chevron-down" />
            </button>
          ) : null}
          {activeFile ? (
            <button
              class={`chip-button file${attachActiveFile ? "" : " off"}`}
              title={attachActiveFile ? "The current file is included. Click to leave it out." : "Click to include the current file"}
              onClick={props.onToggleAttach}
            >
              <Icon name={attachActiveFile ? "eye" : "eye-closed"} />
              <span class="file-name">
                {fileName(activeFile.relativePath)}
                {activeFile.selection ? `:${activeFile.selection.startLine}-${activeFile.selection.endLine}` : ""}
              </span>
            </button>
          ) : null}
          <span class="spacer" />
          {props.usage ? <UsageGauge usage={props.usage} /> : null}
          {canStop ? (
            <button class="icon-button stop" title="Stop (Esc)" onClick={props.onStop}>
              <Icon name="debug-stop" />
            </button>
          ) : null}
          <button class="icon-button send" title="Send (Enter)" disabled={disabled || sending || !text.trim()} onClick={() => void send()}>
            <Icon name={sending ? "loading" : "send"} spin={sending} />
          </button>
        </div>
      </div>
    </div>
  )
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

const RING_RADIUS = 5.5
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

function UsageGauge({ usage }: { usage: UsageSummary }) {
  const level = usage.fill === undefined ? "" : usage.fill >= 0.95 ? " critical" : usage.fill >= 0.8 ? " high" : ""
  return (
    <span class={`usage${level}`} title={usage.detail}>
      {usage.fill !== undefined ? (
        <svg class="usage-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r={RING_RADIUS} class="usage-ring-track" />
          <circle
            cx="7"
            cy="7"
            r={RING_RADIUS}
            class="usage-ring-fill"
            stroke-dasharray={`${RING_LENGTH * usage.fill} ${RING_LENGTH}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      ) : null}
      <span>{usage.label}</span>
    </span>
  )
}

type ModeMenuProps = {
  mode: ModeId | undefined
  model: ResolvedModel
  onClose: () => void
  onMode: (mode: ModeId) => void
  onEffort: (variant: string | undefined) => void
}

function ModeMenu({ mode, model, onClose, onMode, onEffort }: ModeMenuProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const variants = model.info?.variants.map((variant) => variant.id) ?? []
  const effortLabel = model.variant ? variantLabel(model.variant) : "Default"

  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class="popover modes">
        <div class="popover-header">
          <span>Modes</span>
          <span class="hint">
            <kbd>Shift</kbd> + <kbd>Tab</kbd> to switch
          </span>
        </div>
        {MODES.map((definition) => (
          <button
            key={definition.id}
            class={`mode-item${definition.id === mode ? " selected" : ""}`}
            onClick={() => onMode(definition.id)}
          >
            <Icon name={definition.icon} />
            <span class="mode-text">
              <span class="mode-label">{definition.label}</span>
              <span class="mode-description">{definition.description}</span>
            </span>
            {definition.id === mode ? <Icon name="check" /> : null}
          </button>
        ))}
        <div class="popover-divider" />
        <div class="effort">
          <div class="effort-heading">
            <Icon name="dashboard" />
            <span>Effort</span>
            <span class="hint">({effortLabel})</span>
          </div>
          {variants.length ? (
            <div class="segmented">
              <button class={model.variant ? "" : "selected"} onClick={() => onEffort(undefined)}>
                Default
              </button>
              {variants.map((variant) => (
                <button key={variant} class={model.variant === variant ? "selected" : ""} onClick={() => onEffort(variant)}>
                  {variantLabel(variant)}
                </button>
              ))}
            </div>
          ) : (
            <div class="hint">{model.info ? "This model has no effort levels" : "Pick a model to set the effort"}</div>
          )}
        </div>
      </div>
    </>
  )
}
