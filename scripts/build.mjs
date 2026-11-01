import { rmSync } from "node:fs"
import { build, context } from "esbuild"

const watch = process.argv.includes("--watch")
const production = process.argv.includes("--production")

const shared = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : "linked",
  legalComments: "none",
  logLevel: "info",
}

const targets = [
  {
    ...shared,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  },
  {
    ...shared,
    entryPoints: ["src/webview/main.tsx"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "preact",
    loader: { ".ttf": "file" },
    assetNames: "[name]",
  },
]

if (watch) {
  for (const options of targets) {
    const ctx = await context(options)
    await ctx.watch()
  }
} else {
  rmSync("dist", { recursive: true, force: true })
  await Promise.all(targets.map((options) => build(options)))
}
