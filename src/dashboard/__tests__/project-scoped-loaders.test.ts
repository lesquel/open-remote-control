import { describe, expect, test } from "bun:test"
import { addProjectTab, getState, setState, switchProjectTab } from "../state/state.js"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
}

function installMinimalDocument() {
  if (!globalThis.window) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { addEventListener: () => {}, dispatchEvent: () => true },
    })
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document")
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById: () => null,
      addEventListener: () => {},
      visibilityState: "visible",
    },
  })
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor)
    else Reflect.deleteProperty(globalThis, "document")
  }
}

function projects() {
  const suffix = `${Date.now()}-${Math.random()}`
  return {
    a: addProjectTab(`/projects/loader-a-${suffix}`, "loader-a"),
    b: addProjectTab(`/projects/loader-b-${suffix}`, "loader-b"),
  }
}

describe("project-scoped dashboard loaders", () => {
  test("keeps delayed Project A permissions out of Project B", async () => {
    const originalFetch = globalThis.fetch
    const restoreDocument = installMinimalDocument()
    const responseA = deferred<Response>()
    const responseB = deferred<Response>()
    let calls = 0
    globalThis.fetch = (() => (++calls === 1 ? responseA.promise : responseB.promise)) as unknown as typeof fetch

    try {
      const { loadPermissions } = await import("../components/permissions.js")
      const { a, b } = projects()
      switchProjectTab(a.id)
      const pendingA = loadPermissions()
      switchProjectTab(b.id)
      const pendingB = loadPermissions()

      responseB.resolve(json([{ id: "permission-b" }]))
      await pendingB
      responseA.resolve(json([{ id: "permission-a" }]))
      await pendingA

      expect(getState().pendingPerms).toEqual([{ id: "permission-b" }])
    } finally {
      globalThis.fetch = originalFetch
      restoreDocument()
      setState({ pendingPerms: [] })
    }
  })

  test("keeps delayed Project A questions out of Project B", async () => {
    const originalFetch = globalThis.fetch
    const restoreDocument = installMinimalDocument()
    const responseA = deferred<Response>()
    const responseB = deferred<Response>()
    let calls = 0
    globalThis.fetch = (() => (++calls === 1 ? responseA.promise : responseB.promise)) as unknown as typeof fetch

    try {
      const { loadQuestions } = await import("../components/questions.js")
      const { a, b } = projects()
      switchProjectTab(a.id)
      const pendingA = loadQuestions()
      switchProjectTab(b.id)
      const pendingB = loadQuestions()

      responseB.resolve(json([{ id: "question-b", questions: [] }]))
      await pendingB
      responseA.resolve(json([{ id: "question-a", questions: [] }]))
      await pendingA

      expect(getState().pendingQuestions).toEqual([{ id: "question-b", questions: [] }])
    } finally {
      globalThis.fetch = originalFetch
      restoreDocument()
      setState({ pendingQuestions: [] })
    }
  })

  test("keeps delayed Project A reference metadata out of Project B", async () => {
    const originalFetch = globalThis.fetch
    const responseA = Array.from({ length: 5 }, () => deferred<Response>())
    const responseB = Array.from({ length: 5 }, () => deferred<Response>())
    let calls = 0
    globalThis.fetch = (() => {
      const index = calls++
      return index < 5 ? responseA[index].promise : responseB[index - 5].promise
    }) as unknown as typeof fetch

    try {
      const {
        refresh: refreshReferences,
        getAgents,
        getCurrentProject,
      } = await import("../components/references.js")
      const { a, b } = projects()
      switchProjectTab(a.id)
      const pendingA = refreshReferences()
      switchProjectTab(b.id)
      const pendingB = refreshReferences()

      responseB[0].resolve(json({ agents: [{ name: "Agent B" }] }))
      responseB[1].resolve(json({ all: [], default: {}, connected: [] }))
      responseB[2].resolve(json({ servers: {} }))
      responseB[3].resolve(json({ project: { path: b.directory } }))
      responseB[4].resolve(json({ clients: [] }))
      await pendingB

      responseA[0].resolve(json({ agents: [{ name: "Agent A" }] }))
      responseA[1].resolve(json({ all: [], default: {}, connected: [] }))
      responseA[2].resolve(json({ servers: {} }))
      responseA[3].resolve(json({ project: { path: a.directory } }))
      responseA[4].resolve(json({ clients: [] }))
      await pendingA

      expect(getAgents()).toEqual([{ name: "Agent B" }])
      expect(getCurrentProject()).toEqual({ path: b.directory })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
