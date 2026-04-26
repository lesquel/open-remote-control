// diff.js — Diff rendering
import { escapeHtml } from '../components/markdown.js'
import { fetchDiff } from '../api/api.js'

/**
 * Convert raw unified diff text to an HTML block.
 */
export function renderDiff(diffText) {
  if (!diffText || !diffText.trim()) {
    return '<div style="color:var(--text-dim);padding:8px">No diff available.</div>'
  }
  const lines = diffText.split('\n').map(line => {
    let cls = 'diff-line'
    if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add'
    else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del'
    else if (line.startsWith('@@')) cls += ' diff-hunk'
    return `<div class="${cls}">${escapeHtml(line)}</div>`
  })
  return `<div class="diff-container">${lines.join('')}</div>`
}

/**
 * Load and render diff for a session into #diff-panel.
 */
export async function loadDiff(sessionId) {
  const panel = document.getElementById('diff-panel')
  panel.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:10px">Loading diff…</div>'
  try {
    const data = await fetchDiff(sessionId)
    const diffText = typeof data === 'string'
      ? data
      : (data.diff ?? data.content ?? JSON.stringify(data, null, 2))
    try {
      panel.innerHTML = renderDiff(diffText)
    } catch (err) {
      console.error('[panel-error] diff-panel:', err)
      panel.innerHTML = `<div class="panel-error">
        <span>⚠ Diff panel failed to render (check console)</span>
        <button class="panel-error-retry" id="diff-retry">Retry</button>
      </div>`
      document.getElementById('diff-retry')?.addEventListener('click', () => loadDiff(sessionId))
    }
  } catch (_) {
    panel.innerHTML = '<div style="color:var(--text-muted);padding:10px;font-size:11px">No diff available for this session.</div>'
  }
}
