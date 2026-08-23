import type { PluginInput } from "@opencode-ai/plugin"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Config } from "../src/core/types/config"
import type { RouteDeps } from "../src/transport/http/routes"
import type { Logger } from "../src/infra/logger"
import { createEventBus } from "../src/core/events/bus"
import { createPermissionQueue } from "../src/core/permissions/queue"
import { createTelegramChannel, createPushService } from "../src/notifications/pipeline"
import { createRemoteServer } from "../src/transport/http/server"
import { opencodeIntegration } from "../src/integrations/opencode"
import { codexIntegration } from "../src/integrations/codex"

const port = Number(process.env.PILOT_E2E_PORT ?? 4197)
const token = "pilot-e2e-token"
const directory = join(tmpdir(), "pilot-e2e-project")
const prompts: string[] = []
let permissionResolution: string | null = null

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

const client = {
  session: {
    list: async () => ok([session]),
    status: async () => ok({ [session.id]: "idle" }),
    create: async () => ok(session),
    get: async () => ok(session),
    messages: async () => ok([]),
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
    agents: async () => ok([]),
  },
  tui: { showToast: async () => ok({ ok: true }) },
  provider: { list: async () => ok({ all: [], default: {}, connected: [] }) },
  mcp: { status: async () => ok({}) },
  project: {
    list: async () => ok([]),
    current: async () => ok({ id: "project-e2e", name: "E2E project", path: directory }),
  },
  lsp: { status: async () => ok([]) },
  file: { list: async () => ok([]), read: async () => ok({ type: "text", content: "" }), status: async () => ok([]) },
} as unknown as PluginInput["client"]

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
}

void permissionQueue.waitForResponse("permission-e2e", {
  title: "Run the E2E command",
  sessionID: session.id,
  type: "shell",
  pattern: "echo e2e",
  metadata: { project: "E2E project" },
}).then((result) => { permissionResolution = result?.action ?? "expired" })

const server = createRemoteServer(deps)
server.registerRoute({
  method: "GET",
  pattern: /^\/_e2e\/state$/,
  auth: "required",
  handler: async () => Response.json({ prompts, permissionResolution }),
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
