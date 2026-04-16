import type { Plugin } from "@opencode-ai/plugin"
import { loadConfigSafe } from "./config"
import { generateToken } from "./util/auth"
import { createAuditLog } from "./services/audit"
import { createEventBus } from "./services/event-bus"
import { createPermissionQueue } from "./services/permission-queue"
import { createTelegramBot } from "./services/telegram"
import { startTunnel } from "./services/tunnel"
import { writeState, clearState } from "./services/state"
import { writeBanner } from "./services/banner"
import { createNotificationService } from "./services/notifications"
import { createRemoteServer } from "./http/server"
import { createEventHook, createPermissionAskHook, createToolHooks } from "./hooks"

export default {
  id: "opencode-pilot",
  server: (async (ctx) => {
    const config = loadConfigSafe(process.env, (msg) => {
      ctx.client.app
        .log({ body: { service: "opencode-pilot", level: "warn", message: msg } })
        .catch(() => {})
    })

    const token = generateToken()
    const audit = createAuditLog(ctx)
    const eventBus = createEventBus()
    const permissionQueue = createPermissionQueue(config.permissionTimeoutMs)
    const telegram = createTelegramBot(config.telegram, permissionQueue)

    const notifications = createNotificationService(eventBus, telegram, audit)

    const server = createRemoteServer({
      client: ctx.client,
      project: ctx.project,
      directory: ctx.directory,
      worktree: ctx.worktree,
      config,
      token,
      audit,
      eventBus,
      permissionQueue,
    })

    server.start()

    writeState(ctx.directory, {
      token,
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
        extra: { token },
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
      token,
      directory: ctx.directory,
    })

    // Send Telegram startup notification (fire and forget)
    const dashboardUrl = `${tunnel.publicUrl ?? localUrl}/?token=${token}`
    telegram.sendStartup(dashboardUrl).catch(() => {})

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
      "tool.execute.before": async (input) => toolHooks.handleToolBefore(input),
      "tool.execute.after": async (input, output) =>
        toolHooks.handleToolAfter(input, output),
    }
  }) satisfies Plugin,
}
