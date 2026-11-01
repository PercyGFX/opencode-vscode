import "@vscode/codicons/dist/codicon.css"
import "./styles.css"
import { render } from "preact"
import { App } from "./app.tsx"

const root = document.getElementById("app")
if (root) render(<App />, root)
