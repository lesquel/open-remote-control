// RED: type-check smoke test — these will fail until PilotEvent is extended
import { describe, expect, test } from "bun:test"
import type { PilotEvent } from "./types"

describe("PilotEvent — codex variants (type-level smoke test)", () => {
  test("pilot.session.started is a valid PilotEvent type", () => {
    const ev: PilotEvent = {
      type: "pilot.session.started",
      properties: { sessionID: "s1", cwd: "/tmp", model: "gpt-4o", permissionMode: "default" },
    }
    expect(ev.type).toBe("pilot.session.started")
  })

  test("pilot.prompt.received is a valid PilotEvent type", () => {
    const ev: PilotEvent = {
      type: "pilot.prompt.received",
      properties: { sessionID: "s1", turnID: "t1", prompt: "hello" },
    }
    expect(ev.type).toBe("pilot.prompt.received")
  })

  test("pilot.session.stopped is a valid PilotEvent type", () => {
    const ev: PilotEvent = {
      type: "pilot.session.stopped",
      properties: { sessionID: "s1" },
    }
    expect(ev.type).toBe("pilot.session.stopped")
  })
})
