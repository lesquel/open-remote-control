// Tests for Telegram bot — focused on queue resolution behaviour.
// handleCallbackQuery is internal; we test via the polling loop with mocked fetch.
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { createPermissionQueue } from "../../../core/permissions/queue"
import { createTelegramBot } from "./index"

// Minimal callback_query update that simulates Telegram sending "allow: permId"
function makeCallbackUpdate(action: "allow" | "deny", permId: string, updateId = 1) {
  return {
    update_id: updateId,
    callback_query: {
      id: "cq-id-1",
      data: `${action}:${permId}`,
      from: { id: 999 },
      message: {
        chat: { id: 12345 },
        message_id: 42,
        text: "Permission Request",
      },
    },
  }
}

describe("createTelegramBot — codexPermissionQueue resolution", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("allow callback resolves codexPermissionQueue", async () => {
    const permId = "test-perm-id-1234"
    const mainQueue = createPermissionQueue(5_000)
    const codexQueue = createPermissionQueue(5_000)

    let callCount = 0

    // Mock fetch: first call returns one callback update, subsequent calls hang (stop polling)
    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()

      if (url.includes("/getUpdates")) {
        callCount++
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ ok: true, result: [makeCallbackUpdate("allow", permId)] }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        // Subsequent calls: stall so the test can complete without racing
        await new Promise((r) => setTimeout(r, 10_000))
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      // answerCallbackQuery / editMessageText — just succeed
      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramBot(
      { token: "fake-token", chatId: "12345" },
      mainQueue,
      codexQueue,
    )

    // Wait for the codex queue to be resolved
    const codexResult = await Promise.race([
      codexQueue.waitForResponse(permId),
      new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
    ])

    bot.stop()

    expect(codexResult).not.toBeNull()
    expect((codexResult as { action: string } | null)?.action).toBe("allow")
  }, 5_000)

  test("allow callback also resolves mainPermissionQueue", async () => {
    const permId = "test-perm-id-5678"
    const mainQueue = createPermissionQueue(5_000)
    const codexQueue = createPermissionQueue(5_000)

    let callCount = 0

    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()

      if (url.includes("/getUpdates")) {
        callCount++
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ ok: true, result: [makeCallbackUpdate("allow", permId)] }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        await new Promise((r) => setTimeout(r, 10_000))
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramBot(
      { token: "fake-token", chatId: "12345" },
      mainQueue,
      codexQueue,
    )

    const mainResult = await Promise.race([
      mainQueue.waitForResponse(permId),
      new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
    ])

    bot.stop()

    expect(mainResult).not.toBeNull()
    expect((mainResult as { action: string } | null)?.action).toBe("allow")
  }, 5_000)
})
