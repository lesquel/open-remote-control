// normalizeMessage.test.ts — Unit tests for the normalizeMessage pure function.
// The function is defined inline here to avoid pulling in browser-dependent modules
// (markdown.js, state.js, api.js). The logic is kept byte-for-byte identical to
// the implementation in messages.js — any divergence there is a test-mismatch bug.
import { describe, it, expect } from "bun:test"

// ── Inline copy of normalizeMessage (must match messages.js exactly) ──────────

type NormalizedMessage = {
  role: string
  parts: unknown[]
  mode: unknown
  modelID: string | null
  providerID: string | null
  cost: unknown
  tokens: unknown
  _info: unknown
}

function normalizeMessage(raw: unknown): NormalizedMessage {
  if (!raw) return { role: 'assistant', parts: [], mode: null, modelID: null, providerID: null, cost: null, tokens: null, _info: null }
  const r = raw as Record<string, unknown>
  if (r.info && typeof r.info === 'object') {
    const info = r.info as Record<string, unknown>
    return {
      role:       (info.role       as string)  ?? 'assistant',
      parts:      (r.parts         as unknown[]) ?? [],
      mode:       info.mode       ?? info.agent ?? null,
      modelID:    (info.modelID    as string | null) ?? null,
      providerID: (info.providerID as string | null) ?? null,
      cost:       info.cost       ?? null,
      tokens:     info.tokens     ?? null,
      _info:      info,
    }
  }
  return {
    role:       (r.role       as string)  ?? 'assistant',
    parts:      (r.parts      as unknown[]) ?? [],
    mode:       r.mode       ?? r.agent ?? null,
    modelID:    (r.modelID    as string | null) ?? null,
    providerID: (r.providerID as string | null) ?? null,
    cost:       r.cost       ?? null,
    tokens:     r.tokens     ?? null,
    _info:      raw,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("normalizeMessage", () => {
  it("handles null / undefined input with safe defaults", () => {
    const result = normalizeMessage(null)
    expect(result.role).toBe('assistant')
    expect(result.parts).toEqual([])
    expect(result.mode).toBeNull()
    expect(result.modelID).toBeNull()
    expect(result.providerID).toBeNull()
    expect(result.cost).toBeNull()
    expect(result.tokens).toBeNull()
  })

  it("unwraps the wrapped SDK shape { info, parts }", () => {
    const raw = {
      info: {
        role:       'assistant',
        mode:       'plan',
        modelID:    'claude-sonnet-4-5',
        providerID: 'anthropic',
        cost:       0.002,
        tokens:     { input: 1000, output: 200 },
      },
      parts: [{ type: 'text', text: 'hello' }],
    }
    const result = normalizeMessage(raw)
    expect(result.role).toBe('assistant')
    expect(result.mode).toBe('plan')
    expect(result.modelID).toBe('claude-sonnet-4-5')
    expect(result.providerID).toBe('anthropic')
    expect(result.cost).toBe(0.002)
    expect(result.tokens).toEqual({ input: 1000, output: 200 })
    expect((result.parts as unknown[]).length).toBe(1)
    // _info must point to the inner info object
    expect(result._info).toBe(raw.info)
  })

  it("handles flat shape (no info wrapper)", () => {
    const raw = {
      role:       'user',
      parts:      [{ type: 'text', text: 'prompt' }],
      mode:       'build',
      modelID:    null,
      providerID: null,
    }
    const result = normalizeMessage(raw)
    expect(result.role).toBe('user')
    expect(result.mode).toBe('build')
    expect((result.parts as unknown[]).length).toBe(1)
    expect(result.modelID).toBeNull()
    // _info points to the raw object itself
    expect(result._info).toBe(raw)
  })

  it("returns empty parts array when parts field is missing", () => {
    const raw = { info: { role: 'assistant' } }
    const result = normalizeMessage(raw)
    expect(result.parts).toEqual([])
  })

  it("falls back to agent field when mode is absent (flat shape)", () => {
    const raw = { role: 'assistant', agent: 'sdd-orchestrator', parts: [] }
    const result = normalizeMessage(raw)
    expect(result.mode).toBe('sdd-orchestrator')
  })

  it("falls back to info.agent when info.mode is absent (wrapped shape)", () => {
    const raw = {
      info: { role: 'assistant', agent: 'pr-review' },
      parts: [],
    }
    const result = normalizeMessage(raw)
    expect(result.mode).toBe('pr-review')
  })

  it("defaults role to 'assistant' when missing from wrapped info", () => {
    const raw = { info: {}, parts: [] }
    const result = normalizeMessage(raw)
    expect(result.role).toBe('assistant')
  })
})
