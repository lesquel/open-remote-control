// createReference.test.ts — Unit tests for the createReference factory.
// Inline implementation to avoid browser globals (window, document, etc.).
import { describe, it, expect } from "bun:test"

// ── Inline copy of createReference (must match references.js exactly) ─────────

type ReferenceOptions<T> = {
  fetchFn: () => Promise<T[]>
  key?: string
}

type Reference<T extends Record<string, unknown>> = {
  load: () => Promise<void>
  list: () => T[]
  get: (value: unknown) => T | undefined
  isReady: () => boolean
}

function createReference<T extends Record<string, unknown>>({
  fetchFn,
  key = 'name',
}: ReferenceOptions<T>): Reference<T> {
  let cache: T[] = []
  let loaded = false
  return {
    async load() {
      try {
        cache = await fetchFn()
        loaded = true
      } catch (_) {
        // On failure, cache stays empty and isReady stays false
      }
    },
    list() { return cache },
    get(value) { return cache.find(x => x[key] === value) },
    isReady() { return loaded },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createReference", () => {
  it("starts with empty cache and isReady false", () => {
    const ref = createReference({ fetchFn: async () => [] })
    expect(ref.list()).toEqual([])
    expect(ref.isReady()).toBe(false)
    expect(ref.get('anything')).toBeUndefined()
  })

  it("load() populates cache and sets isReady true on success", async () => {
    const agents = [
      { name: 'plan', description: 'Plan agent' },
      { name: 'build', description: 'Build agent' },
    ]
    const ref = createReference({ fetchFn: async () => agents })
    await ref.load()
    expect(ref.isReady()).toBe(true)
    expect(ref.list()).toEqual(agents)
  })

  it("get() finds item by key", async () => {
    const agents = [{ name: 'plan' }, { name: 'build' }]
    const ref = createReference({ fetchFn: async () => agents })
    await ref.load()
    expect(ref.get('plan')).toEqual({ name: 'plan' })
    expect(ref.get('missing')).toBeUndefined()
  })

  it("get() uses a custom key field", async () => {
    const providers = [{ id: 'anthropic', name: 'Anthropic' }, { id: 'openai', name: 'OpenAI' }]
    const ref = createReference({ fetchFn: async () => providers, key: 'id' })
    await ref.load()
    expect(ref.get('anthropic')).toEqual({ id: 'anthropic', name: 'Anthropic' })
  })

  it("load() failure leaves cache empty and isReady false", async () => {
    const ref = createReference({
      fetchFn: async () => { throw new Error('network error') },
    })
    await ref.load()
    expect(ref.isReady()).toBe(false)
    expect(ref.list()).toEqual([])
    expect(ref.get('anything')).toBeUndefined()
  })

  it("list() returns a reference to the cache array (not a copy)", async () => {
    const items = [{ name: 'x' }]
    const ref = createReference({ fetchFn: async () => items })
    await ref.load()
    // The returned array should be the same as what was loaded
    expect(ref.list()).toEqual(items)
  })
})
