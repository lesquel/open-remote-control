// cost-panel.js — Session cost display + daily/weekly aggregate + budget alert
// Factory: createCostPanel({ container }) → { updateSession, destroy }
//
// Cost data flows:
//   1. Caller passes sessionId + normalised assistant messages on each render.
//   2. Panel sums cost from messages, persists per-date/per-session totals in
//      localStorage under STORAGE_KEYS.COST_HISTORY.
//   3. Collapsible panel shows: session cost, today total, week total,
//      top-3 sessions today.
//   4. When today's total exceeds settings.dailyBudget, shows one toast per day.

import { getState } from './state.js'
import { toast } from './toast.js'
import { STORAGE_KEYS } from './constants.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Extract numeric cost from a normalised message.
 * Defensive: cost may be a number, an object {total,input,...}, or absent.
 * @param {object} m  normalised message (from normalizeMessage())
 * @returns {number}
 */
function extractCost(m) {
  const c = m?.cost
  if (typeof c === 'number') return c
  if (c && typeof c === 'object') {
    return c.total ?? ((c.input ?? 0) + (c.output ?? 0) + (c.cacheRead ?? 0) + (c.cacheWrite ?? 0))
  }
  return 0
}

/**
 * Sum cost across all normalised assistant messages.
 * @param {Array} msgs  normalised messages
 * @returns {number}
 */
export function sumSessionCost(msgs) {
  if (!Array.isArray(msgs)) return 0
  let total = 0
  for (const m of msgs) {
    if (m?.role === 'assistant') total += extractCost(m)
  }
  return total
}

// ── localStorage helpers (all wrapped in try/catch) ──────────────────────

/**
 * Read full cost history from localStorage.
 * Shape: { "YYYY-MM-DD": { sessions: { "sessId": number }, total: number } }
 * @returns {object}
 */
function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.COST_HISTORY) || '{}') ?? {}
  } catch (_) {
    return {}
  }
}

/**
 * Write cost history to localStorage. Silently swallows quota errors.
 * @param {object} h
 */
function writeHistory(h) {
  try {
    localStorage.setItem(STORAGE_KEYS.COST_HISTORY, JSON.stringify(h))
  } catch (_) {}
}

/**
 * Update today's entry for a given session with a new cost value.
 * @param {string} sessionId
 * @param {number} sessionCost
 */
export function upsertCostHistory(sessionId, sessionCost) {
  if (!sessionId || typeof sessionCost !== 'number') return
  const h = readHistory()
  const key = todayKey()
  if (!h[key]) h[key] = { sessions: {}, total: 0 }
  // Replace (not add) — caller provides the full session total
  h[key].sessions[sessionId] = sessionCost
  // Recompute daily total from all sessions for today
  h[key].total = Object.values(h[key].sessions).reduce((a, b) => a + b, 0)
  writeHistory(h)
}

/**
 * Compute week total: sum of the last 7 calendar days (including today).
 * @returns {number}
 */
function weekTotal() {
  const h = readHistory()
  let sum = 0
  const now = Date.now()
  for (let i = 0; i < 7; i++) {
    const d = new Date(now - i * 86400000)
    const k = d.toISOString().slice(0, 10)
    sum += h[k]?.total ?? 0
  }
  return sum
}

/**
 * Get today's aggregate data.
 * @returns {{ total: number, sessions: object }}
 */
function todayData() {
  const h = readHistory()
  return h[todayKey()] ?? { total: 0, sessions: {} }
}

/**
 * Check budget threshold and fire a toast if exceeded — at most once per day.
 * @param {number} todayTotal
 * @param {number} budget  — 0 or negative means disabled
 */
