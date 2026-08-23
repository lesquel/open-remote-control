// ─── Bounded text reader ───────────────────────────────────────────────────────
// Streams request body up to a byte limit. Lives in infra/ so integrations/
// can import it without violating the sibling cross-import rule.

/**
 * Read a request body up to `maxBytes`, streaming chunk-by-chunk so that
 * chunked-encoded requests (no Content-Length) are also bounded.
 *
 * Returns the body text on success, or `null` if the body exceeds `maxBytes`.
 * Returns an empty string when the body is absent.
 *
 * Use this instead of bare `req.text()` in handlers that accept untrusted input
 * from external callers (e.g. Codex hook bridge) where Content-Length cannot
 * be trusted.
 */
export async function readBoundedBytes(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  let total = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        try { await reader.cancel() } catch {
          // Provably irrelevant: cancel() is best-effort stream teardown after
          // we have already decided to reject the body. Failure here (e.g. the
          // request stream was already closed by the client) does not affect
          // the null return or downstream handling.
        }
        return null
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch {
      // Provably irrelevant: releaseLock() is finally-block cleanup. Failure
      // (e.g. lock already released by a prior cancel()) does not affect the
      // return value or any downstream processing.
    }
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export async function readBoundedText(req: Request, maxBytes: number): Promise<string | null> {
  const bytes = await readBoundedBytes(req, maxBytes)
  return bytes === null ? null : new TextDecoder().decode(bytes)
}
