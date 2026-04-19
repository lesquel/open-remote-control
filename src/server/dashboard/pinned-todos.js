// pinned-todos.js — Cross-session pinned TODO items
// Factory: createPinnedTodos({ container }) → { addItem, destroy }
//
// Items are persisted in localStorage under STORAGE_KEYS.PINNED_TODOS.
// Shape: Array<{ id, text, sessionId, sessionTitle, pinnedAt, status }>
//   id       — stable hash of text+sessionId (prevents duplicates)
//   status   — "pending" | "done"
//
// Sidebar section: collapsible, above sessions list.
// Filter tabs: Active | Done | All  (default: Active)
// Multi-tab sync via storage event.

import { STORAGE_KEYS, LIMITS } from './constants.js'

const MAX_PINNED = 100
const MAX_TEXT_DISPLAY = 80

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Stable hash of a string — djb2 variant.
 * @param {string} s
 * @returns {string}
 */
function hashString(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h = h >>> 0  // keep unsigned 32-bit
  }
  return h.toString(36)
}

/**
 * Generate a stable ID for a pinned item.
 * @param {string} text
 * @param {string} sessionId
 * @returns {string}
 */
export function pinnedItemId(text, sessionId) {
  return hashString(String(text) + '|' + String(sessionId))
}

// ── localStorage helpers (all try/catch) ────────────────────────────────────

/**
 * Read pinned todos from localStorage.
 * @returns {Array}
 */
export function readPinned() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PINNED_TODOS)
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

/**
 * Write pinned todos to localStorage. Silently swallows quota errors.
 * @param {Array} items
 */
function writePinned(items) {
  try {
    localStorage.setItem(STORAGE_KEYS.PINNED_TODOS, JSON.stringify(items))
  } catch (_) {}
}

/**
 * Add a pinned item. Deduplicates by id. Caps at MAX_PINNED.
 * Returns false if cap was hit (caller should prompt user).
 * @param {{ text: string, sessionId: string, sessionTitle: string }} opts
 * @returns {boolean} — true if added, false if cap exceeded
 */
export function pinItem({ text, sessionId, sessionTitle }) {
  const id = pinnedItemId(text, sessionId)
  const existing = readPinned()

  // Already pinned → no-op, success
  if (existing.some(i => i.id === id)) return true

  if (existing.length >= MAX_PINNED) {
    return false
  }

  const item = {
    id,
    text: String(text),
    sessionId: String(sessionId),
    sessionTitle: String(sessionTitle || sessionId.slice(0, 8) + '…'),
    pinnedAt: Date.now(),
    status: 'pending',
  }

  writePinned([...existing, item])
  return true
}

/**
 * Remove a pinned item by id.
 * @param {string} id
 */
export function unpinItem(id) {
  const existing = readPinned()
  writePinned(existing.filter(i => i.id !== id))
}

/**
 * Toggle status of a pinned item between pending and done.
 * @param {string} id
 */
