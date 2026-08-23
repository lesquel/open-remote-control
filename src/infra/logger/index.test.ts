import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createLogger } from "./index"

describe("createLogger redaction", () => {
  test("redacts structured extras before handing them to OpenCode", async () => {
    const bodies: unknown[] = []
    const client = {
      app: {
        log: async (input: { body: unknown }) => {
          bodies.push(input.body)
          return { data: {}, error: null }
        },
      },
    } as unknown as PluginInput["client"]

    createLogger(client, "test").info("connected Bearer message-secret", {
      authorization: "Bearer secret-token",
      endpoint: "https://push.example.com/device/opaque?token=value",
    })
    await Promise.resolve()

    expect(JSON.stringify(bodies)).not.toContain("secret-token")
    expect(JSON.stringify(bodies)).not.toContain("message-secret")
    expect(JSON.stringify(bodies)).not.toContain("opaque")
    expect(bodies).toEqual([{
      service: "test",
      level: "info",
      message: "connected Bearer [REDACTED]",
      extra: {
        authorization: "[REDACTED]",
        endpoint: "https://push.example.com/[REDACTED]?[REDACTED]",
      },
    }])
  })

  test("keeps a bounded redacted local error snapshot for diagnostics", () => {
    const client = { app: { log: async () => ({ data: {}, error: null }) } } as unknown as PluginInput["client"]
    const logger = createLogger(client, "test")
    for (let index = 0; index < 25; index += 1) {
      logger.error(`failure ${index} Bearer secret-${index}`, { token: `secret-${index}` })
    }
    const errors = logger.recentErrors?.() ?? []
    expect(errors).toHaveLength(20)
    expect(JSON.stringify(errors)).not.toContain("secret-24")
    expect(String(errors.at(-1)?.message)).toContain("failure 24")
  })
})
