import type { Plugin } from "@opencode-ai/plugin"
import { loadConfigSafe, mergeStoredSettings, resolveSources } from "./config"
import { loadDotEnv } from "./util/dotenv"
import { generateToken } from "./util/auth"
import { createAuditLog } from "./services/audit"
import { getSharedEventBus } from "./services/event-bus"
import { createPermissionQueue } from "./services/permission-queue"
import { createTelegramBot } from "./services/telegram"
import { createPushService } from "./services/push"
import { createSettingsStore } from "./services/settings-store"
import { startTunnel } from "./services/tunnel"
import { writeState, clearState, globalStatePath } from "./services/state"
import { existsSync } from "fs"
import { writeBanner } from "./services/banner"
import { createNotificationService } from "./services/notifications"
import { createRemoteServer } from "./http/server"
import { createEventHook, createPermissionAskHook, createToolHooks } from "./hooks"
import { createLogger } from "./util/logger"
import { PILOT_VERSION, TOAST_DURATION_MS, TOAST_PROMOTION_DURATION_MS, PROMOTION_POLL_INTERVAL_MS } from "./constants"

export default {
  id: "opencode-pilot",
  server: (async (ctx) => {
    // Boot marker — logged before anything else. If this line is missing from
    // OpenCode's log panel after a restart, the plugin didn't load at all
    // (check `~/.config/opencode/opencode.json::plugin` and the package cache
    // at `~/.cache/opencode/packages/@lesquel/opencode-pilot@latest/`). If it
    // IS present but nothing else from opencode-pilot appears, activation
    // crashed silently — something in the 15 or so lines below is throwing.
    // Issue #1 (open-remote-control) would have been 10x faster to diagnose
    // with this log in place.
    await ctx.client.app
      .log({
        body: {
          service: "opencode-pilot",
          level: "info",
          message: `Plugin loading — version ${PILOT_VERSION}, pid ${process.pid}, directory ${ctx.directory ?? "<none>"}`,
        },
      })
      .catch(() => {})

    // Snapshot the shell environment BEFORE .env and settings-store touch
    // process.env. This is what tells us which variables came from the user's
    // shell (highest priority) vs layered overlays.
    const shellEnv: NodeJS.ProcessEnv = { ...process.env }

    // OpenCode does not auto-load the plugin's .env into process.env, so we
    // do it ourselves before reading config. Variables already set in the
    // shell environment win over .env values.
    const dotenv = loadDotEnv()
    if (dotenv.loaded) {
      ctx.client.app
        .log({
          body: {
            service: "opencode-pilot",
            level: "info",
            message: `Loaded .env from ${dotenv.loaded} (${dotenv.applied.length} vars)`,
          },
        })
        .catch(() => {})
    }

    const logger = createLogger(ctx.client, "opencode-pilot")

    // Load persistent settings from ~/.opencode-pilot/config.json and merge
    // them into the env snapshot, respecting shell-env as the top priority.
    const settingsStore = createSettingsStore({ logger })
    const storedSettings = settingsStore.load()
    const mergedEnv = mergeStoredSettings(process.env, shellEnv, storedSettings)

    const config = loadConfigSafe(mergedEnv, (msg) => {
      ctx.client.app
        .log({ body: { service: "opencode-pilot", level: "warn", message: msg } })
        .catch(() => {})
    })

    let currentToken = generateToken()
    const audit = createAuditLog(ctx)
    // Shared across ALL plugin factory invocations in this process. See
    // getSharedEventBus() docs — this is the real fix for the "dashboard
    // shows pilot.connected then nothing" bug that survived v1.14 → v1.16.8.
    const eventBus = getSharedEventBus()
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
      settingsStore,
      shellEnv,
      envFileApplied: dotenv.applied,
    }

    if (config.vapid == null) {
      logger.warn(
        "Web Push is not configured. Set PILOT_VAPID_PUBLIC_KEY and PILOT_VAPID_PRIVATE_KEY — or use Settings > Plugin configuration > Generate VAPID keys.",
      )
    }
    if (config.telegram == null) {
      logger.warn(
        "Telegram notifications disabled. Set PILOT_TELEGRAM_TOKEN and PILOT_TELEGRAM_CHAT_ID to enable.",
      )
    }

    const server = createRemoteServer(deps)

    // Promotion model:
    //
    //  - At boot, try to bind the HTTP port.
    //  - If we get it → "primary": HTTP server + tunnel + banner + state + toast.
    //  - If EADDRINUSE → "passive": skip all of the above, register hooks only.
    //    Secondary windows are passive so OpenCode keeps working without
    //    fighting the primary for port 4097. The dashboard has multi-project
    //    tabs so the existing primary already sees this workspace.
    //  - A passive instance polls the port every 5s. If the primary goes away
    //    (user closed that terminal, crash, etc.), the first passive instance
    //    to re-bind promotes itself and takes over the tunnel, state, banner,
    //    and toast. This is what restores `/remote` on the surviving window
    //    after the original one is closed.
    //
    // `role` is mutable because a passive instance can become primary later.
    let role: "primary" | "passive" = "passive"
    let tunnel: { publicUrl: string | null; provider: string; stop: () => void } = {
      publicUrl: null,
      provider: "off",
      stop: () => {},
    }
    let promotionTimer: ReturnType<typeof setInterval> | null = null

    async function activatePrimary(isPromotion: boolean): Promise<void> {
      role = "primary"
      const writeResult = writeState(ctx.directory, {
        token: currentToken,
        port: config.port,
        host: config.host,
        startedAt: Date.now(),
        pid: process.pid,
      })

      // Observability for issue #1 (open-remote-control): before 1.13.13,
      // writeState swallowed every error silently. If both the project-scoped
      // .opencode/pilot-state.json AND the global ~/.opencode-pilot/pilot-state.json
      // failed to materialize, the server happily bound the port but the TUI
      // slash commands reported "Remote control server not running". Surfacing
      // the failure here (via the OpenCode log panel) turns an invisible bug
      // into a diagnosable one.
      if (!writeResult.global.ok) {
        await ctx.client.app
          .log({
            body: {
              service: "opencode-pilot",
              level: "error",
              message:
                `CRITICAL: could not write pilot-state.json to ${writeResult.global.path} — ` +
                `TUI slash commands (/remote, /pilot-token, /remote-control) will report ` +
                `the server as not running. Error: ${writeResult.global.error}. ` +
                `Fix the permissions on ~/.opencode-pilot/ and restart OpenCode.`,
            },
          })
          .catch(() => {})
      } else if (!existsSync(writeResult.global.path)) {
        // Belt-and-suspenders: writeOne reported ok:true, but the file is not
        // on disk. This can happen with exotic filesystems (overlays, tmpfs
        // with quotas, NFS misconfig). Surface it so the user can debug.
        await ctx.client.app
          .log({
            body: {
              service: "opencode-pilot",
              level: "error",
              message:
                `CRITICAL: writeState() returned ok but ${writeResult.global.path} is missing ` +
                `on disk. Filesystem may have quota/overlay issues. TUI commands will fail.`,
            },
          })
          .catch(() => {})
      }

      if (writeResult.project && !writeResult.project.ok) {
        // Not critical — TUI reads the global file. Logged as a warning so
        // the user can still investigate if they care about the project-scoped
        // copy (tooling that reads `.opencode/pilot-state.json`).
        await ctx.client.app
          .log({
            body: {
              service: "opencode-pilot",
              level: "warn",
              message:
                `Project-scoped state file ${writeResult.project.path} not written ` +
                `(${writeResult.project.error}) — using global ${globalStatePath()} only.`,
            },
          })
          .catch(() => {})
      }

      tunnel = await startTunnel({
        provider: config.tunnel,
        port: config.port,
      })
      deps.tunnelUrl = tunnel.publicUrl

      const localUrl = `http://${config.host}:${config.port}`
      await writeBanner({
        localUrl,
        publicUrl: tunnel.publicUrl,
        token: currentToken,
        directory: ctx.directory,
      })

      await ctx.client.app
        .log({
          body: {
            service: "opencode-pilot",
            level: "info",
            message: `Remote control active on ${config.host}:${config.port}`,
            extra: { token: currentToken },
          },
        })
        .catch(() => {})

      if (config.tunnel !== "off") {
        await ctx.client.app
          .log({
            body: {
              service: "opencode-pilot",
              level: tunnel.publicUrl ? "info" : "warn",
              message: tunnel.publicUrl
                ? `Tunnel (${tunnel.provider}) active at ${tunnel.publicUrl}`
                : `Tunnel provider ${config.tunnel} requested but unavailable`,
            },
          })
          .catch(() => {})
      }

      const dashboardUrl = `${tunnel.publicUrl ?? localUrl}/?token=${currentToken}`
      telegram
        .sendStartup(dashboardUrl)
        .catch((err) => audit.log("telegram.send_failed", { error: String(err), kind: "startup" }))

      ctx.client.tui
        .showToast({
          body: {
            title: isPromotion ? "🎮 OpenCode Pilot — promoted" : "🎮 OpenCode Pilot",
            message: isPromotion
              ? `Previous primary window closed. This window now hosts the dashboard on port ${config.port}.`
              : `Remote control active on port ${config.port}. Use /remote-control for details.`,
            variant: "success",
            duration: isPromotion ? TOAST_PROMOTION_DURATION_MS : TOAST_DURATION_MS,
          },
        })
        .catch(() => {})
    }

    function startPromotionWatcher(): void {
      if (promotionTimer) return
      let promotingNow = false
      promotionTimer = setInterval(async () => {
        if (role === "primary") {
          if (promotionTimer) clearInterval(promotionTimer)
          promotionTimer = null
          return
        }
        if (promotingNow) return
        // Quick retry: if we can bind the port now, the primary is gone and
        // we take over. server.start() returns { ok: false } with no side
        // effects if the port is still taken — safe to poll.
        const result = server.start()
        if (result.ok) {
          audit.log("boot.promoted", { port: config.port })
          if (promotionTimer) clearInterval(promotionTimer)
          promotionTimer = null
          promotingNow = true
          try {
            await activatePrimary(true)
          } catch (err) {
            logger.warn("promotion failed", { error: err instanceof Error ? err.message : String(err) })
          } finally {
            promotingNow = false
          }
        }
      }, PROMOTION_POLL_INTERVAL_MS)
    }

    // ─── Initial boot: try to become primary ───────────────────────────────
    const bindResult = server.start()

    if (bindResult.ok) {
      await activatePrimary(false)
    } else {
      audit.log("boot.passive", {
        reason: bindResult.reason,
        port: config.port,
      })
      await ctx.client.app
        .log({
          body: {
            service: "opencode-pilot",
            level: "info",
            message:
              `Another OpenCode instance owns port ${config.port}. ` +
              `This window runs in passive mode; it will auto-promote if the ` +
              `primary goes away. In the meantime use the existing dashboard. ` +
              `Passive mode: remote-facing hooks disabled. This instance will take over if primary on port ${config.port} goes down.`,
          },
        })
        .catch(() => {})
      ctx.client.tui
        .showToast({
          body: {
            title: "OpenCode Pilot — passive mode",
            message:
              `Port ${config.port} already in use by another OpenCode window. ` +
              `Use /remote to open that dashboard. This window will auto-promote ` +
              `if you close the other one.`,
            variant: "info",
            duration: 7000,
          },
        })
        .catch(() => {})
      startPromotionWatcher()
    }

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
    // Shutdown reads `role` at the moment it runs, not at boot — so a
    // passive instance that got promoted correctly tears down the server,
    // tunnel, and state it started. clearState only runs when we're the
    // primary at shutdown; deleting the global state file from a passive
    // instance would blind every other window.
    async function shutdown(): Promise<void> {
      if (promotionTimer) {
        clearInterval(promotionTimer)
        promotionTimer = null
      }
      try { telegram.stop() } catch {}
      if (role === "primary") {
        try { tunnel.stop() } catch {}
        try { server.stop() } catch {}
        try { clearState(ctx.directory) } catch {}
      }
    }

    process.once("SIGINT", () => void shutdown())
    process.once("SIGTERM", () => void shutdown())
    process.once("exit", () => void shutdown())

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

    // Role-aware gating, narrowly scoped:
    //
    // Only `permission.ask` needs the passive short-circuit, because that hook
    // BLOCKS waiting for a remote response — a passive instance with no HTTP
    // server, no dashboard, and no SSE clients would hang for the full
    // permissionTimeoutMs (5 minutes default) before the TUI fallback kicks in.
    //
    // `event`, `tool.execute.before`, and `tool.execute.after` are
    // fire-and-forget: they forward telemetry to the local event bus and
    // return immediately. A passive instance calling `eventBus.emit(...)`
    // with no connected clients is a safe no-op (the loop just walks an empty
    // Set). Gating these three like v1.15.0 did had a severe side effect:
    // when the plugin boots as passive for ANY reason (stale port from a
    // previous process, multi-window startup order), NO SDK events ever
    // reached the SSE bus — including on the instance that the dashboard
    // was actually connected to if its role snapshot was out of date. That
    // looked exactly like "dashboard never updates without reload" and
    // consumed four release cycles before the audit caught it.
    return {
      event: async (input) => {
        // Unconditional server-side marker. Goes to OpenCode's log panel
        // (stderr). Lets us confirm in seconds whether the SDK is actually
        // firing the `event` hook with SDK events (message.part.delta,
        // message.updated, etc) or if the plugin is receiving nothing.
        try {
          console.error(`[pilot:event-hook] ${input?.event?.type ?? 'unknown'} clients=${eventBus.clientCount()}`)
        } catch (_) {}
        return eventHook(input)
      },
      "permission.ask": async (input, output) => {
        if (role === "passive") return
        return permissionAskHook(input, output)
      },
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
