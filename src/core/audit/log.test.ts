import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAuditLog } from "./log"

describe("createAuditLog redaction", () => {
  test("redacts disk and OpenCode log payloads at the boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pilot-audit-redaction-"))
    mkdirSync(join(directory, ".opencode"))
    const appBodies: unknown[] = []
    const ctx = {
      directory,
      client: {
        app: {
          log: async (input: { body: unknown }) => {
            appBodies.push(input.body)
            return { data: {}, error: null }
          },
        },
      },
    } as unknown as PluginInput

    createAuditLog(ctx).log("push.subscribed", {
      hookToken: "secret-hook-token",
      endpoint: "https://push.example.com/device/opaque?key=value",
    })
    await Promise.resolve()

    const disk = readFileSync(join(directory, ".opencode", "pilot-audit.log"), "utf8")
    const combined = `${disk}\n${JSON.stringify(appBodies)}`
    expect(combined).not.toContain("secret-hook-token")
    expect(combined).not.toContain("opaque")
    expect(combined).toContain("[REDACTED]")
  })
})
