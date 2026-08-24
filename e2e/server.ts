import type { PluginInput } from "@opencode-ai/plugin"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Config } from "../src/core/types/config"
import type { RouteDeps } from "../src/transport/http/routes"
import type { Logger } from "../src/infra/logger"
import type { AgentAttentionService, AgentPermissionRequest, AgentQuestionRequest } from "../src/core/types/agent-attention"
import { createEventBus } from "../src/core/events/bus"
import { createPermissionQueue } from "../src/core/permissions/queue"
import { createTelegramChannel, createPushService } from "../src/notifications/pipeline"
import { createRemoteServer } from "../src/transport/http/server"
import { opencodeIntegration } from "../src/integrations/opencode"
import { codexIntegration } from "../src/integrations/codex"

const port = Number(process.env.PILOT_E2E_PORT ?? 4197)
const token = "pilot-e2e-token"
const directory = join(tmpdir(), "pilot-e2e-project")
const secondDirectory = join(tmpdir(), "pilot-e2e-second-project")
const prompts: string[] = []
let permissionResolution: string | null = null
let permissionReplyCount = 0
let questionAnswers: string[][] | null = null
let questionReplyCount = 0
let nativePermissions: AgentPermissionRequest[] = []
let nativeQuestions: AgentQuestionRequest[] = []

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
const audit = { log: () => undefined }
const config: Config = {
  port,
  host: "127.0.0.1",
  permissionTimeoutMs: 60_000,
  tunnel: "off",
  telegram: null,
  dev: false,
  vapid: null,
  enableGlobOpener: false,
  fetchTimeoutMs: 5_000,
  projectStateMode: "off",
  codexPermissionTimeoutMs: 60_000,
}
const eventBus = createEventBus()
const permissionQueue = createPermissionQueue(config.permissionTimeoutMs)
const codexPermissionQueue = createPermissionQueue(config.codexPermissionTimeoutMs)
const telegram = createTelegramChannel(null, permissionQueue, codexPermissionQueue, logger)
const push = createPushService({ config, audit, logger })
const ok = <T>(data: T) => ({ data, error: null })
const session = {
  id: "session-e2e",
  title: "E2E session",
  directory,
  time: { created: Date.now(), updated: Date.now() },
}
const secondSession = {
  id: "session-e2e-second",
  title: "Second project session",
  directory: secondDirectory,
  time: { created: Date.now(), updated: Date.now() + 1 },
}

function requestedDirectory(args?: { query?: { directory?: string } }): string {
  return args?.query?.directory ?? directory
}

function selectedSession(args?: { query?: { directory?: string } }) {
  return requestedDirectory(args) === secondDirectory ? secondSession : session
}

function messageFor(selected: typeof session) {
  const second = selected.id === secondSession.id
  return [{
    info: {
      id: `message-${selected.id}`,
      sessionID: selected.id,
      role: "assistant",
      mode: second ? "reviewer" : "builder",
      modelID: second ? "model-second" : "model-primary",
      providerID: second ? "provider-second" : "provider-primary",
      time: { created: Date.now(), completed: Date.now() },
    },
    parts: [{ id: `part-${selected.id}`, messageID: `message-${selected.id}`, sessionID: selected.id, type: "text", text: "Ready" }],
  }]
}

const client = {
  session: {
    list: async (args?: { query?: { directory?: string } }) => ok([selectedSession(args)]),
    status: async (args?: { query?: { directory?: string } }) => {
      const selected = selectedSession(args)
      return ok({ [selected.id]: { type: "idle" } })
    },
    create: async () => ok(session),
    get: async () => ok(session),
    messages: async (args?: { query?: { directory?: string } }) => ok(messageFor(selectedSession(args))),
    diff: async () => ok([]),
    children: async () => ok([]),
    update: async () => ok(session),
    delete: async () => ok({ ok: true }),
    prompt: async (args: { body?: { parts?: Array<{ text?: string }> } }) => {
      const text = args.body?.parts?.[0]?.text
      if (typeof text === "string") prompts.push(text)
      return ok({ ok: true })
    },
    abort: async () => ok({ ok: true }),
  },
  tool: { ids: async () => ok([]) },
  app: {
    log: async () => ok({ ok: true }),
    agents: async (args?: { query?: { directory?: string } }) => ok([
      { name: requestedDirectory(args) === secondDirectory ? "reviewer" : "builder" },
    ]),
  },
  tui: { showToast: async () => ok({ ok: true }) },
  provider: { list: async (args?: { query?: { directory?: string } }) => {
    const second = requestedDirectory(args) === secondDirectory
    const id = second ? "provider-second" : "provider-primary"
    const model = second ? "model-second" : "model-primary"
    return ok({
      all: [{ id, name: second ? "Second Provider" : "Primary Provider", models: { [model]: { id: model, name: second ? "Second Model" : "Primary Model" } } }],
      default: { [id]: model },
      connected: [id],
    })
  } },
  mcp: { status: async () => ok({}) },
  project: {
    list: async () => ok([]),
    current: async (args?: { query?: { directory?: string } }) => {
      const selected = requestedDirectory(args)
      return ok({
        id: selected === secondDirectory ? "project-e2e-second" : "project-e2e",
        name: selected === secondDirectory ? "Second project" : "E2E project",
        path: selected,
      })
    },
  },
  lsp: { status: async () => ok([]) },
  file: { list: async () => ok([]), read: async () => ok({ type: "text", content: "" }), status: async () => ok([]) },
} as unknown as PluginInput["client"]