export function togglePinnedStatus(id) {
  const existing = readPinned()
  writePinned(existing.map(i =>
    i.id === id
      ? { ...i, status: i.status === 'done' ? 'pending' : 'done' }
      : i
  ))
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * createPinnedTodos({ container })
 * @param {{ container: HTMLElement }} opts
 * @returns {{ addItem: (opts) => void, destroy: () => void }}
 */
export function createPinnedTodos({ container }) {
  if (!container) return { addItem: () => {}, destroy: () => {} }

  let _collapsed = false
  let _filter = 'active'  // 'active' | 'done' | 'all'

  try {
    _collapsed = localStorage.getItem('pilot_pinned_todos_collapsed') === 'true'
  } catch (_) {}

  // ── DOM skeleton ──────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="pinned-todos" id="pinned-todos-root">
      <div class="pinned-todos-header" id="pinned-todos-header">
        <span class="pinned-todos-title">Pinned</span>
        <button class="pinned-todos-toggle" id="pinned-todos-chevron" title="Expand/collapse">▾</button>
      </div>
      <div class="pinned-todos-filters" id="pinned-todos-filters">
        <button class="ptf-btn ptf-btn--active" data-filter="active">Active</button>
        <button class="ptf-btn" data-filter="done">Done</button>
        <button class="ptf-btn" data-filter="all">All</button>
      </div>
      <div class="pinned-todos-body" id="pinned-todos-body"></div>
    </div>
  `

  const root     = container.querySelector('#pinned-todos-root')
  const bodyEl   = container.querySelector('#pinned-todos-body')
  const chevron  = container.querySelector('#pinned-todos-chevron')
  const filtersEl = container.querySelector('#pinned-todos-filters')

  _applyCollapsed()
  _render()

  // ── Events ─────────────────────────────────────────────────────────────────

  chevron.addEventListener('click', () => {
    _collapsed = !_collapsed
    _applyCollapsed()
    try { localStorage.setItem('pilot_pinned_todos_collapsed', String(_collapsed)) } catch (_) {}
  })

  filtersEl.addEventListener('click', e => {
    const btn = e.target.closest('.ptf-btn')
    if (!btn) return
    _filter = btn.dataset.filter
    filtersEl.querySelectorAll('.ptf-btn').forEach(b => b.classList.toggle('ptf-btn--active', b.dataset.filter === _filter))
    _render()
  })

  // Delegate clicks inside body — unpin + toggle + session jump
  bodyEl.addEventListener('click', e => {
    const unpinBtn = e.target.closest('.pt-unpin')
    if (unpinBtn) {
      const id = unpinBtn.dataset.id
      unpinItem(id)
      _render()
      return
    }
    const checkbox = e.target.closest('.pt-check')
    if (checkbox) {
      const id = checkbox.dataset.id
      togglePinnedStatus(id)
      _render()
      return
    }
    const sessionLink = e.target.closest('.pt-session-link')
    if (sessionLink) {
      e.preventDefault()
      const sessionId = sessionLink.dataset.sessionId
      if (sessionId) {
        import('./sessions.js').then(m => m.selectSession(sessionId)).catch(() => {})
      }
    }
  })

  // Multi-tab sync
  function _onStorage(e) {
    if (e.key === STORAGE_KEYS.PINNED_TODOS) _render()
  }
  window.addEventListener('storage', _onStorage)

  // ── Render ─────────────────────────────────────────────────────────────────

  function _applyCollapsed() {
    root.classList.toggle('pinned-todos--collapsed', _collapsed)
    chevron.textContent = _collapsed ? '▸' : '▾'
    // Hide filters when collapsed
    filtersEl.style.display = _collapsed ? 'none' : ''
  }

  function _render() {
    if (_collapsed) return

    const all = readPinned()
    const visible = all.filter(i => {
      if (_filter === 'active') return i.status !== 'done'
      if (_filter === 'done')   return i.status === 'done'
      return true
    })

    if (!visible.length) {
      const emptyMsg = all.length === 0
        ? 'No pinned items yet. Click [+] on a todo item.'
        : `No ${_filter} items.`
      bodyEl.innerHTML = `<div class="pt-empty">${esc(emptyMsg)}</div>`
      return
    }

    bodyEl.innerHTML = visible.map(item => {
      const isDone = item.status === 'done'
      const textDisplay = esc(String(item.text).slice(0, MAX_TEXT_DISPLAY) + (item.text.length > MAX_TEXT_DISPLAY ? '…' : ''))
      const checkIcon = isDone
        ? `<svg class="pt-check-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="1"/><polyline points="2.5,6 5,9 9.5,3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : `<svg class="pt-check-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="12" height="12" rx="2" stroke="currentColor" stroke-width="1"/></svg>`
      const sessionTitle = esc(String(item.sessionTitle || '').slice(0, 20))
      const doneCls = isDone ? ' pt-item--done' : ''

      return `<div class="pt-item${doneCls}" data-id="${esc(item.id)}">
        <button class="pt-check" data-id="${esc(item.id)}" title="${isDone ? 'Mark active' : 'Mark done'}" aria-label="${isDone ? 'Mark active' : 'Mark done'}">${checkIcon}</button>
        <div class="pt-content">
          <span class="pt-text" title="${esc(item.text)}">${textDisplay}</span>
          <a href="#" class="pt-session-link" data-session-id="${esc(item.sessionId)}" title="Jump to session">${sessionTitle}</a>
        </div>
        <button class="pt-unpin" data-id="${esc(item.id)}" title="Unpin" aria-label="Unpin">
          <svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" width="8" height="8"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>`
    }).join('')
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Pin an item. Call from outside (e.g., messages.js).
   * Handles cap exceeded case — prompts user to clear done items.
   * @param {{ text: string, sessionId: string, sessionTitle: string }} opts
   */
  function addItem(opts) {
    const added = pinItem(opts)
    if (!added) {
      // Cap exceeded — offer to clear done items
      const all = readPinned()
      const doneCount = all.filter(i => i.status === 'done').length
      if (doneCount > 0 && confirm(`Pinned items limit (${MAX_PINNED}) reached. Clear ${doneCount} done item(s)?`)) {
        writePinned(all.filter(i => i.status !== 'done'))
        pinItem(opts)  // retry
      }
      // else: user declined — silently ignore
    }
    _render()
  }

  function destroy() {
    window.removeEventListener('storage', _onStorage)
    container.innerHTML = ''
  }

  return { addItem, destroy }
}
