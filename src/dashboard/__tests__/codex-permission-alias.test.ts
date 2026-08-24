// codex-permission-alias.test.ts — TDD for the Codex permission dashboard alias fix.
//
// Bug: Codex emits `pilot.permission.pending` / `pilot.permission.resolved` but
// the dashboard only handled `permission.requested` / `permission.resolved`.
// Fix: add named constants for the pilot event types and handle them as aliases
// in the SSE handleEvent switch.
//
// These tests run against pure modules (no browser APIs needed):
//   - constants.js   — verifies the new constants are defined with correct values
//   - permission-normalize.js — verifies the pure normalization helper works for
//     both native OpenCode payload shapes and Codex payload shapes

import { describe, expect, test } from "bun:test"
import { EVENTS } from "../constants.js"
import {
  normalizePermissionPending,
  normalizePermissionResolved,
} from "../sse/permission-normalize.js"

// ── Step 1: constants ─────────────────────────────────────────────────────────

describe("constants.js — pilot permission alias event types", () => {
  // FAILING until constants are added: EVENTS.PERMISSION_PENDING_PILOT and
  // EVENTS.PERMISSION_RESOLVED_PILOT must exist with the exact strings that
  // Codex emits.

  test("EVENTS.PERMISSION_PENDING_PILOT equals 'pilot.permission.pending'", () => {
    expect(EVENTS.PERMISSION_PENDING_PILOT).toBe("pilot.permission.pending")
  })

  test("EVENTS.PERMISSION_RESOLVED_PILOT equals 'pilot.permission.resolved'", () => {
    expect(EVENTS.PERMISSION_RESOLVED_PILOT).toBe("pilot.permission.resolved")
  })

  test("native PERMISSION_REQUESTED constant is unchanged (no regression)", () => {
    expect(EVENTS.PERMISSION_REQUESTED).toBe("permission.requested")
  })

  test("native PERMISSION_RESOLVED constant is unchanged (no regression)", () => {
    expect(EVENTS.PERMISSION_RESOLVED).toBe("permission.resolved")
  })
})

// ── Step 2: normalization helper ──────────────────────────────────────────────

describe("normalizePermissionPending — Codex payload shape", () => {
  // The exact payload Codex emits in handlers.ts ~line 275:
  //   { permissionID, title: `Codex: ${tool_name}`, sessionID, permissionType, metadata }
  const codexEvent = {
    type: "pilot.permission.pending",
    properties: {
      permissionID: "uuid-123",
      title: "Codex: BashTool",
      sessionID: "sess-abc",
      permissionType: "codex-tool",
      metadata: { tool_name: "BashTool", source: "codex-hook", integrationID: "codex", projectID: "/projects/a", directory: "/projects/a", sessionID: "sess-abc" },
    },
  }

  test("normalizePermissionPending exists and handles Codex payload", () => {
    const normalized = normalizePermissionPending(codexEvent)
    expect(normalized.id).toBe("uuid-123")
    expect(normalized.permissionID).toBe("uuid-123")
    expect(normalized.title).toBe("Codex: BashTool")
    expect(normalized.sessionID).toBe("sess-abc")
    expect(normalized.type).toBe("codex-tool")
    expect(normalized.metadata).toEqual({ tool_name: "BashTool", source: "codex-hook", integrationID: "codex", projectID: "/projects/a", directory: "/projects/a", sessionID: "sess-abc" })
    expect(normalized.integrationID).toBe("codex")
    expect(normalized.directory).toBe("/projects/a")
  })

  test("normalizePermissionPending handles native OpenCode payload shape", () => {
    // Native OpenCode events carry the same fields under .properties
    const nativeEvent = {
      type: "permission.requested",
      properties: {
        permissionID: "native-uuid-456",
        title: "Shell: rm -rf",
        sessionID: "sess-native",
        permissionType: "shell",
        pattern: "/tmp/**",
        metadata: { command: "rm -rf /tmp/foo" },
      },
    }
    const normalized = normalizePermissionPending(nativeEvent)
    expect(normalized.id).toBe("native-uuid-456")
    expect(normalized.title).toBe("Shell: rm -rf")
    expect(normalized.pattern).toBe("/tmp/**")
  })

  test("normalizePermissionPending handles .data shape (EventSource named-event path)", () => {
    // Named SSE events wrap the payload in .data
    const namedEvent = {
      type: "permission.requested",
      data: {
        permissionID: "evt-data-789",
        title: "Read file",
        sessionID: "sess-data",
        permissionType: "read",
      },
    }
    const normalized = normalizePermissionPending(namedEvent)
    expect(normalized.id).toBe("evt-data-789")
    expect(normalized.sessionID).toBe("sess-data")
  })

  test("pattern field is undefined (not present) for Codex events — safe default", () => {
    // Codex does NOT send a pattern field. The normalize should produce
    // pattern: undefined (not throw) so the banner gracefully shows no detail.
    const normalized = normalizePermissionPending(codexEvent)
    expect(normalized.pattern).toBeUndefined()
  })
})

describe("normalizePermissionResolved — Codex payload shape", () => {
  test("normalizes the OpenCode v2 requestID field", () => {
    expect(normalizePermissionResolved({
      type: "permission.replied",
      properties: { sessionID: "session-1", requestID: "native-1", reply: "once" },
    })).toEqual({ id: "native-1", permissionID: "native-1", sessionID: "session-1" })
  })

  test("preserves resolved permission context for collision-safe dashboard updates", () => {
    expect(normalizePermissionResolved({
      type: "pilot.permission.resolved",
      properties: { permissionID: "same", metadata: { integrationID: "codex", projectID: "/projects/b", directory: "/projects/b", sessionID: "session-b" } },
    })).toMatchObject({ id: "same", integrationID: "codex", directory: "/projects/b", sessionID: "session-b" })
  })

  const codexResolved = {
    type: "pilot.permission.resolved",
    properties: {
      permissionID: "uuid-123",
      action: "allow",
      source: "remote",
    },
  }

  test("normalizePermissionResolved exists and handles Codex payload", () => {
    const normalized = normalizePermissionResolved(codexResolved)
    expect(normalized.id).toBe("uuid-123")
    expect(normalized.permissionID).toBe("uuid-123")
  })

  test("normalizePermissionResolved handles client_disconnected reason", () => {
    const disconnectEvent = {
      type: "pilot.permission.resolved",
      properties: {
        permissionID: "uuid-disconnected",
        action: "deny",
        source: "remote",
        reason: "client_disconnected",
      },
    }
    const normalized = normalizePermissionResolved(disconnectEvent)
    expect(normalized.id).toBe("uuid-disconnected")
    expect(normalized.permissionID).toBe("uuid-disconnected")
  })

  test("normalizePermissionResolved handles timeout reason", () => {
    const timeoutEvent = {
      type: "pilot.permission.resolved",
      properties: {
        permissionID: "uuid-timeout",
        action: "deny",
        source: "remote",
        reason: "timeout",
      },
    }
    const normalized = normalizePermissionResolved(timeoutEvent)
    expect(normalized.id).toBe("uuid-timeout")
  })
})
