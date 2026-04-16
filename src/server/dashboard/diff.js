// diff.js — Diff rendering
import { escapeHtml } from './markdown.js'
import { fetchDiff } from './api.js'

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
  panel.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem;padding:12px">Loading diff…</div>'
  try {
    const data = await fetchDiff(sessionId)
    const diffText = typeof data === 'string'
      ? data
      : (data.diff ?? data.content ?? JSON.stringify(data, null, 2))
    panel.innerHTML = renderDiff(diffText)
  } catch (_) {
    panel.innerHTML = '<div style="color:var(--text-dim);padding:12px;font-size:.85rem">No diff available for this session.</div>'
  }
}
