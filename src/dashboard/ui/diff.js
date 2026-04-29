// diff.js — Diff rendering
import { escapeHtml } from '../components/markdown.js'
import { fetchDiff } from '../api/api.js'
import { getState } from '../state/state.js'

/**
 * Produce a stable anchor key for a file path.
 * Must match the normalization used in files-changed.js parseDiff so that
 * click handlers can find the right section.
 * Encodes slashes and dots so the value is safe as a data-* attribute.
 */
export function fileAnchorKey(filePath) {
  return encodeURIComponent(filePath.replace(/\\/g, '/'))
}

/**
 * Convert raw unified diff text to an HTML block.
 * Each file section receives a wrapper div with data-file="<anchorKey>"
 * so that navigateToDiffFile() can scroll and highlight it.
 */
export function renderDiff(diffText) {
  if (!diffText || !diffText.trim()) {
    return '<div class="diff-empty-state" style="color:var(--text-dim);padding:16px;text-align:center;font-size:12px">No changes in this session.</div>'
  }

  // Split into per-file sections using "diff --git" or "--- " boundaries.
  // We accumulate lines into sections so we can wrap each file in its own div.
  const rawLines = diffText.split('\n')

  /** @type {{ path: string | null, lines: string[] }[]} */
  const sections = []
  let current = null

  for (const line of rawLines) {
    // Match unified diff "--- a/some/path" or "+++ b/some/path" to track file names.
    // We use "+++ " because "--- " can appear in content; "+++ " is the canonical
    // new-file marker in unified diffs.
    if (line.startsWith('+++ ')) {
      const raw = line.slice(4).replace(/^[ab]\//, '').trim()
      if (raw !== '/dev/null') {
        current = { path: raw, lines: [line] }
        sections.push(current)
        continue
      }
    }
    if (current) {
      current.lines.push(line)
    } else {
      // Lines before first +++ (preamble like "diff --git …", "index …", "--- …")
      if (!sections.length) {
        sections.push({ path: null, lines: [line] })
      } else {
        sections[0].lines.push(line)
      }
    }
  }

  if (!sections.length) {
    return '<div class="diff-empty-state" style="color:var(--text-dim);padding:16px;text-align:center;font-size:12px">No changes in this session.</div>'
  }

  const html = sections.map(section => {
    const lineHtml = section.lines.map(line => {
      let cls = 'diff-line'
      if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add'
      else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del'
      else if (line.startsWith('@@')) cls += ' diff-hunk'
      return `<div class="${cls}">${escapeHtml(line)}</div>`
    }).join('')

    if (!section.path) {
      return `<div class="diff-container">${lineHtml}</div>`
    }

    const key = fileAnchorKey(section.path)
    return `<div class="diff-file-section diff-container" data-file="${escapeHtml(key)}">
  <div class="diff-file-header" title="${escapeHtml(section.path)}">${escapeHtml(section.path)}</div>
  ${lineHtml}
</div>`
  }).join('')

  return html
}

/**
 * Load and render diff for a session into #diff-panel.
 */
export async function loadDiff(sessionId) {
  const panel = document.getElementById('diff-panel')
  if (!panel) return
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

/**
 * Activate the Diff tab, load its content if needed, then scroll to a specific
 * file section and briefly highlight it.
 *
 * @param {string} filePath - full path as stored in the diff (from parseDiff .fullPath)
 */
export async function navigateToDiffFile(filePath) {
  // 1. Activate the Diff tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  const diffTabBtn = document.querySelector('.tab[data-tab="diff-tab"]')
  const diffTabPanel = document.getElementById('diff-tab')
  if (diffTabBtn) diffTabBtn.classList.add('active')
  if (diffTabPanel) diffTabPanel.classList.add('active')

  // 2. Load diff if the panel is empty or showing a placeholder
  const panel = document.getElementById('diff-panel')
  if (!panel) return
  const hasRenderedDiff = panel.querySelector('.diff-container')
  if (!hasRenderedDiff) {
    const { activeSession } = getState()
    if (activeSession) await loadDiff(activeSession)
  }

  // 3. Find the file section by data-file attribute and scroll to it
  const key = fileAnchorKey(filePath)
  const section = panel.querySelector(`.diff-file-section[data-file="${CSS.escape(key)}"]`)
  if (!section) return

  section.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // 4. Highlight with a CSS animation for ~1.5s (class removed after animation completes)
  section.classList.add('diff-section--highlight')
  section.addEventListener('animationend', () => {
    section.classList.remove('diff-section--highlight')
  }, { once: true })
}
