// decorations.test.ts — Unit tests for grid/scanlines localStorage toggle logic.
// Pure logic inlined here (no browser DOM deps) — same pattern as cost-pinned.test.ts.
import { describe, it, expect } from "bun:test"

// ── Inline: decoration bootstrap logic (from index.html FOUC script) ──────────
// Reads pilot-grid and pilot-scanlines from a storage map and returns which
// body attributes should be set on first paint.
function resolveDecorationAttrs(
  storage: Record<string, string>,
): { grid: boolean; scanlines: boolean } {
  return {
    grid: storage['pilot-grid'] === '1',
    scanlines: storage['pilot-scanlines'] === '1',
  }
}

// ── Inline: decoration toggle logic (from settings.js change handler) ──────────
// Given a current storage map and a toggle event, returns the next storage state
// and the expected body attribute state.
function applyDecorationToggle(
  storage: Record<string, string>,
  key: 'pilot-grid' | 'pilot-scanlines',
  checked: boolean,
): { storage: Record<string, string>; bodyAttr: boolean } {
  const next = { ...storage, [key]: checked ? '1' : '0' }
  return { storage: next, bodyAttr: checked }
}

// ── Tests: default state ───────────────────────────────────────────────────────

describe("decoration defaults", () => {
  it("grid is OFF when localStorage is empty", () => {
    const { grid } = resolveDecorationAttrs({})
    expect(grid).toBe(false)
  })

  it("scanlines are OFF when localStorage is empty", () => {
    const { scanlines } = resolveDecorationAttrs({})
    expect(scanlines).toBe(false)
  })

  it("grid is OFF when pilot-grid is '0'", () => {
    const { grid } = resolveDecorationAttrs({ 'pilot-grid': '0' })
    expect(grid).toBe(false)
  })

  it("scanlines are OFF when pilot-scanlines is '0'", () => {
    const { scanlines } = resolveDecorationAttrs({ 'pilot-scanlines': '0' })
    expect(scanlines).toBe(false)
  })
})

// ── Tests: opt-in persistence ─────────────────────────────────────────────────

describe("decoration opt-in", () => {
  it("grid is ON when pilot-grid is '1'", () => {
    const { grid } = resolveDecorationAttrs({ 'pilot-grid': '1' })
    expect(grid).toBe(true)
  })

  it("scanlines are ON when pilot-scanlines is '1'", () => {
    const { scanlines } = resolveDecorationAttrs({ 'pilot-scanlines': '1' })
    expect(scanlines).toBe(true)
  })
})

// ── Tests: toggle writes to storage ───────────────────────────────────────────

describe("decoration toggle", () => {
  it("enabling grid writes '1' to pilot-grid and sets bodyAttr true", () => {
    const { storage, bodyAttr } = applyDecorationToggle({}, 'pilot-grid', true)
    expect(storage['pilot-grid']).toBe('1')
    expect(bodyAttr).toBe(true)
  })

  it("disabling grid writes '0' to pilot-grid and sets bodyAttr false", () => {
    const { storage, bodyAttr } = applyDecorationToggle(
      { 'pilot-grid': '1' },
      'pilot-grid',
      false,
    )
    expect(storage['pilot-grid']).toBe('0')
    expect(bodyAttr).toBe(false)
  })

  it("enabling scanlines writes '1' to pilot-scanlines and sets bodyAttr true", () => {
    const { storage, bodyAttr } = applyDecorationToggle({}, 'pilot-scanlines', true)
    expect(storage['pilot-scanlines']).toBe('1')
    expect(bodyAttr).toBe(true)
  })

  it("disabling scanlines writes '0' to pilot-scanlines and sets bodyAttr false", () => {
    const { storage, bodyAttr } = applyDecorationToggle(
      { 'pilot-scanlines': '1' },
      'pilot-scanlines',
      false,
    )
    expect(storage['pilot-scanlines']).toBe('0')
    expect(bodyAttr).toBe(false)
  })

  it("toggling grid does not affect scanlines storage", () => {
    const { storage } = applyDecorationToggle(
      { 'pilot-scanlines': '1' },
      'pilot-grid',
      true,
    )
    expect(storage['pilot-scanlines']).toBe('1')
  })
})
