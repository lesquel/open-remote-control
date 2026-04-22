import type { TuiPlugin, TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import type { PluginOptions } from "@opencode-ai/plugin"
import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { isServerAlive, probeHealth, defaultProbeTarget, type HealthProbe } from "./liveness"
import { buildDashboardUrl } from "./url-builder"

// ─── State file reader ───────────────────────────────────────────────────────

interface PilotState {
  token: string
  port: number
  host: string
  startedAt: number
  /** PID of the primary pilot server process. Present as of 1.13.11. */
  pid?: number
}

// Search order for the state/banner files:
//   1. The current project's .opencode/ folder (process.cwd())
//   2. The global fallback at ~/.opencode-pilot/
//
// The global path is what the server writes unconditionally. The project
// path is a nice-to-have for workspaces that have an .opencode/ folder.
// Previously the TUI only checked (1), and since fresh workspaces like
// ~/Desktop don't have .opencode/, the TUI always reported "Remote
// control server not running or token not yet available" — even when
// the server was perfectly healthy.
function globalDir(): string {
  return join(homedir(), ".opencode-pilot")
}

function readFirst<T>(paths: string[], parse: (raw: string) => T): T | null {
  for (const path of paths) {
    if (!existsSync(path)) continue
    try {
      return parse(readFileSync(path, "utf-8"))
    } catch {
      // try next path
    }
  }
  return null
}

function readPilotState(dir: string): PilotState | null {
  return readFirst(
    [
      join(dir, ".opencode", "pilot-state.json"),
      join(globalDir(), "pilot-state.json"),
    ],
    (raw) => JSON.parse(raw) as PilotState,
  )
}

function readBanner(dir: string): string | null {
  return readFirst(
    [
      join(dir, ".opencode", "pilot-banner.txt"),
      join(globalDir(), "pilot-banner.txt"),
    ],
    (raw) => raw,
  )
}

// ─── No-state-file fallback (issue #1) ───────────────────────────────────────
// Before 1.13.13 the three slash commands collapsed three very different
// scenarios into the same "server not running" toast. Now we probe the
// default host:port and return an actionable diagnosis.

interface MissingStateToast {
  title: string
  message: string
  variant: "warning" | "error"
  duration: number
}

function diagnoseMissingState(probe: HealthProbe, title: string): MissingStateToast {
  const statePath = join(globalDir(), "pilot-state.json")
  if (probe.kind === "pilot") {
    return {
      title,
      message: [
        `Pilot server is responding on ${probe.host}:${probe.port}`,
        `(version ${probe.version ?? "unknown"}), but the state file at`,
        `${statePath} is missing.`,
        ``,
        `This is usually a cache or permissions problem. Try:`,
        `  1. Fully quit OpenCode.`,
        `  2. rm -rf ~/.cache/opencode/packages/@lesquel/opencode-pilot*`,
        `  3. bunx @lesquel/opencode-pilot@latest init`,
        `  4. Reopen OpenCode.`,
      ].join("\n"),
      variant: "error",
      duration: 15000,
    }
  }
  if (probe.kind === "other") {
    return {
      title,
      message: [
        `Something is listening on ${probe.host}:${probe.port},`,
        `but it is not the pilot server (HTTP ${probe.status}, unknown /health shape).`,
        ``,
        `Identify it with:  ss -tulpn | grep :${probe.port}`,
        `Then stop that process or set PILOT_PORT to a free port.`,
      ].join("\n"),
      variant: "error",
      duration: 12000,
    }
  }
  // probe.kind === "none"
  return {
    title,
    message: [
      `Remote control server not running.`,
      ``,
      `Nothing is listening on ${probe.host}:${probe.port} and no state file`,
      `was found at ${statePath}.`,
      ``,
      `Check that the plugin is enabled in ~/.config/opencode/opencode.json`,
      `and that OpenCode has been restarted since running bunx init.`,
    ].join("\n"),
    variant: "warning",
    duration: 10000,
  }
}

async function diagnoseAndToast(api: TuiPluginApi, title: string): Promise<void> {
  const { host, port } = defaultProbeTarget()
  const probe = await probeHealth(host, port)
  const toast = diagnoseMissingState(probe, title)
  api.ui.toast({
    title: toast.title,
    message: toast.message,
    variant: toast.variant,
    duration: toast.duration,
  })
}

// ─── Command definitions ─────────────────────────────────────────────────────

const commands = [
  {
    title: "Remote Control",
    value: "remote-control",
    description: "Show OpenCode Pilot remote control status and connection info",
    category: "Pilot",
    suggested: true,
    slash: { name: "remote-control", aliases: ["pilot", "rc"] },
    onSelect: async (api: TuiPluginApi) => {
      const dir = process.cwd()
      const state = readPilotState(dir)

      if (state) {
        if (!(await isServerAlive(state))) {
          api.ui.toast({
            title: "OpenCode Pilot",
            message:
              "Pilot server not running — start OpenCode again or wait for another instance to take over.",
            variant: "warning",
            duration: 7000,
          })
          return
        }

        const url = `http://${state.host}:${state.port}`
        const banner = readBanner(dir)

        if (banner) {
          api.ui.toast({
            title: "OpenCode Pilot — Remote Control",
            message: banner,
            variant: "success",
            duration: 15000,
          })
        } else {
          api.ui.toast({
            title: "OpenCode Pilot — Remote Control",
            message: [
              `Status: ACTIVE`,
              `URL: ${url}`,
              `Token: ${state.token.slice(0, 12)}...`,
              ``,
              `Use /pilot-token for full token and curl examples`,
            ].join("\n"),
            variant: "success",
            duration: 8000,
          })
        }
        return
      }

      await diagnoseAndToast(api, "OpenCode Pilot — Remote Control")
    },
  },
  {
    title: "Pilot Token",
    value: "pilot-token",
    description: "Show the full remote control auth token for connecting",
    category: "Pilot",
    slash: { name: "pilot-token" },
    onSelect: async (api: TuiPluginApi) => {
      const dir = process.cwd()
      const state = readPilotState(dir)

      if (state) {
        if (!(await isServerAlive(state))) {
          api.ui.toast({
            title: "Pilot Token",
            message:
              "Pilot server not running — start OpenCode again or wait for another instance to take over.",
            variant: "warning",
            duration: 7000,
          })
          return
        }

        const url = `http://${state.host}:${state.port}`
        api.ui.toast({
          title: "Pilot Auth Token",
          message: [
            `Token: ${state.token}`,
            ``,
            `curl -H "Authorization: Bearer ${state.token}" ${url}/status`,
            ``,
            `SSE: ${url}/events?token=${state.token}`,
          ].join("\n"),
          variant: "info",
          duration: 15000,
        })
        return
      }

      await diagnoseAndToast(api, "Pilot Token")
    },
  },
  {
    title: "Open Dashboard",
    value: "remote",
    description: "Open the OpenCode Pilot dashboard in the default browser",
    category: "Pilot",
    suggested: true,
    slash: { name: "remote", aliases: ["dashboard"] },
    onSelect: async (api: TuiPluginApi) => {
      const dir = process.cwd()
      const state = readPilotState(dir)

      if (!state) {
        await diagnoseAndToast(api, "OpenCode Pilot — Dashboard")
        return
      }

      if (!(await isServerAlive(state))) {
        api.ui.toast({
          title: "OpenCode Pilot — Dashboard",
          message:
            "Pilot server not running — start OpenCode again or wait for another instance to take over.",
          variant: "error",
          duration: 7000,
        })
        return
      }

      const rawUrl = `http://${state.host}:${state.port}/?token=${state.token}`
      const url = buildDashboardUrl(rawUrl, dir)

      // Platform-specific open command. Skipped when PILOT_NO_AUTO_OPEN=1.
      if (process.env.PILOT_NO_AUTO_OPEN === "1") {
        api.ui.toast({
          title: "OpenCode Pilot — Dashboard",
          message: `Dashboard URL:\n\n${url}`,
          variant: "info",
          duration: 15000,
        })
        return
      }

      let cmd: string[]
      if (process.platform === "darwin") {
        cmd = ["open", url]
      } else if (process.platform === "win32") {
        // `start` needs an empty title arg to handle URLs with special chars safely
        cmd = ["cmd", "/c", "start", "", url]
      } else {
        cmd = ["xdg-open", url]
      }

      try {
        const proc = Bun.spawn({
          cmd,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        })
        proc.unref()
        const exitCode = await Promise.race([
          proc.exited,
          new Promise<number>((resolve) => setTimeout(() => resolve(0), 1500)),
        ])
        if (exitCode !== 0) {
          throw new Error(`exit code ${exitCode}`)
        }

        api.ui.toast({
          title: "OpenCode Pilot — Dashboard",
          message: "Dashboard opened in browser",
          variant: "success",
          duration: 4000,
        })
      } catch {
        api.ui.toast({
          title: "OpenCode Pilot — Dashboard",
          message: [
            `Could not launch browser. Open this URL manually:`,
            ``,
            url,
          ].join("\n"),
          variant: "warning",
          duration: 15000,
        })
      }
    },
  },
]

// ─── Event type for pilot events coming over the TUI event bus ───────────────

interface PilotPermissionPendingEvent {
  sessionID?: string
  tool?: string
}

interface PilotClientEvent {
  clientID?: string
  ip?: string
}

// ─── TUI plugin ──────────────────────────────────────────────────────────────

const tui: TuiPlugin = async (
  api: TuiPluginApi,
  _options: PluginOptions | undefined,
  _meta: TuiPluginMeta,
) => {
  // Register slash commands
  api.command.register(() =>
    commands.map((cmd) => ({
      title: cmd.title,
      value: cmd.value,
      description: cmd.description,
      category: cmd.category,
      suggested: "suggested" in cmd ? cmd.suggested : undefined,
      slash: cmd.slash,
      onSelect: () => cmd.onSelect(api),
    })),
  )

  // The event bus is typed against the SDK Event union, so we cast to bypass
  // the type constraint for custom pilot events.
  const eventBus = api.event as unknown as {
    on: (type: string, handler: (event: unknown) => void) => () => void
  }

  eventBus.on("pilot.permission.pending", (event: unknown) => {
    const e = event as PilotPermissionPendingEvent
    const label = e.tool ? `Tool: ${e.tool}` : "A tool requires approval"
    api.ui.toast({
      title: "Pilot — Permission Request",
      message: `${label}${e.sessionID ? ` (session: ${e.sessionID.slice(0, 8)}…)` : ""}`,
      variant: "warning",
      duration: 8000,
    })
  })

  eventBus.on("pilot.client.connected", (event: unknown) => {
    const e = event as PilotClientEvent
    api.ui.toast({
      title: "Pilot — Client Connected",
      message: `Remote client connected${e.ip ? ` from ${e.ip}` : ""}`,
      variant: "success",
      duration: 4000,
    })
  })

  eventBus.on("pilot.client.disconnected", (_event: unknown) => {
    api.ui.toast({
      title: "Pilot — Client Disconnected",
      message: "Remote client disconnected",
      variant: "info",
      duration: 3000,
    })
  })

  // Startup confirmation
  api.ui.toast({
    title: "OpenCode Pilot",
    message: "Remote control plugin loaded. Use /pilot or /pilot-token.",
    variant: "success",
    duration: 3000,
  })
}

export default {
  // Distinct id from the server plugin's "opencode-pilot" id. OpenCode loads
  // server and tui modules separately; sharing an id can cause one of them
  // to be silently overwritten or skipped depending on load order.
  id: "opencode-pilot-tui",
  tui,
}
