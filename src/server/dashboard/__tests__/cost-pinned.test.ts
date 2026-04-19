// cost-pinned.test.ts — Unit tests for cost tracking and pinned TODO logic.
// Pure logic inlined here (no browser deps) — same pattern as normalizeMessage.test.ts.
import { describe, it, expect } from "bun:test"

// ── Inline: sumSessionCost (from cost-panel.js) ───────────────────────────

type NormalizedMsg = {
  role: string
  cost?: unknown
}

function extractCost(m: NormalizedMsg): number {
  const c = m?.cost
  if (typeof c === 'number') return c
  if (c && typeof c === 'object') {
    const o = c as Record<string, number>
    return o.total ?? ((o.input ?? 0) + (o.output ?? 0) + (o.cacheRead ?? 0) + (o.cacheWrite ?? 0))
  }
  return 0
}

function sumSessionCost(msgs: NormalizedMsg[]): number {
  if (!Array.isArray(msgs)) return 0
  let total = 0
  for (const m of msgs) {
    if (m?.role === 'assistant') total += extractCost(m)
  }
  return total
}

// ── Inline: pinnedItemId (from pinned-todos.js) ───────────────────────────

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h = h >>> 0
  }
  return h.toString(36)
}

function pinnedItemId(text: string, sessionId: string): string {
  return hashString(String(text) + '|' + String(sessionId))
}

// ── Tests: sumSessionCost ─────────────────────────────────────────────────

describe("sumSessionCost", () => {
  it("returns 0 for empty array", () => {
    expect(sumSessionCost([])).toBe(0)
  })

  it("returns 0 for non-array input", () => {
    expect(sumSessionCost(null as unknown as NormalizedMsg[])).toBe(0)
  })

  it("sums numeric cost across assistant messages", () => {
    const msgs: NormalizedMsg[] = [
      { role: 'user',      cost: 999 },   // ignored (not assistant)
      { role: 'assistant', cost: 0.01 },
      { role: 'assistant', cost: 0.02 },
    ]
    expect(sumSessionCost(msgs)).toBeCloseTo(0.03)
  })

  it("handles object cost with total field", () => {
    const msgs: NormalizedMsg[] = [
      { role: 'assistant', cost: { total: 0.05 } },
    ]
    expect(sumSessionCost(msgs)).toBeCloseTo(0.05)
  })

  it("handles object cost with sub-fields when total absent", () => {
    const msgs: NormalizedMsg[] = [
      { role: 'assistant', cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.0005 } },
    ]
    expect(sumSessionCost(msgs)).toBeCloseTo(0.0315)
  })

  it("treats missing/null cost as 0", () => {
    const msgs: NormalizedMsg[] = [
      { role: 'assistant' },
      { role: 'assistant', cost: null },
      { role: 'assistant', cost: undefined },
    ]
    expect(sumSessionCost(msgs)).toBe(0)
  })

  it("does not count user messages", () => {
    const msgs: NormalizedMsg[] = [
      { role: 'user', cost: 10 },
    ]
    expect(sumSessionCost(msgs)).toBe(0)
  })
})

// ── Tests: pinnedItemId ───────────────────────────────────────────────────

describe("pinnedItemId", () => {
  it("returns a non-empty string", () => {
    const id = pinnedItemId("fix the bug", "sess-abc")
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it("is stable — same input yields same id", () => {
    expect(pinnedItemId("a", "b")).toBe(pinnedItemId("a", "b"))
  })

  it("is different for different text", () => {
    expect(pinnedItemId("text-1", "sess")).not.toBe(pinnedItemId("text-2", "sess"))
  })

  it("is different for different sessionId", () => {
    expect(pinnedItemId("text", "sess-1")).not.toBe(pinnedItemId("text", "sess-2"))
  })

  it("is different when text and sessionId are swapped", () => {
    expect(pinnedItemId("sess-1", "text")).not.toBe(pinnedItemId("text", "sess-1"))
  })
})
