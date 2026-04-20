// hash-dir-router.js — Pure functions for parsing the #dir= hash fragment and
// deciding what project-tab action to take.
//
// These are extracted as pure functions so they are fully testable without
// a browser DOM. main.js calls them after hydrating tabs from localStorage.

const MAX_DIR_LENGTH = 512

/**
 * Parse and validate the `#dir=<encoded>` hash fragment from a URL hash string.
 *
 * @param {string} hash  The raw `location.hash` value (including the leading #).
 * @returns {{ ok: true, dir: string } | { ok: false, reason: string }}
 */
export function resolveDirFromHash(hash) {
  if (!hash || hash.trim() === '') {
    return { ok: false, reason: 'empty hash — no dir param' }
  }

  // Strip leading # and parse as URLSearchParams so the same format used in
  // connect.js (parseConnectHash) is consistent.
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const raw = params.get('dir')

  if (raw === null) {
    return { ok: false, reason: 'no dir param in hash' }
  }

  // Decode — URLSearchParams already URL-decodes values, but we need to handle
  // malformed percent sequences that slip past the URLSearchParams parser.
  let dir
  try {
    // URLSearchParams.get() already decodes, so `raw` is the decoded string.
    // We do an extra decodeURIComponent to catch any double-encoded inputs,
    // but use the already-decoded `raw` as the primary value.
    dir = raw
    // Validate that the raw (still-encoded) string is decodable if passed
    // directly (catches %ZZ etc that URLSearchParams silently passes through).
    decodeURIComponent(params.get('dir') ?? '')
  } catch {
    return { ok: false, reason: 'decode error — malformed percent sequence' }
  }

  if (!dir || dir.trim() === '') {
    return { ok: false, reason: 'empty dir after decoding' }
  }

  if (dir.length > MAX_DIR_LENGTH) {
    return { ok: false, reason: `too long — ${dir.length} chars exceeds ${MAX_DIR_LENGTH}` }
  }

  // Null byte check — path traversal / injection guard
  if (dir.includes('\x00')) {
    return { ok: false, reason: 'null byte in path — rejected' }
  }

  // Path traversal check — reject any decoded path that contains /../
  // (A legitimate absolute path never needs ..)
  if (dir.includes('..')) {
    return { ok: false, reason: 'path traversal detected (..) — rejected' }
  }

  return { ok: true, dir: dir.trim() }
}

/**
 * Given a validated directory and the current list of project tabs, decide
 * whether to activate an existing tab or create a new one.
 *
 * @param {string} dir         The validated, decoded directory path.
 * @param {Array<{ id: string, directory: string|null, label: string }>} tabs
 *        The current projectTabs array from state.js.
 * @returns {{ action: 'activate', tabId: string }
 *          | { action: 'create', dir: string, label: string }}
 */
export function resolveTabAction(dir, tabs) {
  const existing = tabs.find(t => (t.directory ?? null) === dir)
  if (existing) {
    return { action: 'activate', tabId: existing.id }
  }

  const label = _defaultTabLabel(dir)
  return { action: 'create', dir, label }
}

/**
 * Derive a human-readable label from a directory path.
 * Mirrors the logic in state.js::defaultTabLabel to keep labels consistent.
 *
 * @param {string} directory
 * @returns {string}
 */
function _defaultTabLabel(directory) {
  if (!directory) return 'default'
  const parts = String(directory).split('/').filter(Boolean)
  return parts[parts.length - 1] || directory
}
