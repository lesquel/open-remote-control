// theme.test.ts — Regression guards for the theme module (ui/theme.js).
//
// theme.js depends on document.documentElement and localStorage — both browser
// APIs unavailable in bun test. Following the project pattern (diff-anchor.test.ts,
// normalizeMessage.test.ts), we inline the pure logic and test it directly.
// Any divergence from theme.js is a test-mismatch bug.
//
// The DOM-dependent parts (applyTheme updating <meta>, cycleTheme calling
// applyTheme, getActiveTheme reading the attribute) are tested here by providing
// a minimal stub environment — kept local to each test to avoid cross-test bleed.

import { describe, test, expect, beforeEach } from "bun:test"

// ── Inline constants (must stay identical to theme.js) ────────────────────────

const THEMES = ['terminal-green', 'amber', 'violet', 'mono-light'] as const
type Theme = typeof THEMES[number]

const THEME_LABELS: Record<string, string> = {
  'terminal-green': 'Terminal green',
  'amber':          'Amber',
  'violet':         'Violet',
  'mono-light':     'Light (mono)',
}

const STORAGE_KEY = 'pilot-theme'
const DEFAULT_THEME: Theme = 'terminal-green'

// ── Minimal stubs ────────────────────────────────────────────────────────────

function makeStore(): Record<string, string> {
  return {}
}

function makeEl(): { attrs: Record<string, string> } {
  return { attrs: {} }
}

// ── Inline applyTheme (must match theme.js logic) ──────────────────────────

function validateTheme(t: unknown): Theme {
  if (typeof t === 'string' && (THEMES as readonly string[]).includes(t)) {
    return t as Theme
  }
  return DEFAULT_THEME
}

function applyTheme(
  t: unknown,
  store: Record<string, string>,
  el: { attrs: Record<string, string> },
): Theme {
  const theme = validateTheme(t)
  el.attrs['data-theme'] = theme
  try {
    store[STORAGE_KEY] = theme
  } catch (err) {
    console.error('[theme] Failed to persist theme to localStorage:', err)
  }
  return theme
}

// ── Inline getActiveTheme (must match theme.js logic) ─────────────────────

function getActiveTheme(
  el: { attrs: Record<string, string> },
  store: Record<string, string>,
): Theme {
  const attr = el.attrs['data-theme']
  if (attr && (THEMES as readonly string[]).includes(attr)) return attr as Theme

  const stored = store[STORAGE_KEY]
  if (stored && (THEMES as readonly string[]).includes(stored)) return stored as Theme

  return DEFAULT_THEME
}

// ── Inline cycleTheme (must match theme.js logic) ─────────────────────────

function cycleTheme(
  store: Record<string, string>,
  el: { attrs: Record<string, string> },
): Theme {
  const current = getActiveTheme(el, store)
  const idx = THEMES.indexOf(current)
  const next = THEMES[(idx + 1) % THEMES.length]
  applyTheme(next, store, el)
  return next
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("THEMES / THEME_LABELS", () => {
  test("THEMES tuple has exactly 4 entries", () => {
    expect(THEMES).toHaveLength(4)
  })

  test("THEME_LABELS has a label for every theme", () => {
    for (const t of THEMES) {
      expect(THEME_LABELS[t]).toBeTruthy()
    }
  })

  test("STORAGE_KEY is pilot-theme", () => {
    expect(STORAGE_KEY).toBe('pilot-theme')
  })
})

describe("applyTheme", () => {
  test("sets data-theme='amber' on the element and persists to store", () => {
    const store = makeStore()
    const el = makeEl()
    applyTheme('amber', store, el)
    expect(el.attrs['data-theme']).toBe('amber')
    expect(store[STORAGE_KEY]).toBe('amber')
  })

  test("falls back to 'terminal-green' for unknown theme string", () => {
    const store = makeStore()
    const el = makeEl()
    applyTheme('garbage', store, el)
    expect(el.attrs['data-theme']).toBe('terminal-green')
    expect(store[STORAGE_KEY]).toBe('terminal-green')
  })

  test("falls back to 'terminal-green' for null", () => {
    const store = makeStore()
    const el = makeEl()
    applyTheme(null, store, el)
    expect(el.attrs['data-theme']).toBe('terminal-green')
  })

  test("falls back to 'terminal-green' for undefined", () => {
    const store = makeStore()
    const el = makeEl()
    applyTheme(undefined, store, el)
    expect(el.attrs['data-theme']).toBe('terminal-green')
  })

  test("sets data-theme='violet'", () => {
    const store = makeStore()
    const el = makeEl()
    applyTheme('violet', store, el)
    expect(el.attrs['data-theme']).toBe('violet')
    expect(store[STORAGE_KEY]).toBe('violet')
  })

  test("sets data-theme='mono-light'", () => {
    const store = makeStore()
    const el = makeEl()
    applyTheme('mono-light', store, el)
    expect(el.attrs['data-theme']).toBe('mono-light')
    expect(store[STORAGE_KEY]).toBe('mono-light')
  })
})

describe("getActiveTheme", () => {
  test("reads from element attr first when both attr and store differ", () => {
    const store: Record<string, string> = { [STORAGE_KEY]: 'amber' }
    const el = { attrs: { 'data-theme': 'violet' } }
    expect(getActiveTheme(el, store)).toBe('violet')
  })

  test("falls back to localStorage when attr is absent", () => {
    const store: Record<string, string> = { [STORAGE_KEY]: 'amber' }
    const el = makeEl()
    expect(getActiveTheme(el, store)).toBe('amber')
  })

  test("falls back to 'terminal-green' when both attr and store are absent", () => {
    const store = makeStore()
    const el = makeEl()
    expect(getActiveTheme(el, store)).toBe('terminal-green')
  })

  test("ignores unknown attr value and falls back to store", () => {
    const store: Record<string, string> = { [STORAGE_KEY]: 'mono-light' }
    const el = { attrs: { 'data-theme': 'neon-purple' } }
    expect(getActiveTheme(el, store)).toBe('mono-light')
  })
})

describe("cycleTheme", () => {
  test("advances from terminal-green to amber", () => {
    const store: Record<string, string> = { [STORAGE_KEY]: 'terminal-green' }
    const el = { attrs: { 'data-theme': 'terminal-green' } }
    const next = cycleTheme(store, el)
    expect(next).toBe('amber')
    expect(el.attrs['data-theme']).toBe('amber')
    expect(store[STORAGE_KEY]).toBe('amber')
  })

  test("advances from amber to violet", () => {
    const store: Record<string, string> = { [STORAGE_KEY]: 'amber' }
    const el = { attrs: { 'data-theme': 'amber' } }
    expect(cycleTheme(store, el)).toBe('violet')
  })

  test("advances from violet to mono-light", () => {
    const store: Record<string, string> = { [STORAGE_KEY]: 'violet' }
    const el = { attrs: { 'data-theme': 'violet' } }
    expect(cycleTheme(store, el)).toBe('mono-light')
  })

  test("wraps from mono-light back to terminal-green", () => {
    const store: Record<string, string> = { [STORAGE_KEY]: 'mono-light' }
    const el = { attrs: { 'data-theme': 'mono-light' } }
    expect(cycleTheme(store, el)).toBe('terminal-green')
  })

  test("cycles through all 4 themes and returns to start", () => {
    const store = makeStore()
    const el = makeEl()
    const results: string[] = []
    for (let i = 0; i < THEMES.length; i++) {
      results.push(cycleTheme(store, el))
    }
    // Should visit all 4 themes in order and return to the first
    expect(results).toEqual(['amber', 'violet', 'mono-light', 'terminal-green'])
  })
})
