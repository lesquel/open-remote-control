import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "../api/api.js"), "utf8")

describe("dashboard API correlation contract", () => {
  test("attaches the server request ID to surfaced HTTP errors", () => {
    expect(source).toContain("r.headers.get('x-request-id')")
    expect(source).toContain("Error ID: ${requestId}")
    expect(source).toContain("err.requestId = requestId")
  })
})
