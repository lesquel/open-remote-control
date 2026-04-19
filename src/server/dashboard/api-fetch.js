// api-fetch.js — Fetch wrapper with retry / exponential backoff.
// Used for idempotent reads. Do NOT use for mutating endpoints (POST/PATCH/DELETE)
// since retrying those can cause duplicate side effects.

// Status codes that are safe to retry.
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

// Backoff delays in ms for attempts 1, 2, 3 (attempt 0 runs immediately).
const BACKOFF_MS = [250, 500, 1000, 2000]

// Maximum delay to honour from a Retry-After header (seconds).
const RETRY_AFTER_CAP_S = 5

/**
 * Error thrown when all retry attempts are exhausted.
 * @typedef {{ url: string, status: number | null, attempts: number, body: string | null }} ApiErrorInfo
 */
export class ApiError extends Error {
  /**
   * @param {string} url
   * @param {number | null} status
   * @param {number} attempts
   * @param {string | null} body
   */
  constructor(url, status, attempts, body) {
    super(`[apiFetch] ${url} failed after ${attempts} attempt${attempts !== 1 ? 's' : ''}`)
    this.name = 'ApiError'
    this.url = url
    this.status = status
    this.attempts = attempts
    this.body = body
  }
}

/**
 * Wraps fetch() with automatic retry on network errors and retryable HTTP statuses.
 * Retries up to 4 total attempts using exponential backoff (250 → 500 → 1000 → 2000 ms).
 * Respects the Retry-After header on 429 (capped at 5 s).
 * Aborts immediately on AbortSignal cancellation.
 * Never retries 4xx errors other than 429.
 *
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, opts = {}) {
  const maxAttempts = BACKOFF_MS.length
  let lastStatus = null
  let lastBody = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Respect AbortSignal before each attempt
    if (opts.signal && opts.signal.aborted) {
      const err = new ApiError(url, lastStatus, attempt, lastBody)
      err.message = `[apiFetch] ${url} aborted`
      throw err
    }

    try {
      const res = await fetch(url, opts)

      // Non-retryable success or client error
      if (!RETRYABLE_STATUSES.has(res.status)) {
        return res
      }

      // Retryable status — capture for error reporting
      lastStatus = res.status
      try {
        lastBody = await res.clone().text()
      } catch {
        lastBody = null
      }

      // Last attempt — do not sleep, fall through to throw
      if (attempt === maxAttempts - 1) break

      // Honour Retry-After header on 429
      let delayMs = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After')
        if (retryAfter) {
          const seconds = parseFloat(retryAfter)
          if (Number.isFinite(seconds) && seconds > 0) {
            delayMs = Math.min(seconds * 1000, RETRY_AFTER_CAP_S * 1000)
          }
        }
      }

      await sleep(delayMs, opts.signal)
    } catch (err) {
      // Re-throw AbortError immediately
      if (err && (err.name === 'AbortError' || (opts.signal && opts.signal.aborted))) {
        const apiErr = new ApiError(url, lastStatus, attempt + 1, lastBody)
        apiErr.message = `[apiFetch] ${url} aborted`
        throw apiErr
      }

      // Re-throw ApiError (from nested calls or sleep abort)
      if (err instanceof ApiError) throw err

      // Network error (TypeError: failed to fetch, etc.)
      lastBody = err instanceof Error ? err.message : String(err)

      // Last attempt
      if (attempt === maxAttempts - 1) break

      const delayMs = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
      try {
        await sleep(delayMs, opts.signal)
      } catch (sleepErr) {
        // AbortSignal fired during sleep
        const apiErr = new ApiError(url, lastStatus, attempt + 1, lastBody)
        apiErr.message = `[apiFetch] ${url} aborted`
        throw apiErr
      }
    }
  }

  // All attempts exhausted
  console.warn(`[apiFetch] ${url} failed after ${maxAttempts} attempts`, { status: lastStatus })
  throw new ApiError(url, lastStatus, maxAttempts, lastBody)
}

/**
 * @param {number} ms
 * @param {AbortSignal | undefined} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }
  })
}
