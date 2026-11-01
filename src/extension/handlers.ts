import { pathToFileURL } from "node:url"
import type { FormDetail, OpenCodeClient, SessionInfo, SessionMessageInfo } from "@opencode/client"
import {
  BUILD_AGENT,
  META_KEY,
  PLAN_AGENT,
  modeMetaJson,
  modeRules,
  readModeMeta,
  replaceRules,
  type ModeId,
  type SessionModeMeta,
} from "../shared/modes.ts"
import type { ActiveFile, ModelChoice, RequestMap, RequestMethod } from "../shared/protocol.ts"

export type Handlers = {
  [M in RequestMethod]: (params: RequestMap[M]["params"]) => Promise<RequestMap[M]["result"]>
}

export type Settings = {
  defaultMode: ModeId
  autoAskPatterns: readonly string[]
}

export type HandlerDeps = {
  client: () => Promise<OpenCodeClient>
  directory: () => string | undefined
  activeFile: () => ActiveFile
  settings: () => Settings
  openFile: (path: string) => Promise<void>
  openDiff: (request: RequestMap["openDiff"]["params"]) => Promise<void>
  reconnect: () => Promise<void>
  lastModel: () => ModelChoice | undefined
  lastMode: () => ModeId | undefined
  remember: (choice: { model?: ModelChoice; mode?: ModeId }) => Promise<void>
}

const MESSAGE_LIMIT = 200
const SESSION_LIMIT = 50

export type ModeClient = Pick<OpenCodeClient["session"], "get" | "update" | "switchAgent">

// Applies a mode to an existing session: swaps the session permission rules the
// previous mode added, and moves in or out of the plan agent.
export async function setSessionMode(
  session: ModeClient,
  sessionID: string,
  mode: ModeId,
  autoAskPatterns: readonly string[],
): Promise<SessionInfo> {
  const info = await session.get({ sessionID })
  const previous = readModeMeta(info.metadata)
  const rules = modeRules(mode, autoAskPatterns)
  const permissions = replaceRules(info.permissions ?? [], previous?.rules ?? [], rules)

  let previousAgent = previous?.previousAgent
  if (mode === "plan" && info.agent !== PLAN_AGENT) {
    previousAgent = info.agent ?? BUILD_AGENT
    await session.switchAgent({ sessionID, agent: PLAN_AGENT })
  } else if (mode !== "plan" && info.agent === PLAN_AGENT) {
    await session.switchAgent({ sessionID, agent: previousAgent ?? BUILD_AGENT })
  }

  const meta: SessionModeMeta =
    mode === "plan" && previousAgent !== undefined ? { mode, rules, previousAgent } : { mode, rules }
  await session.update({
    sessionID,
    permissions,
    metadata: { ...info.metadata, [META_KEY]: modeMetaJson(meta) },
  })
  return session.get({ sessionID })
}

const loadMessages = async (client: OpenCodeClient, sessionID: string): Promise<SessionMessageInfo[]> => {
  const page = await client.message.list({ sessionID, order: "desc", limit: MESSAGE_LIMIT })
  return page.data.reverse()
}

const loadPendingForms = async (client: OpenCodeClient, sessionID: string): Promise<FormDetail[]> => {
  const forms = await client.session.form.list({ sessionID })
  const details = await Promise.all(forms.map((form) => client.session.form.get({ sessionID, formID: form.id })))
  return details.filter((form) => form.state.status === "pending")
}

const fileAttachment = (file: NonNullable<ActiveFile>) => {
  const attachment = { uri: pathToFileURL(file.path).href, name: file.relativePath }
  if (!file.selection) return attachment
  const { startLine, endLine } = file.selection
  const lines = startLine === endLine ? `Line ${startLine} is` : `Lines ${startLine}-${endLine} are`
  return { ...attachment, description: `${lines} selected in the editor` }
}

