import { existsSync } from "node:fs"
import { win32 } from "node:path"

// VS Code reports Windows drive letters in lower case ("c:\repo"), while
// OpenCode records the process working directory ("C:\repo"). Send the
// upper-case form so sessions match the ones the TUI creates.
export function serverDirectory(fsPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32" && /^[a-z]:/.test(fsPath)) return fsPath.charAt(0).toUpperCase() + fsPath.slice(1)
  return fsPath
}

type Env = Readonly<Record<string, string | undefined>>

// The client starts the server with spawn() and no shell, which can't run the
// npm `opencode.cmd` shim on Windows. Find the real executable instead.
export function resolveOpencodeCommand(
  configured: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): string {
  const explicit = configured.trim()
  if (explicit) return explicit
  if (platform !== "win32") return "opencode"

  const { join, delimiter } = win32
  const npmTarget = (dir: string) => join(dir, "node_modules", "@opencode", "cli", "bin", "opencode.exe")
  const pathDirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)
  for (const dir of pathDirs) {
    const exe = join(dir, "opencode.exe")
    if (exists(exe)) return exe
    if (exists(join(dir, "opencode.cmd")) && exists(npmTarget(dir))) return npmTarget(dir)
  }

  if (env.APPDATA) {
    const globalNpm = npmTarget(join(env.APPDATA, "npm"))
    if (exists(globalNpm)) return globalNpm
  }
  return "opencode"
}
