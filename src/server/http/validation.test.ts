import { describe, it, expect } from "bun:test"
import { validateBody, type BodySchema } from "./validation"

describe("validateBody", () => {
  it("accepts valid body matching schema", () => {
    const schema: BodySchema = { name: "string", age: "number" }
    const result = validateBody({ name: "Alice", age: 30 }, schema)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ name: "Alice", age: 30 })
    }
  })

  it("rejects non-object body", () => {
    const schema: BodySchema = { x: "string" }
    const result = validateBody("hello", schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain("object")
    }
  })

  it("rejects null body", () => {
    const schema: BodySchema = { x: "string" }
    const result = validateBody(null, schema)
    expect(result.ok).toBe(false)
  })

  it("rejects missing required string field", () => {
    const schema: BodySchema = { name: "string" }
    const result = validateBody({}, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.details.some((d) => d.field === "name")).toBe(true)
    }
  })

  it("rejects wrong type for required field", () => {
    const schema: BodySchema = { count: "number" }
    const result = validateBody({ count: "five" }, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.details.some((d) => d.field === "count")).toBe(true)
    }
  })

  it("allows missing optional-string field", () => {
    const schema: BodySchema = { name: "string", bio: "optional-string" }
    const result = validateBody({ name: "Bob" }, schema)
    expect(result.ok).toBe(true)
  })

  it("rejects optional-string field with wrong type when present", () => {
    const schema: BodySchema = { bio: "optional-string" }
    const result = validateBody({ bio: 42 }, schema)
    expect(result.ok).toBe(false)
  })

  it("allows missing optional-number field", () => {
    const schema: BodySchema = { port: "optional-number" }
    const result = validateBody({}, schema)
    expect(result.ok).toBe(true)
  })

  it("rejects optional-number field with wrong type when present", () => {
    const schema: BodySchema = { port: "optional-number" }
    const result = validateBody({ port: "abc" }, schema)
    expect(result.ok).toBe(false)
  })

  it("accumulates multiple errors", () => {
    const schema: BodySchema = { a: "string", b: "number" }
    const result = validateBody({ a: 1, b: "x" }, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.details.length).toBeGreaterThanOrEqual(2)
    }
  })

  it("accepts boolean fields", () => {
    const schema: BodySchema = { active: "boolean" }
    const result = validateBody({ active: true }, schema)
    expect(result.ok).toBe(true)
  })

  it("rejects boolean field with wrong type", () => {
    const schema: BodySchema = { active: "boolean" }
    const result = validateBody({ active: "yes" }, schema)
    expect(result.ok).toBe(false)
  })

  it("passes unknown extra fields through untouched", () => {
    const schema: BodySchema = { name: "string" }
    const result = validateBody({ name: "X", extra: 123 }, schema)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.value as Record<string, unknown>).extra).toBe(123)
    }
  })
})