function checkBudget(todayTotal, budget) {
  if (!budget || budget <= 0) return
  if (todayTotal < budget) return
  const warnKey = STORAGE_KEYS.COST_BUDGET_WARNED
  try {
    const lastWarned = localStorage.getItem(warnKey)
    const today = todayKey()
    if (lastWarned === today) return  // already warned today
    localStorage.setItem(warnKey, today)
  } catch (_) {}
  toast(`Budget alert: today's cost $${todayTotal.toFixed(2)} exceeds limit $${budget.toFixed(2)}`)
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * createCostPanel({ container })
 * @param {{ container: HTMLElement }} opts
 * @returns {{ updateSession: (sessionId: string, normalizedMsgs: Array) => void, destroy: () => void }}
 */
export function createCostPanel({ container }) {
  if (!container) return { updateSession: () => {}, destroy: () => {} }

  let _collapsed = false
  try {
    _collapsed = localStorage.getItem('pilot_cost_panel_collapsed') === 'true'
  } catch (_) {}

  let _sessionCost = 0
  let _sessionId = null

  // ── Build DOM skeleton ──────────────────────────────────────────────────
  container.innerHTML = `
    <div class="cost-panel" id="cost-panel-root">
      <div class="cost-panel-header" id="cost-panel-header">
        <span class="cost-panel-title">Cost</span>
        <button class="cost-panel-toggle" id="cost-panel-chevron" title="Expand/collapse">▾</button>
      </div>
      <div class="cost-panel-body" id="cost-panel-body"></div>
    </div>
  `

  const root    = container.querySelector('#cost-panel-root')
  const bodyEl  = container.querySelector('#cost-panel-body')
  const chevron = container.querySelector('#cost-panel-chevron')

  _applyCollapsed()

  chevron.addEventListener('click', () => {
    _collapsed = !_collapsed
    _applyCollapsed()
    try { localStorage.setItem('pilot_cost_panel_collapsed', String(_collapsed)) } catch (_) {}
  })

  // ── Render ──────────────────────────────────────────────────────────────

  function _applyCollapsed() {
    root.classList.toggle('cost-panel--collapsed', _collapsed)
    chevron.textContent = _collapsed ? '▸' : '▾'
  }

  function _render() {
    if (_collapsed) return

    const today  = todayData()
    const todayT = today.total
    const weekT  = weekTotal()

    // Top 3 sessions today by cost
    const sessionsSorted = Object.entries(today.sessions ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)

    const sessions = getState().sessions ?? {}

    const top3Html = sessionsSorted.length
      ? sessionsSorted.map(([id, cost]) => {
          const title = sessions[id]?.title
            ? escHtml(sessions[id].title.slice(0, 28))
            : escHtml(id.slice(0, 8) + '…')
          return `<div class="cost-session-row">
            <span class="cost-session-title">${title}</span>
            <span class="cost-session-amount">$${cost.toFixed(4)}</span>
          </div>`
        }).join('')
      : `<div class="cost-empty">No cost data yet</div>`

    bodyEl.innerHTML = `
      <div class="cost-stat-row">
        <span class="cost-label">Session</span>
        <span class="cost-value">$${_sessionCost.toFixed(4)}</span>
      </div>
      <div class="cost-stat-row">
        <span class="cost-label">Today</span>
        <span class="cost-value">$${todayT.toFixed(2)}</span>
      </div>
      <div class="cost-stat-row">
        <span class="cost-label">Week</span>
        <span class="cost-value">$${weekT.toFixed(2)}</span>
      </div>
      <div class="cost-top-label">Top sessions today</div>
      ${top3Html}
    `
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Called by main.js / right-panel.js whenever messages are refreshed.
   * @param {string} sessionId
   * @param {Array}  normalizedMsgs  — output of normalizeMessage(), role may be user or assistant
   */
  function updateSession(sessionId, normalizedMsgs) {
    if (!sessionId || !Array.isArray(normalizedMsgs)) return

    _sessionId = sessionId
    _sessionCost = sumSessionCost(normalizedMsgs)

    // Persist to history
    upsertCostHistory(sessionId, _sessionCost)

    // Budget check
    const budget = getState().settings?.dailyBudget ?? 0
    if (budget > 0) {
      const today = todayData()
      checkBudget(today.total, budget)
    }

    _render()
  }

  function destroy() {
    container.innerHTML = ''
  }

  // Initial render (empty)
  _render()

  return { updateSession, destroy }
}
