// ─── URL extractor with chunk buffering ──────────────────────────────────────
// Cloudflared (and ngrok) write their public URL to stdout/stderr. Because the
// URL is emitted over a child-process pipe, TCP/OS buffering can split a single
// logical line across multiple `data` events. Matching each chunk in isolation
// silently misses URLs that arrive fragmented.
//
// `createUrlExtractor` accumulates all received text in a rolling buffer and
// runs the regex against the cumulative buffer on every call to `feed()`. The
// buffer is capped at `maxBytes` (default 64 KiB) so that a runaway process
// that never emits a URL cannot grow memory without bound.

const DEFAULT_MAX_BYTES = 64 * 1024 // 64 KiB

export interface UrlExtractorOptions {
  /** Maximum number of characters to keep in the rolling buffer (default: 65536). */
  maxBytes?: number
}

export interface UrlExtractor {
  /**
   * Feed the next chunk of text from the subprocess stream.
   * Returns the matched URL string if the pattern now matches the accumulated
   * buffer, or `null` if the URL has not yet been found.
   */
  feed(chunk: string): string | null
}

/**
 * Create a stateful URL extractor for a subprocess stream.
 *
 * @param pattern - The regex to search for in the accumulated buffer.
 *                  Must NOT have the `g` (global) flag — `String.prototype.match`
 *                  with a global regex returns all matches as strings, not a
 *                  `RegExpMatchArray`, so `match[0]` would be the first full match
 *                  anyway, but using a non-global regex is cleaner and avoids
 *                  lastIndex surprises.
 * @param options  - Optional configuration.
 */
export function createUrlExtractor(
  pattern: RegExp,
  options: UrlExtractorOptions = {},
): UrlExtractor {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  // Use a non-global copy of the pattern to avoid lastIndex state issues.
  const safePattern = pattern.global
    ? new RegExp(pattern.source, pattern.flags.replace("g", ""))
    : pattern

  let buffer = ""

  return {
    feed(chunk: string): string | null {
      buffer += chunk

      // Keep only the trailing `maxBytes` characters to bound memory use.
      // We trim from the front so newly arriving data is always at the end.
      if (buffer.length > maxBytes) {
        buffer = buffer.slice(buffer.length - maxBytes)
      }

      const match = buffer.match(safePattern)
      if (match) {
        return match[0]
      }
      return null
    },
  }
}
