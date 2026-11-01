import { describe, expect, it } from "vitest"
import { resolveOpencodeCommand, serverDirectory } from "./paths.ts"

describe("serverDirectory", () => {
  it("upper-cases Windows drive letters", () => {
    expect(serverDirectory("c:\\lottery\\repo", "win32")).toBe("C:\\lottery\\repo")
    expect(serverDirectory("C:\\lottery\\repo", "win32")).toBe("C:\\lottery\\repo")
  })

  it("leaves other platforms alone", () => {
    expect(serverDirectory("/home/me/repo", "linux")).toBe("/home/me/repo")
  })
})

describe("resolveOpencodeCommand", () => {
  const files = (...paths: string[]) => (path: string) => paths.includes(path)

  it("uses the configured path when there is one", () => {
    expect(resolveOpencodeCommand("  D:\\tools\\opencode.exe ", {}, "win32", files())).toBe("D:\\tools\\opencode.exe")
  })

  it("uses the bare command outside Windows", () => {
    expect(resolveOpencodeCommand("", { PATH: "/usr/bin" }, "linux", files())).toBe("opencode")
  })

  it("finds opencode.exe on PATH", () => {
    const env = { PATH: "C:\\a;C:\\tools" }
    expect(resolveOpencodeCommand("", env, "win32", files("C:\\tools\\opencode.exe"))).toBe("C:\\tools\\opencode.exe")
  })

  it("follows the npm shim to the real executable", () => {
    const env = { Path: "C:\\Users\\me\\AppData\\Roaming\\npm" }
    const exe = "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe"
    const exists = files("C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd", exe)
    expect(resolveOpencodeCommand("", env, "win32", exists)).toBe(exe)
  })

  it("checks the global npm folder when PATH has nothing", () => {
    const exe = "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe"
    const env = { PATH: "", APPDATA: "C:\\Users\\me\\AppData\\Roaming" }
    expect(resolveOpencodeCommand("", env, "win32", files(exe))).toBe(exe)
  })
})
