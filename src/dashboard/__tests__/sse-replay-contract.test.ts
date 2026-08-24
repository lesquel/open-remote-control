import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "../sse/sse.js"), "utf8")

describe("dashboard SSE replay contract", () => {
  test("sends the last accepted event ID when reconnecting", () => {
    expect(source).toContain("lastEventId=${encodeURIComponent(_lastEventId)}")
    expect(source).toContain("rememberEventId(e.lastEventId)")
  })

  test("deduplicates replayed IDs and bounds cursor memory", () => {
    expect(source).toContain("if (_seenEventIds.has(id)) return false")
    expect(source).toContain("const SEEN_EVENT_LIMIT = 256")
  })

  test("surfaces a server generation change and refreshes canonical state", () => {
    expect(source).toContain("replayStatus === 'generation_changed'")
    expect(source).toContain("setConnectionStatus('host-restarted')")
    expect(source).toContain("refreshCanonicalSnapshots()")
  })

  test("reconciles authenticated project attention after replay loss and reconnect", () => {
    expect(source).toContain("function refreshCanonicalAttention()")
    expect(source).toContain("Promise.all([loadPermissions(), loadQuestions()])")
    expect(source).toContain("reconcileActivityAttention({")
    expect(source).toContain("replayStatus === 'unavailable'")
    expect(source).toContain("void refreshCanonicalAttention()")
  })
})
