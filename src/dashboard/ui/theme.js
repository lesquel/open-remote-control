// theme.js — Unified theme management for the dashboard.
//
// The 4 themes correspond to [data-theme="..."] blocks in tokens.css.
// The 'terminal-green' theme is the default (:root values in tokens.css).
// Persistence uses localStorage key 'pilot-theme' — the same key used by
// the landing page, so both surfaces share theme state on the same origin.
//
// FOUC prevention: index.html <head> sets [data-theme] synchronously before
// the first paint via an inline script. This module manages subsequent changes.

/** @type {readonly string[]} — ordered theme tuple */
export const THEMES = /** @type {const} */ (['terminal-green', 'amber', 'violet', 'mono-light'])

/** Human-readable labels for the theme picker UI */
export const THEME_LABELS = /** @type {Record<string, string>} */ ({
  'terminal-green': 'Terminal green',
  'amber':          'Amber',
  'violet':         'Violet',
  'mono-light':     'Light (mono)',
})

/** localStorage key shared with the landing page */
export const STORAGE_KEY = 'pilot-theme'

const DEFAULT_THEME = 'terminal-green'

/**
 * Validate that `t` is a known theme name.
 * @param {unknown} t
 * @returns {string} a valid theme name
 */
function validateTheme(t) {
  if (typeof t === 'string' && THEMES.includes(t)) return t
  return DEFAULT_THEME
}

/**
 * Apply a theme: sets [data-theme] on <html>, updates <meta theme-color>,
 * and persists to localStorage.
 *
 * @param {string} t — theme name. Falls back to 'terminal-green' if unknown.
 */
export function applyTheme(t) {
  const theme = validateTheme(t)
  document.documentElement.setAttribute('data-theme', theme)

  // Update <meta name="theme-color"> so mobile browser chrome reflects the
  // current theme. Computed after the attribute is applied so CSS has resolved.
  const metaEl = document.querySelector('meta[name="theme-color"]')
  if (metaEl) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (bg) metaEl.setAttribute('content', bg)
  }

  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch (err) {
    // localStorage is unavailable (private mode, storage quota) — the theme is
    // still applied visually, but won't persist across sessions.
    console.error('[theme] Failed to persist theme to localStorage:', err)
  }
}

/**
 * Return the active theme name, reading from:
 *   1. [data-theme] on <html> (set synchronously by the FOUC inline script)
 *   2. localStorage (fallback if the attribute is absent)
 *   3. 'terminal-green' (hard default)
 *
 * @returns {string}
 */
export function getActiveTheme() {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr && THEMES.includes(attr)) return attr

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && THEMES.includes(stored)) return stored
  } catch (_) {
    // localStorage unavailable — use default
  }

  return DEFAULT_THEME
}

/**
 * Advance to the next theme in THEMES order, wrapping after the last.
 * Calls applyTheme() which handles persistence and meta-color update.
 */
export function cycleTheme() {
  const current = getActiveTheme()
  const idx = THEMES.indexOf(current)
  const next = THEMES[(idx + 1) % THEMES.length]
  applyTheme(next)
  return next
}