export function createHandlers(deps: HandlerDeps): Handlers {
  const location = () => {
    const directory = deps.directory()
    return directory ? { directory } : undefined
  }

  return {
    bootstrap: async () => {
      const client = await deps.client()
      const [agents, models, fallback, commands] = await Promise.all([
        client.agent.list({ location: location() }),
        client.model.list({ location: location(), types: ["chat"] }),
        client.model.default({ location: location() }),
        client.command.list({ location: location() }),
      ])
      return {
        directory: deps.directory(),
        agents: agents.data.filter((agent) => !agent.hidden),
        models: models.data.filter((model) => model.enabled),
        defaultModel: fallback.data,
        defaultMode: deps.settings().defaultMode,
        commands: commands.data,
        lastModel: deps.lastModel() ?? null,
        lastMode: deps.lastMode() ?? null,
      }
    },

    listSessions: async ({ search }) => {
      const client = await deps.client()
      const [page, active] = await Promise.all([
        client.session.list({
          directory: deps.directory(),
          parentID: null,
          archived: false,
          order: "desc",
          limit: SESSION_LIMIT,
          search: search?.trim() || undefined,
        }),
        client.session.active(),
      ])
      return {
        sessions: page.data.filter((session) => !session.parentID),
        running: Object.keys(active),
      }
    },

    loadSession: async ({ sessionID }) => {
      const client = await deps.client()
      const [info, messages, permissions, forms, active] = await Promise.all([
        client.session.get({ sessionID }),
        loadMessages(client, sessionID),
        client.permission.list({ sessionID }),
        loadPendingForms(client, sessionID),
        client.session.active(),
      ])
      return { info, messages, permissions, forms, running: sessionID in active }
    },

    loadMessages: async ({ sessionID }) => loadMessages(await deps.client(), sessionID),

    createSession: async ({ mode, model }) => {
      const client = await deps.client()
      const rules = modeRules(mode, deps.settings().autoAskPatterns)
      return client.session.create({
        location: location(),
        agent: mode === "plan" ? PLAN_AGENT : undefined,
        model,
        permissions: rules,
        metadata: { [META_KEY]: modeMetaJson({ mode, rules }) },
      })
    },

    prompt: async ({ sessionID, text, attachActiveFile }) => {
      const client = await deps.client()
      const file = attachActiveFile ? deps.activeFile() : undefined
      await client.session.prompt({ sessionID, text, files: file ? [fileAttachment(file)] : undefined })
      return null
    },

    command: async ({ sessionID, name, text, attachActiveFile }) => {
      const client = await deps.client()
      const file = attachActiveFile ? deps.activeFile() : undefined
      await client.session.command({ sessionID, name, text, files: file ? [fileAttachment(file)] : undefined })
      return null
    },

    compact: async ({ sessionID }) => {
      const client = await deps.client()
      await client.session.compact({ sessionID })
      return null
    },

    interrupt: async ({ sessionID }) => {
      const client = await deps.client()
      await client.session.interrupt({ sessionID })
      return null
    },

    setMode: async ({ sessionID, mode }) => {
      const client = await deps.client()
      return setSessionMode(client.session, sessionID, mode, deps.settings().autoAskPatterns)
    },

    setModel: async ({ sessionID, model }) => {
      const client = await deps.client()
      await client.session.switchModel({ sessionID, model })
      return client.session.get({ sessionID })
    },

    remember: async (choice) => {
      await deps.remember(choice)
      return null
    },

    replyPermission: async ({ sessionID, requestID, decision }) => {
      const client = await deps.client()
      await client.permission.reply({ sessionID, requestID, decision })
      return null
    },

    replyForm: async ({ sessionID, formID, answer }) => {
      const client = await deps.client()
      await client.session.form.reply({ sessionID, formID, answer })
      return null
    },

    cancelForm: async ({ sessionID, formID }) => {
      const client = await deps.client()
      await client.session.form.cancel({ sessionID, formID })
      return null
    },

    getForm: async ({ sessionID, formID }) => {
      const client = await deps.client()
      return client.session.form.get({ sessionID, formID })
    },

    openFile: async ({ path }) => {
      await deps.openFile(path)
      return null
    },

    openDiff: async (request) => {
      await deps.openDiff(request)
      return null
    },

    reconnect: async () => {
      await deps.reconnect()
      return null
    },
  }
}
