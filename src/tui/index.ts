import type { TuiPlugin, TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import type { PluginOptions } from "@opencode-ai/plugin"
import { join } from "path"
import { existsSync, readFileSync } from "fs"

// ─── State file reader ───────────────────────────────────────────────────────

interface PilotState {
  token: string
  port: number
  host: string
  startedAt: number
  pid: number
}

function readPilotState(dir: string): PilotState | null {
  const statePath = join(dir, ".opencode", "pilot-state.json")
  if (!existsSync(statePath)) return null
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as PilotState
  } catch {
    return null
  }
}

function readBanner(dir: string): string | null {
  const bannerPath = join(dir, ".opencode", "pilot-banner.txt")
  if (!existsSync(bannerPath)) return null
  try {
    return readFileSync(bannerPath, "utf-8")
  } catch {
    return null
  }
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
    onSelect: (api: TuiPluginApi) => {
      const dir = process.cwd()
      const state = readPilotState(dir)

      if (state) {
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

      api.ui.toast({
        title: "OpenCode Pilot",
        message: "Remote control server not running or token not yet available",
        variant: "warning",
        duration: 5000,
      })
    },
  },
  {
    title: "Pilot Token",
    value: "pilot-token",
    description: "Show the full remote control auth token for connecting",
    category: "Pilot",
    slash: { name: "pilot-token" },
    onSelect: (api: TuiPluginApi) => {
      const dir = process.cwd()
      const state = readPilotState(dir)

      if (state) {
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

      api.ui.toast({
        title: "Pilot Token",
        message: "Token not available. Check that the server plugin is loaded.",
        variant: "warning",
        duration: 5000,
      })
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
  id: "opencode-pilot",
  tui,
}
