// files-changed.js — Collapsible "Files changed" panel in the sidebar
// Shows per-file +/- line counts derived from the session diff.
import { fetchDiff } from '../api/api.js'
import { getState } from '../state/state.js'

const PANEL_ID  = 'files-changed-panel'
const COLLAPSED_KEY = 'pilot_files_collapsed'

// ── Minimal unified-diff parser ────────────────────────────────────────────
/**
 * Parse a unified diff string and return an array of:
 *   { path, added: number, removed: number }
 * Only the last 3 path segments are kept for display; full path is preserved
 * as .fullPath for click handlers.
 */
function parseDiff(diffText) {
  if (!diffText || !diffText.trim()) return []

  const files = []
  let current = null

  for (const line of diffText.split('\n')) {
    // +++ b/some/path  OR  +++ /some/path
    if (line.startsWith('+++ ')) {
      const raw = line.slice(4).replace(/^[ab]\//, '').trim()
      if (raw === '/dev/null') continue
      current = { fullPath: raw, path: shortenPath(raw), added: 0, removed: 0 }
      files.push(current)
      continue
    }
    if (!current) continue
    // Count actual add/del lines, ignore hunk headers and file markers
    if (line.startsWith('+') && !line.startsWith('+++')) { current.added++;   continue }
    if (line.startsWith('-') && !line.startsWith('---')) { current.removed++; continue }
  }

  return files
}

function shortenPath(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 3) return p
  return '…/' + parts.slice(-3).join('/')
}

// ── HTML helpers ───────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderPanel(container, files) {
  const collapsed = localStorage.getItem(COLLAPSED_KEY) === '1'
  container.className = 'files-changed-panel' + (collapsed ? ' collapsed' : '')

  if (!files.length) {
    container.innerHTML = `
      <div class="files-changed-header" id="files-changed-header">
        <span>Files Changed</span>
        <span class="files-changed-count">0</span>
        <span class="files-changed-chevron">▼</span>
      </div>
      <div class="files-changed-list">
        <div class="empty-state muted"><p>No file changes in this session.</p></div>
      </div>
    `
  } else {
    const rows = files.map(f => `
      <div class="files-changed-item" data-path="${esc(f.fullPath)}" title="${esc(f.fullPath)}">
        <span class="files-changed-path">${esc(f.path)}</span>
        <span class="files-changed-stats">
          <span class="files-changed-add">+${f.added}</span>
          <span class="files-changed-del">-${f.removed}</span>
        </span>
      </div>
    `).join('')

    container.innerHTML = `
      <div class="files-changed-header" id="files-changed-header">
        <span>Files Changed</span>
        <span class="files-changed-count">${files.length}</span>
        <span class="files-changed-chevron">▼</span>
      </div>
      <div class="files-changed-list">${rows}</div>
    `
  }

  // Toggle collapse
  container.querySelector('#files-changed-header')?.addEventListener('click', () => {
    container.classList.toggle('collapsed')
    localStorage.setItem(COLLAPSED_KEY, container.classList.contains('collapsed') ? '1' : '0')
  })

  // Click a file row → switch to the Diff tab
  container.querySelectorAll('.files-changed-item').forEach(el => {
    el.addEventListener('click', () => {
      // Activate the diff tab
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(t => t.classList.remove('active'))
      const diffTab = document.querySelector('.tab[data-tab="diff-tab"]')
      const diffPanel = document.getElementById('diff-tab')
      if (diffTab)  diffTab.classList.add('active')
      if (diffPanel) diffPanel.classList.add('active')
    })
  })
}

// ── Debounce helper ────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// ── Factory ────────────────────────────────────────────────────────────────
/**
 * createFilesChangedPanel({ container, state, api })
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container  — The DOM element to render into
 * @returns {{ refresh: (sessionId: string) => Promise<void>, destroy: () => void }}
 */
export function createFilesChangedPanel({ container }) {
  let destroyed = false
  // Track the last sessionId so the retry button can re-call refresh.
  let _currentSessionId = null

  async function refresh(sessionId) {
    if (destroyed) return
    if (!sessionId) {
      container.style.display = 'none'
      return
    }

    _currentSessionId = sessionId
    container.style.display = ''

    // Show loading state on first paint (when container is empty or showing old state)
    const alreadyHasContent = container.querySelector('.files-changed-header')
    if (!alreadyHasContent) {
      container.innerHTML = `<div class="empty-state"><div class="spinner-small"></div><p>Checking…</p></div>`
    }

    try {
      const data = await fetchDiff(sessionId)
      const diffText = typeof data === 'string'
        ? data
        : (data?.diff ?? data?.content ?? JSON.stringify(data, null, 2))

      try {
        const files = parseDiff(diffText)
        renderPanel(container, files)
      } catch (err) {
        console.error('[panel-error] files-changed-panel:', err)
        container.innerHTML = `<div class="empty-state error-state">
          <p>Couldn't load file changes.</p>
          <button class="btn btn-ghost" data-action="retry-files-changed">Retry</button>
        </div>`
      }
    } catch (_) {
      // Fetch failed — show error state
      container.innerHTML = `<div class="empty-state error-state">
        <p>Couldn't load file changes.</p>
        <button class="btn btn-ghost" data-action="retry-files-changed">Retry</button>
      </div>`
    }
  }

  // Debounced refresh for SSE events (500ms as specified)
  const debouncedRefresh = debounce((sessionId) => {
    refresh(sessionId).catch(() => {})
  }, 500)

  function destroy() {
    destroyed = true
    container.innerHTML = ''
    container.style.display = 'none'
  }

  // Expose retry globally for data-action delegation in main.js
  window.__retryFilesChanged = function() {
    if (_currentSessionId) refresh(_currentSessionId).catch(() => {})
  }

  return { refresh, debouncedRefresh, destroy }
}

// ── SSE event names that warrant a refresh ─────────────────────────────────
const FILE_EDITING_TOOLS = new Set(['write', 'edit', 'multiedit'])

/**
 * Returns true if the pilot.tool.completed event is for a file-editing tool.
 */
export function isFileEditingToolEvent(eventData) {
  const toolName = (eventData?.tool ?? eventData?.toolName ?? '').toLowerCase()
  return FILE_EDITING_TOOLS.has(toolName)
}
