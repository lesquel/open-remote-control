import { describe, expect, test } from "bun:test"
import { diagnosticsCopyPayload, renderDiagnostics } from "../modals/diagnostics-view.js"

function snapshot(): Record<string, unknown> {
  return {
    pilot: { version: "1.2.3", uptimeSeconds: 42, runtime: { name: "Bun", version: "1.0" } },
    listener: { host: "127.0.0.1", port: 26335, tunnel: { provider: "off", status: "disabled" } },
    authentication: { kind: "device", role: "operator", deviceId: "device-1" },
    runtime: {
      sdk: { status: "ok", version: null },
      sseClients: 2,
      pendingPermissions: 1,
      sessions: { total: 5, active: 2 },
      integrations: ["opencode", "codex"],
      notifications: { telegram: false, push: true, pushSubscriptions: 1 },
      devices: { total: 2 },
    },
    recentErrors: [],
  }
}

describe("diagnostics view", () => {
  test("renders the operational snapshot without raw object placeholders", () => {
    const html = renderDiagnostics(snapshot(), { connected: true })
    expect(html).toContain("Connected")
    expect(html).toContain("127.0.0.1:26335")
    expect(html).toContain("opencode, codex")
    expect(html).toContain("No recent errors")
    expect(html).not.toContain("[object Object]")
    expect(html).not.toContain("undefined")
  })

  test("renders provider-specific capabilities instead of assuming parity", () => {
    const html = renderDiagnostics(snapshot(), {
      integrations: [
        { id: "opencode", displayName: "OpenCode", capabilities: { sessions: true, streaming: true } },
        { id: "codex", displayName: "Codex", capabilities: { sessions: false, permissions: true, tools: true } },
      ],
    })
    expect(html).toContain("OpenCode")
    expect(html).toContain("sessions, streaming")
    expect(html).toContain("Codex")
    expect(html).toContain("permissions, tools")
  })

  test("escapes diagnostic error text before rendering", () => {
    const data = snapshot()
    data.recentErrors = [{ component: '<img src=x onerror="boom">', message: "<script>alert(1)</script>" }]
    const html = renderDiagnostics(data)
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<img")
  })

  test("copies only the server diagnostics and minimal connection state", () => {
    const payload = diagnosticsCopyPayload(snapshot(), { connected: true })
    expect(payload).toContain('"diagnostics"')
    expect(payload).toContain('"connected": true')
    expect(payload).not.toContain("activeSession")
    expect(payload).not.toContain("last_assistant_message")
    expect(payload).not.toContain("active_directory")
  })
})
