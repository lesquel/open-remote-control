// RED: sessions-validators hardening — B2
// validatePromptBody: parts per-element validation, model field length caps,
// agent length cap.

import { describe, it, expect } from "bun:test"
import {
  validatePromptBody,
  validateCreateSession,
  validateUpdateSession,
} from "./sessions"

// ─── validatePromptBody — existing happy paths ────────────────────────────────

describe("validatePromptBody — happy paths", () => {
  it("accepts a valid message", () => {
    const result = validatePromptBody({ message: "hello" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.message).toBe("hello")
  })

  it("accepts valid parts array", () => {
    const result = validatePromptBody({
      parts: [{ type: "text", text: "hi" }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.parts?.length).toBe(1)
  })

  it("accepts message with valid model", () => {
    const result = validatePromptBody({
      message: "hi",
      model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
    })
    expect(result.ok).toBe(true)
  })

  it("accepts message with valid agent", () => {
    const result = validatePromptBody({ message: "hi", agent: "coding" })
    expect(result.ok).toBe(true)
  })
})

// ─── validatePromptBody — B2: parts per-element validation ───────────────────

describe("validatePromptBody — parts per-element validation (B2)", () => {
  it("rejects parts containing a null element", () => {
    const result = validatePromptBody({ parts: [null] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/part|element/i)
  })

  it("rejects parts containing a non-object element (string)", () => {
    const result = validatePromptBody({ parts: ["text-string"] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/part|element/i)
  })

  it("rejects parts containing an element missing type", () => {
    const result = validatePromptBody({ parts: [{ text: "hi" }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/type|part/i)
  })

  it("rejects parts containing an element with empty-string type", () => {
    const result = validatePromptBody({ parts: [{ type: "" }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/type|part/i)
  })

  it("rejects parts containing an element with non-string type (number)", () => {
    const result = validatePromptBody({ parts: [{ type: 42 }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/type|part/i)
  })

  it("accepts parts where every element is valid", () => {
    const result = validatePromptBody({
      parts: [{ type: "text", text: "hi" }, { type: "image_url", url: "http://x.com/img.png" }],
    })
    expect(result.ok).toBe(true)
  })
})

// ─── validatePromptBody — B2: dashboard regression (empty providerID is valid) ─

describe("validatePromptBody — dashboard regression: empty providerID (B2)", () => {
  // The dashboard sends providerID:'' when no provider override is selected
  // (sessions.js:748 opts.providerID = modelPref.providerId ?? '').
  // The validator MUST accept this — rejecting it silently drops the prompt.
  it("accepts the exact dashboard payload: model.providerID='' with a valid modelID", () => {
    const result = validatePromptBody({
      message: "hi",
      model: { modelID: "claude-x", providerID: "" },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.model?.modelID).toBe("claude-x")
      expect(result.data.model?.providerID).toBe("")
    }
  })

  it("still rejects empty modelID (meaningful field)", () => {
    const result = validatePromptBody({
      message: "hi",
      model: { modelID: "", providerID: "anthropic" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/modelID/i)
  })

  it("still accepts a normal message with no model (baseline unchanged)", () => {
    const result = validatePromptBody({ message: "hello" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.model).toBeUndefined()
  })
})

// ─── validatePromptBody — B2: model field length caps ────────────────────────

describe("validatePromptBody — model length caps (B2)", () => {
  it("rejects model.providerID > 200 chars", () => {
    const result = validatePromptBody({
      message: "hi",
      model: { providerID: "p".repeat(201), modelID: "claude-3-5" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/providerID/i)
  })

  it("rejects model.modelID > 200 chars", () => {
    const result = validatePromptBody({
      message: "hi",
      model: { providerID: "anthropic", modelID: "m".repeat(201) },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/modelID/i)
  })

  it("accepts model at limit (200 chars each)", () => {
    const result = validatePromptBody({
      message: "hi",
      model: { providerID: "p".repeat(200), modelID: "m".repeat(200) },
    })
    expect(result.ok).toBe(true)
  })

  it("accepts empty providerID (dashboard sends '' when no provider is selected)", () => {
    // Contract: providerID MAY be empty — the meaningful field is modelID.
    // The dashboard sets providerID: modelPref.providerId ?? '' so empty is a
    // valid real-world value, not a programmer error.
    const result = validatePromptBody({
      message: "hi",
      model: { providerID: "", modelID: "claude-3-5" },
    })
    expect(result.ok).toBe(true)
  })

  it("rejects empty modelID", () => {
    const result = validatePromptBody({
      message: "hi",
      model: { providerID: "anthropic", modelID: "" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/modelID/i)
  })
})

// ─── validatePromptBody — B2: agent length cap ───────────────────────────────

describe("validatePromptBody — agent length cap (B2)", () => {
  it("rejects agent > 200 chars", () => {
    const result = validatePromptBody({ message: "hi", agent: "a".repeat(201) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/agent/i)
  })

  it("accepts agent at limit (200 chars)", () => {
    const result = validatePromptBody({ message: "hi", agent: "a".repeat(200) })
    expect(result.ok).toBe(true)
  })
})

// ─── validateCreateSession & validateUpdateSession — pre-existing coverage ───

describe("validateCreateSession — baseline", () => {
  it("accepts empty body", () => {
    const result = validateCreateSession({})
    expect(result.ok).toBe(true)
  })

  it("accepts body with valid title", () => {
    const result = validateCreateSession({ title: "My session" })
    expect(result.ok).toBe(true)
  })

  it("rejects non-string title", () => {
    const result = validateCreateSession({ title: 123 })
    expect(result.ok).toBe(false)
  })

  it("rejects title > 200 chars", () => {
    const result = validateCreateSession({ title: "t".repeat(201) })
    expect(result.ok).toBe(false)
  })
})

describe("validateUpdateSession — baseline", () => {
  it("accepts valid title", () => {
    const result = validateUpdateSession({ title: "New name" })
    expect(result.ok).toBe(true)
  })

  it("rejects missing title", () => {
    const result = validateUpdateSession({})
    expect(result.ok).toBe(false)
  })

  it("rejects empty title", () => {
    const result = validateUpdateSession({ title: "   " })
    expect(result.ok).toBe(false)
  })
})
