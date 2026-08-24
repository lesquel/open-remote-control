import { describe, expect, test } from "bun:test"
import {
  addProjectTab,
  beginProjectRequest,
  finishProjectRequest,
  isCurrentProjectRequest,
  switchProjectTab,
} from "./state"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("project request tickets", () => {
  test("does not let a delayed Project A response commit after switching to Project B", async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const projectA = addProjectTab(`/projects/request-a-${suffix}`, "request-a")
    const projectB = addProjectTab(`/projects/request-b-${suffix}`, "request-b")
    const responseA = deferred<string>()
    const responseB = deferred<string>()
    let visibleProject = ""

    async function applyWhenCurrent(ticket: ReturnType<typeof beginProjectRequest>, response: Promise<string>) {
      try {
        const project = await response
        if (isCurrentProjectRequest(ticket)) visibleProject = project
      } finally {
        finishProjectRequest(ticket)
      }
    }

    switchProjectTab(projectA.id)
    const requestA = beginProjectRequest("references")
    const pendingA = applyWhenCurrent(requestA, responseA.promise)

    switchProjectTab(projectB.id)
    expect(requestA.signal.aborted).toBe(true)
    const requestB = beginProjectRequest("references")
    const pendingB = applyWhenCurrent(requestB, responseB.promise)

    responseB.resolve("Project B")
    await pendingB
    responseA.resolve("Project A")
    await pendingA

    expect(visibleProject).toBe("Project B")
  })

  test("aborts an older request in the same project-scoped loader", () => {
    const first = beginProjectRequest("permissions")
    const second = beginProjectRequest("permissions")

    expect(first.signal.aborted).toBe(true)
    expect(isCurrentProjectRequest(first)).toBe(false)
    expect(isCurrentProjectRequest(second)).toBe(true)

    finishProjectRequest(second)
  })
})
