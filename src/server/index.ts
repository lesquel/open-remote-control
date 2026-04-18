import type { Plugin } from "@opencode-ai/plugin"
import { loadConfigSafe } from "./config"
import { generateToken } from "./util/auth"
import { createAuditLog } from "./services/audit"
import { createEventBus } from "./services/event-bus"
import { createPermissionQueue } from "./services/permission-queue"
import { createTelegramBot } from "./services/telegram"
import { createPushService } from "./services/push"
import { startTunnel } from "./services/tunnel"
import { writeState, clearState } from "./services/state"
import { writeBanner } from "./services/banner"
import { createNotificationService } from "./services/notifications"
import { createRemoteServer } from "./http/server"
import { createEventHook, createPermissionAskHook, createToolHooks } from "./hooks"
import { createLogger } from "./util/logger"

export default {
  id: "opencode-pilot",
  server: (async (ctx) => {
    const config = loadConfigSafe(process.env, (msg) => {
      ctx.client.app
        .log({ body: { service: "opencode-pilot", level: "warn", message: msg } })
        .catch(() => {})
    })

    const logger = createLogger(ctx.client, "opencode-pilot")

    let currentToken = generateToken()
    const audit = createAuditLog(ctx)
    const eventBus = createEventBus()
    const permissionQueue = createPermissionQueue(config.permissionTimeoutMs)
    const telegram = createTelegramBot(config.telegram, permissionQueue, logger)
    const push = createPushService({ config, audit, logger })

    const notifications = createNotificationService(eventBus, telegram, audit, push)

    // ─── RouteDeps object — mutable so token rotation works ───────────────
    // rotateToken mutates deps.token in-place; the server reads deps.token on
    // each request so the update is immediately visible without restarting.
    const deps = {
      client: ctx.client,
      project: ctx.project,
      directory: ctx.directory,
      worktree: ctx.worktree,
      config,
      token: currentToken,
      rotateToken(newToken: string): void {
        deps.token = newToken
        currentToken = newToken
      },
      tunnelUrl: null as string | null,
      audit,
      eventBus,
      permissionQueue,
      telegram,
      push,
      logger,
    }

    const server = createRemoteServer(deps)

    server.start()

    writeState(ctx.directory, {
      token: currentToken,
      port: config.port,
      host: config.host,
      startedAt: Date.now(),
      pid: process.pid,
    })

    // Start tunnel (non-blocking — runs after HTTP server is up)
    const tunnel = await startTunnel({
      provider: config.tunnel,
      port: config.port,
    })

    // Make tunnel URL available to handlers (e.g. /health, /auth/rotate)
    deps.tunnelUrl = tunnel.publicUrl

    // ─── R2: Global error traps ──────────────────────────────────────────
    // Never write to stdout/stderr — the OpenCode TUI renders those as red
    // noise. Write to audit log + logger only.
    process.on("uncaughtException", (err: Error) => {
      audit.log("process.uncaughtException", { error: err.message, stack: err.stack })
      logger.error("Uncaught exception", { error: err.message })
      eventBus.emit({
        type: "pilot.error",
        properties: { kind: "uncaughtException", message: err.message, timestamp: Date.now() },
      })
      // Do NOT exit — let the process continue
    })

    process.on("unhandledRejection", (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason)
      audit.log("process.unhandledRejection", { error: message })
      logger.error("Unhandled rejection", { error: message })
      eventBus.emit({
        type: "pilot.error",
        properties: { kind: "unhandledRejection", message, timestamp: Date.now() },
      })
      // Do NOT exit
    })

    // ─── Graceful shutdown ───────────────────────────────────────────────
    const disposables: Array<() => void | Promise<void>> = [
      () => server.stop(),
      () => tunnel.stop(),
      () => telegram.stop(),
      () => clearState(ctx.directory),
    ]

    async function shutdown(): Promise<void> {
      for (const d of disposables.reverse()) {
        try {
          await d()
        } catch {}
      }
    }

    process.once("SIGINT", () => void shutdown())
    process.once("SIGTERM", () => void shutdown())
    process.once("exit", () => void shutdown())

    // ─── Logging ─────────────────────────────────────────────────────────
    await ctx.client.app.log({
      body: {
        service: "opencode-pilot",
        level: "info",
        message: `Remote control active on ${config.host}:${config.port}`,
        extra: { token: currentToken },
      },
    })

    if (config.tunnel !== "off") {
      if (tunnel.publicUrl) {
        await ctx.client.app.log({
          body: {
            service: "opencode-pilot",
            level: "info",
            message: `Tunnel (${tunnel.provider}) active at ${tunnel.publicUrl}`,
          },
        })
      } else {
        await ctx.client.app.log({
          body: {
            service: "opencode-pilot",
            level: "warn",
            message: `Tunnel provider ${config.tunnel} requested but unavailable (binary not found or failed to start)`,
          },
        })
      }
    }

    // ─── Banner & QR ─────────────────────────────────────────────────────
    const localUrl = `http://${config.host}:${config.port}`
    await writeBanner({
      localUrl,
      publicUrl: tunnel.publicUrl,
      token: currentToken,
      directory: ctx.directory,
    })

    // Send Telegram startup notification (fire and forget)
    const dashboardUrl = `${tunnel.publicUrl ?? localUrl}/?token=${currentToken}`
    telegram
      .sendStartup(dashboardUrl)
      .catch((err) => audit.log("telegram.send_failed", { error: String(err), kind: "startup" }))

    // Notify TUI that the server is up
    ctx.client.tui
      .showToast({
        body: {
          title: "🎮 OpenCode Pilot",
          message: `Remote control active on port ${config.port}. Use /remote-control for details.`,
          variant: "success",
          duration: 5000,
        },
      })
      .catch(() => {})

    // ─── Hooks ───────────────────────────────────────────────────────────
    const sessionBusyStart = new Map<string, number>()
    const eventHook = createEventHook(
      notifications,
      sessionBusyStart,
      ctx.client,
      audit,
    )
    const permissionAskHook = createPermissionAskHook(
      notifications,
      permissionQueue,
      audit,
    )
    const toolHooks = createToolHooks(notifications)

    return {
      event: eventHook,
      "permission.ask": permissionAskHook,
      "tool.execute.before": async (input, output) =>
        toolHooks.handleToolBefore(input, {
          args: (output?.args ?? {}) as Record<string, unknown>,
        }),
      "tool.execute.after": async (input, output) =>
        toolHooks.handleToolAfter(
          { ...input, args: input.args as Record<string, unknown> | undefined },
          output,
        ),
    }
  }) satisfies Plugin,
}
