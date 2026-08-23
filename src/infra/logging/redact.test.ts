import { describe, expect, test } from "bun:test"
import { redactSecrets } from "./redact"

describe("redactSecrets", () => {
  test("redacts nested credential keys and bearer values", () => {
    const result = redactSecrets({
      hookToken: "hook-secret",
      nested: {
        authorization: "Bearer abc123",
        vapidPrivateKey: "private",
        telegramToken: "telegram",
        safe: "Bearer leaked-value",
        tokenCount: 42,
        tokens: { input: 10, output: 20 },
      },
    })

    expect(result).toEqual({
      hookToken: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        vapidPrivateKey: "[REDACTED]",
        telegramToken: "[REDACTED]",
        safe: "Bearer [REDACTED]",
        tokenCount: 42,
        tokens: { input: 10, output: 20 },
      },
    })
  })

  test("removes credentials, paths, queries, and fragments from URLs", () => {
    expect(redactSecrets("https://user:pass@push.example.com/private/token?key=value#frag"))
      .toBe("https://push.example.com/[REDACTED]?[REDACTED]")
  })

  test("bounds cyclic, deep, large, and long values", () => {
    const cyclic: Record<string, unknown> = { text: "x".repeat(3_000) }
    cyclic.self = cyclic
    let deep: Record<string, unknown> = cyclic
    for (let index = 0; index < 10; index += 1) deep = { child: deep }

    const serialized = JSON.stringify(redactSecrets(deep))
    expect(serialized).toContain("[MAX_DEPTH]")
    expect(serialized.length).toBeLessThan(3_000)
  })
})
