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
export async function readBoundedText(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return ""
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let result = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        try { reader.cancel() } catch {
          // Provably irrelevant: cancel() is best-effort stream teardown after
          // we have already decided to reject the body. Failure here (e.g. the
          // request stream was already closed by the client) does not affect
          // the null return or downstream handling.
        }
        return null
      }
      result += decoder.decode(value, { stream: true })
    }
    result += decoder.decode()
  } finally {
    try { reader.releaseLock() } catch {
      // Provably irrelevant: releaseLock() is finally-block cleanup. Failure
      // (e.g. lock already released by a prior cancel()) does not affect the
      // return value or any downstream processing.
    }
  }
  return result
}
