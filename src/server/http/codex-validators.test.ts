// RED: codex-validators — all 6 event validators, happy-path + invalid cases
import { describe, expect, test } from "bun:test"
import {
  validateSessionStart,
  validateUserPromptSubmit,
  validatePreToolUse,
  validatePostToolUse,
  validatePermissionRequest,
  validateStop,
} from "./codex-validators"

// ─── SessionStart ─────────────────────────────────────────────────────────────

describe("validateSessionStart", () => {
  const happy = {
    session_id: "sess-1",
    cwd: "/tmp",
    model: "gpt-4o",
    permission_mode: "default",
  }

  test("accepts a valid SessionStart payload", () => {
    const result = validateSessionStart(happy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.session_id).toBe("sess-1")
      expect(result.data.cwd).toBe("/tmp")
    }
  })

  test("rejects missing session_id", () => {
    const { session_id: _, ...rest } = happy
    const result = validateSessionStart(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("session_id")
  })

  test("rejects missing cwd", () => {
    const result = validateSessionStart({ ...happy, cwd: undefined })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("cwd")
  })

  test("rejects non-string model", () => {
    const result = validateSessionStart({ ...happy, model: 42 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("model")
  })

  test("accepts optional turn_id", () => {
    const result = validateSessionStart({ ...happy, turn_id: "t1" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.turn_id).toBe("t1")
  })
})

// ─── UserPromptSubmit ─────────────────────────────────────────────────────────

describe("validateUserPromptSubmit", () => {
  const happy = {
    session_id: "sess-1",
    turn_id: "turn-1",
    prompt: "hello world",
  }

  test("accepts a valid UserPromptSubmit payload", () => {
    const result = validateUserPromptSubmit(happy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.session_id).toBe("sess-1")
      expect(result.data.prompt).toBe("hello world")
    }
  })

  test("rejects missing turn_id", () => {
    const { turn_id: _, ...rest } = happy
    const result = validateUserPromptSubmit(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("turn_id")
  })

  test("rejects non-string prompt", () => {
    const result = validateUserPromptSubmit({ ...happy, prompt: 123 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("prompt")
  })

  test("rejects empty prompt string", () => {
    const result = validateUserPromptSubmit({ ...happy, prompt: "" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("empty")
  })
})

// ─── PreToolUse ───────────────────────────────────────────────────────────────

describe("validatePreToolUse", () => {
  const happy = {
    session_id: "sess-1",
    turn_id: "turn-1",
    tool_use_id: "tuid-1",
    tool_name: "bash",
    tool_input: { command: "ls" },
  }

  test("accepts a valid PreToolUse payload", () => {
    const result = validatePreToolUse(happy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.tool_name).toBe("bash")
      expect(result.data.tool_use_id).toBe("tuid-1")
    }
  })

  test("rejects missing tool_use_id", () => {
    const { tool_use_id: _, ...rest } = happy
    const result = validatePreToolUse(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("tool_use_id")
  })

  test("rejects missing tool_input (undefined)", () => {
    const { tool_input: _, ...rest } = happy
    const result = validatePreToolUse(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("tool_input")
  })

  test("accepts string tool_input", () => {
    const result = validatePreToolUse({ ...happy, tool_input: "string-value" })
    expect(result.ok).toBe(true)
  })

  test("accepts null tool_input", () => {
    const result = validatePreToolUse({ ...happy, tool_input: null })
    expect(result.ok).toBe(true)
  })

  test("accepts numeric tool_input", () => {
    const result = validatePreToolUse({ ...happy, tool_input: 42 })
    expect(result.ok).toBe(true)
  })
})

// ─── PostToolUse ──────────────────────────────────────────────────────────────

describe("validatePostToolUse", () => {
  const happy = {
    session_id: "sess-1",
    turn_id: "turn-1",
    tool_use_id: "tuid-1",
    tool_name: "bash",
    tool_response: "output text",
  }

  test("accepts a valid PostToolUse payload", () => {
    const result = validatePostToolUse(happy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.tool_name).toBe("bash")
    }
  })

  test("rejects missing tool_name", () => {
    const { tool_name: _, ...rest } = happy
    const result = validatePostToolUse(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("tool_name")
  })

  test("rejects missing tool_use_id", () => {
    const { tool_use_id: _, ...rest } = happy
    const result = validatePostToolUse(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("tool_use_id")
  })
})

// ─── PermissionRequest ────────────────────────────────────────────────────────

describe("validatePermissionRequest", () => {
  const happy = {
    session_id: "sess-1",
    turn_id: "turn-1",
    tool_name: "bash",
    tool_input: { command: "rm -rf /" },
  }

  test("accepts a valid PermissionRequest payload", () => {
    const result = validatePermissionRequest(happy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.tool_name).toBe("bash")
      expect(result.data.session_id).toBe("sess-1")
    }
  })

  test("rejects missing session_id", () => {
    const { session_id: _, ...rest } = happy
    const result = validatePermissionRequest(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("session_id")
  })

  test("rejects missing tool_input (undefined)", () => {
    const { tool_input: _, ...rest } = happy
    const result = validatePermissionRequest(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("tool_input")
  })

  test("accepts null tool_input", () => {
    const result = validatePermissionRequest({ ...happy, tool_input: null })
    expect(result.ok).toBe(true)
  })

  test("accepts string tool_input", () => {
    const result = validatePermissionRequest({ ...happy, tool_input: "cmd" })
    expect(result.ok).toBe(true)
  })

  test("accepts numeric tool_input", () => {
    const result = validatePermissionRequest({ ...happy, tool_input: 42 })
    expect(result.ok).toBe(true)
  })
})

// ─── Stop ─────────────────────────────────────────────────────────────────────

describe("validateStop", () => {
  const happy = {
    session_id: "sess-1",
    stop_hook_active: false,
  }

  test("accepts a valid Stop payload", () => {
    const result = validateStop(happy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.session_id).toBe("sess-1")
      expect(result.data.stop_hook_active).toBe(false)
    }
  })

  test("rejects missing session_id", () => {
    const { session_id: _, ...rest } = happy
    const result = validateStop(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("session_id")
  })

  test("rejects non-boolean stop_hook_active", () => {
    const result = validateStop({ ...happy, stop_hook_active: "yes" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("stop_hook_active")
  })

  test("accepts optional last_assistant_message", () => {
    const result = validateStop({ ...happy, last_assistant_message: "done" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.last_assistant_message).toBe("done")
  })
})
