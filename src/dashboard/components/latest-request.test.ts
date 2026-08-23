import { describe, expect, test } from "bun:test"
import { createLatestRequestGate } from "./latest-request"

describe("createLatestRequestGate", () => {
  test("invalidates an older request when a newer one begins", () => {
    let selected: string | null = "a"
    const gate = createLatestRequestGate(() => selected)
    const first = gate.begin("a")
    selected = "b"
    const second = gate.begin("b")

    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })

  test("rejects a response after its selected session was deleted", () => {
    let selected: string | null = "a"
    const gate = createLatestRequestGate(() => selected)
    const request = gate.begin("a")
    selected = null

    expect(gate.isCurrent(request)).toBe(false)
  })
})