const attentionService: AgentAttentionService = {
  async listPermissions(directoryArg) {
    return nativePermissions.filter((permission) => !directoryArg || permission.metadata.directory === directoryArg)
  },
  async replyPermission(requestID, reply) {
    const index = nativePermissions.findIndex((permission) => permission.id === requestID)
    if (index === -1) throw new Error("permission not found")
    nativePermissions.splice(index, 1)
    permissionResolution = reply
    permissionReplyCount += 1
  },
  async listQuestions(directoryArg) {
    return nativeQuestions.filter((question) => {
      const selected = question.sessionID === secondSession.id ? secondDirectory : directory
      return !directoryArg || selected === directoryArg
    })
  },
  async replyQuestion(requestID, answers) {
    const index = nativeQuestions.findIndex((question) => question.id === requestID)
    if (index === -1) throw new Error("question not found")
    nativeQuestions.splice(index, 1)
    questionAnswers = answers
    questionReplyCount += 1
  },
  async rejectQuestion(requestID) {
    const index = nativeQuestions.findIndex((question) => question.id === requestID)
    if (index === -1) throw new Error("question not found")
    nativeQuestions.splice(index, 1)
  },
}

const settingsStore = {
  load: () => ({}),
  save: () => ({}),
  reset: () => undefined,
  filePath: () => "/tmp/pilot-e2e-config.json",
}
const deps: RouteDeps = {
  client,
  project: { worktree: directory } as unknown as PluginInput["project"],
  directory,
  worktree: directory as unknown as PluginInput["worktree"],
  config,
  token,
  pilotVersion: "e2e",
  integrations: [opencodeIntegration, codexIntegration],
  rotateToken: (nextToken) => { deps.token = nextToken },
  tunnelUrl: null,
  audit,
  eventBus,
  permissionQueue,
  codexPermissionQueue,
  telegram,
  push,
  logger,
  settingsStore,
  shellEnv: {},
  envFileApplied: [],
  settingsLoader: {
    loadEffective: () => ({
      effective: config,
      settings: {
        port,
        host: config.host,
        permissionTimeoutMs: config.permissionTimeoutMs,
        tunnel: config.tunnel,
        telegramToken: "",
        telegramChatId: "",
        vapidPublicKey: "",
        vapidPrivateKey: "",
        vapidSubject: "",
        enableGlobOpener: false,
        fetchTimeoutMs: config.fetchTimeoutMs,
        projectStateMode: config.projectStateMode,
        hookTokenConfigured: false,
      },
      sources: {},
    }),
    envKeyFor: () => "",
    restartRequiredFields: [],
  },
  attentionService,
}

const server = createRemoteServer(deps)
server.registerRoute({
  method: "GET",
  pattern: /^\/_e2e\/state$/,
  auth: "required",
  handler: async () => Response.json({ prompts, permissionResolution, permissionReplyCount, questionAnswers, questionReplyCount }),
})
server.registerRoute({
  method: "POST",
  pattern: /^\/_e2e\/setup$/,
  auth: "required",
  handler: async ({ req }) => {
    const body = await req.json() as { permission?: boolean; question?: boolean }
    permissionResolution = null
    permissionReplyCount = 0
    questionAnswers = null
    questionReplyCount = 0
    nativePermissions = body.permission ? [{
      id: "permission-e2e",
      sessionID: session.id,
      permission: "bash",
      patterns: ["echo e2e"],
      metadata: { directory, project: "E2E project" },
      always: [],
    }] : []
    nativeQuestions = body.question ? [{
      id: "question-e2e",
      sessionID: session.id,
      questions: [{
        header: "Release channel",
        question: "Which channel should Pilot use?",
        options: [
          { label: "Stable", description: "Use production releases" },
          { label: "Preview", description: "Use prerelease builds" },
        ],
      }],
    }] : []
    return Response.json({ ok: true })
  },
})
const result = server.start()
if (!result.ok) throw result.error

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.stop()
    process.exit(0)
  })
}

console.log(`Pilot E2E server listening on http://127.0.0.1:${port}`)
