export function Icon({ name, spin = false }: { name: string; spin?: boolean }) {
  return <i class={`codicon codicon-${name}${spin ? " codicon-modifier-spin" : ""}`} aria-hidden="true" />
}
