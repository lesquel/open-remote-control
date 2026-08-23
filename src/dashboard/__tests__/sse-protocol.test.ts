import { describe, expect, test } from "bun:test"
import {
  DASHBOARD_SSE_PROTOCOL_VERSION,
  classifySseProtocol,
} from "../sse/protocol.js"

describe("SSE protocol compatibility", () => {
  test("accepts the dashboard protocol version", () => {
    expect(classifySseProtocol(DASHBOARD_SSE_PROTOCOL_VERSION)).toBe("compatible")
  })

  test("allows legacy servers that do not advertise a version", () => {
    expect(classifySseProtocol(undefined)).toBe("unknown")
    expect(classifySseProtocol(null)).toBe("unknown")
  })

  test("rejects different or malformed declared versions", () => {
    expect(classifySseProtocol(DASHBOARD_SSE_PROTOCOL_VERSION + 1)).toBe("incompatible")
    expect(classifySseProtocol(0)).toBe("incompatible")
    expect(classifySseProtocol("1")).toBe("incompatible")
  })
})
