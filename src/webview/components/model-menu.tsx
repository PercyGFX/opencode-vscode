import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import type { ModelInfo } from "@opencode/client"
import { filterModels, formatContext, groupByProvider, modelKey } from "../models.ts"
import { Icon } from "./icon.tsx"

type ModelMenuProps = {
  models: ModelInfo[]
  selected: ModelInfo | undefined
  onPick: (model: ModelInfo) => void
  onClose: () => void
}

export function ModelMenu({ models, selected, onPick, onClose }: ModelMenuProps) {
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => groupByProvider(filterModels(models, query)), [models, query])
  // Keyboard order follows the grouped display order.
  const flat = useMemo(() => groups.flatMap(([, group]) => group), [groups])
  const active = Math.min(highlight, Math.max(flat.length - 1, 0))

  useEffect(() => {
    input.current?.focus()
    // Start on the current model so Enter keeps it and arrows move from it.
    const index = selected ? flat.findIndex((model) => modelKey(model) === modelKey(selected)) : -1
    if (index > 0) setHighlight(index)
  }, [])

  useEffect(() => {
    list.current?.querySelector(".model-item.highlighted")?.scrollIntoView({ block: "nearest" })
  }, [active, query])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!flat.length) return
      const step = event.key === "ArrowDown" ? 1 : -1
      setHighlight((active + step + flat.length) % flat.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      const model = flat[active]
      if (model) onPick(model)
    } else if (event.key === "Escape") {
      event.preventDefault()
      onClose()
    }
  }

  let index = -1
  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class="popover models">
        <div class="popover-search">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            placeholder={`Search ${models.length} models`}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setHighlight(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div class="model-list" ref={list}>
          {flat.length === 0 ? <div class="history-empty">No models match "{query}"</div> : null}
          {groups.map(([providerID, group]) => (
            <div key={providerID} class="model-group">
              <div class="model-group-label">{providerID}</div>
              {group.map((model) => {
                index += 1
                const position = index
                const isSelected = selected !== undefined && modelKey(model) === modelKey(selected)
                return (
                  <button
                    key={modelKey(model)}
                    class={`model-item${position === active ? " highlighted" : ""}${isSelected ? " selected" : ""}`}
                    onMouseEnter={() => setHighlight(position)}
                    onClick={() => onPick(model)}
                  >
                    <span class="model-name">{model.name}</span>
                    <span class="model-meta">
                      {model.variants.length ? <Icon name="dashboard" /> : null}
                      {formatContext(model.limit.context)}
                    </span>
                    {isSelected ? <Icon name="check" /> : <span class="model-check" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
