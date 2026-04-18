// file-browser.js — File tree browser panel for the left sidebar
// Factory: createFileBrowser({ container }) — mounts a collapsible file tree
// below the sessions list.  Lazy-loads children on folder expand.
import { fetchFileList, fetchFileContent, fetchGlobFiles, readAbsFile } from './api.js'
import { getActiveDirectory } from './state.js'

const MAX_CHILDREN = 500

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Get file extension for syntax highlighting. */
function extOf(name) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Map extension to highlight.js language alias. */
function hljsLang(ext) {
  const MAP = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    html: 'html', htm: 'html', css: 'css',
    md: 'markdown', toml: 'toml',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    java: 'java', kt: 'kotlin', swift: 'swift',
  }
  return MAP[ext] || 'plaintext'
}

// ── File viewer modal ─────────────────────────────────────────────────────────

function openFileModal(filePath, content) {
  // Remove any existing modal
  document.getElementById('file-viewer-modal')?.remove()

  let highlighted = ''
  const ext = extOf(filePath.split('/').pop() || '')
  const lang = hljsLang(ext)
  try {
    highlighted = hljs.highlight(content, { language: lang }).value
  } catch (_) {
    try {
      highlighted = hljs.highlightAuto(content).value
    } catch (_2) {
      highlighted = esc(content)
    }
  }

  const modal = document.createElement('div')
  modal.id = 'file-viewer-modal'
  modal.className = 'file-viewer-modal'
  modal.innerHTML = `
    <div class="file-viewer-box">
      <div class="file-viewer-header">
        <span class="file-viewer-path" title="${esc(filePath)}">${esc(filePath)}</span>
        <button class="file-viewer-close" id="file-viewer-close" title="Close (Esc)">✕</button>
      </div>
      <pre class="hljs file-viewer-content"><code>${highlighted}</code></pre>
    </div>
  `

  document.body.appendChild(modal)

  const close = () => modal.remove()
  modal.addEventListener('click', e => { if (e.target === modal) close() })
  document.getElementById('file-viewer-close').addEventListener('click', close)

  const onKey = e => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) }
  }
  document.addEventListener('keydown', onKey)
  modal.addEventListener('remove', () => document.removeEventListener('keydown', onKey))
}

// ── Tree node rendering ───────────────────────────────────────────────────────

/**
 * Render a single file-tree item row.
 * @param {object} node - FileNode from the API
 * @param {number} depth - indentation level
 * @param {boolean} expanded - for directories, whether currently open
 * @param {boolean} showIgnored - whether ignored files are visible
 */
function renderNodeRow(node, depth, expanded = false, showIgnored = true) {
  const indent = depth * 14
  const isDir = node.type === 'directory'
  const ignored = node.ignored === true

  if (ignored && !showIgnored) return ''

  const icon = isDir ? (expanded ? '▾' : '▸') : ''
  const ignoredClass = ignored ? ' file-tree-item--ignored' : ''
  const dirClass = isDir ? ' file-tree-item--dir' : ''

  return `<div class="file-tree-item${ignoredClass}${dirClass}"
    style="padding-left:${indent}px"
    data-path="${esc(node.path)}"
    data-absolute="${esc(node.absolute)}"
    data-type="${esc(node.type)}"
    data-ignored="${ignored}"
    data-depth="${depth}"
    data-expanded="${expanded}"
    title="${esc(node.absolute)}">
    <span class="file-tree-icon">${icon}</span>
    <span class="file-tree-name">${esc(node.name)}</span>
  </div>`
}

// ── createFileBrowser factory ─────────────────────────────────────────────────

/**
 * Mount the file browser panel.
 * @param {{ container: HTMLElement }} opts
 */
export function createFileBrowser({ container }) {
  let showIgnored = false
  // Map of dirPath → children array (cache to avoid re-fetching)
  const childrenCache = new Map()
  // Set of expanded directory paths
  const expandedDirs = new Set()

  // ── Mount initial shell ──────────────────────────────────────────────────

  container.innerHTML = `
    <div class="file-browser-panel">
      <div class="file-browser-header" id="fb-header">
        <span class="file-browser-title">▾ Files</span>
        <label class="file-browser-ignored-toggle" title="Show/hide gitignored files">
          <input type="checkbox" id="fb-show-ignored"> ignored
        </label>
      </div>
      <div class="file-browser-glob" id="fb-glob-row">
        <input type="text" id="fb-glob-input" class="file-browser-glob-input" placeholder="glob: **/*.ts" aria-label="Glob search">
        <button type="button" id="fb-glob-clear" class="file-browser-glob-clear" title="Clear glob results" style="display:none">✕</button>
      </div>
      <div class="file-tree" id="fb-tree"></div>
    </div>
  `

  const treeEl = container.querySelector('#fb-tree')
  const header = container.querySelector('#fb-header')
  const ignoredToggle = container.querySelector('#fb-show-ignored')
  const globInput = container.querySelector('#fb-glob-input')
  const globClear = container.querySelector('#fb-glob-clear')
  let globMode = false

  let panelCollapsed = false

  // Toggle panel collapse on header click
  header.addEventListener('click', e => {
    if (e.target === ignoredToggle || e.target.closest('label')) return
    panelCollapsed = !panelCollapsed
    const titleEl = header.querySelector('.file-browser-title')
    if (titleEl) titleEl.textContent = (panelCollapsed ? '▸' : '▾') + ' Files'
    treeEl.style.display = panelCollapsed ? 'none' : ''
  })

  ignoredToggle.addEventListener('change', () => {
    showIgnored = ignoredToggle.checked
    // Re-render visible nodes with updated visibility
    refreshTree()
  })

  // ── Glob search wiring ──────────────────────────────────────────────────
  async function runGlob() {
    const pattern = (globInput.value || '').trim()
    if (!pattern) return
    globMode = true
    if (globClear) globClear.style.display = ''
    treeEl.innerHTML = '<div class="file-tree-loading">Searching…</div>'
    try {
      const res = await fetchGlobFiles(pattern, { limit: 500 })
      renderGlobResults(res.files || [])
    } catch (err) {
      if (err && err.code === 'GLOB_DISABLED') {
        treeEl.innerHTML =
          '<div class="file-tree-error">' +
          'Glob opener is disabled.<br>' +
          'Set <code>PILOT_ENABLE_GLOB_OPENER=true</code> and restart OpenCode.' +
          '</div>'
      } else {
        showError('Glob search failed')
      }
    }
  }

  function renderGlobResults(files) {
    if (files.length === 0) {
      treeEl.innerHTML = '<div class="file-tree-empty">No matches</div>'
      return
    }
    const html = files
      .map((f) => {
        const size = f.size ? ` · ${(f.size / 1024).toFixed(1)} KB` : ''
        return `<div class="file-tree-item file-tree-item--glob"
          data-absolute="${esc(f.absolute)}"
          data-type="file"
          title="${esc(f.absolute)}">
          <span class="file-tree-icon">📄</span>
          <span class="file-tree-name">${esc(f.path)}</span>
          <span class="file-tree-meta">${esc(size)}</span>
        </div>`
      })
      .join('')
    treeEl.innerHTML = html
    treeEl.querySelectorAll('.file-tree-item--glob').forEach((el) => {
      el.addEventListener('click', handleGlobResultClick)
    })
  }

  async function handleGlobResultClick(e) {
    const el = e.currentTarget
    const absolute = el.dataset.absolute
    if (!absolute) return
    try {
      el.style.opacity = '0.5'
      const result = await readAbsFile(absolute)
      el.style.opacity = ''
      openFileModal(absolute, result.content ?? '')
    } catch (err) {
      el.style.opacity = ''
      if (err && err.code === 'GLOB_DISABLED') {
        treeEl.innerHTML =
          '<div class="file-tree-error">Glob opener disabled on server.</div>'
      }
    }
  }

  function exitGlobMode() {
    globMode = false
    if (globInput) globInput.value = ''
    if (globClear) globClear.style.display = 'none'
    renderTree()
  }

  globInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      runGlob()
    } else if (e.key === 'Escape') {
      exitGlobMode()
    }
  })
  globClear?.addEventListener('click', exitGlobMode)

  // ── Loading / error helpers ──────────────────────────────────────────────

  function setTreeContent(html) {
    treeEl.innerHTML = html
    wireClicks()
  }

  function showLoading() {
    treeEl.innerHTML = '<div class="file-tree-loading">Loading…</div>'
  }

  function showError(msg) {
    treeEl.innerHTML = `<div class="file-tree-error">⚠ ${esc(msg)}</div>`
  }

  // ── Refresh: load root ───────────────────────────────────────────────────

  async function refreshTree() {
    // If we already have root loaded, just re-render
    if (childrenCache.has('.')) {
      renderTree()
      return
    }
    showLoading()
    try {
      const nodes = await fetchFileList('.')
      childrenCache.set('.', nodes)
      renderTree()
    } catch (err) {
      showError('Failed to load files')
    }
  }

  // ── Render the full visible tree from cache ──────────────────────────────

  function renderTree() {
    const rootNodes = childrenCache.get('.') ?? []
    const html = renderNodes(rootNodes, 0)
    setTreeContent(html || '<div class="file-tree-empty">No files</div>')
  }

  function renderNodes(nodes, depth) {
    let html = ''
    let shown = 0
    const total = nodes.length

    for (const node of nodes) {
      if (node.ignored && !showIgnored) continue
      if (shown >= MAX_CHILDREN) {
        const remaining = total - shown
        html += `<div class="file-tree-item file-tree-truncated" style="padding-left:${depth * 14}px">… (${remaining} more, click to load)</div>`
        break
      }
      const isDir = node.type === 'directory'
      const expanded = expandedDirs.has(node.path)
      html += renderNodeRow(node, depth, expanded, showIgnored)

      // Render children if expanded and cached
      if (isDir && expanded && childrenCache.has(node.path)) {
        const children = childrenCache.get(node.path)
        html += renderNodes(children, depth + 1)
      } else if (isDir && expanded && !childrenCache.has(node.path)) {
        // Placeholder — children are loading
        html += `<div class="file-tree-item file-tree-loading" style="padding-left:${(depth + 1) * 14}px">Loading…</div>`
      }
      shown++
    }
    return html
  }

  // ── Wire click handlers ──────────────────────────────────────────────────

  function wireClicks() {
    treeEl.querySelectorAll('.file-tree-item').forEach(el => {
      el.addEventListener('click', handleItemClick)
    })
  }

  async function handleItemClick(e) {
    const el = e.currentTarget
    const type = el.dataset.type
    const path = el.dataset.path
    const absolute = el.dataset.absolute

    if (type === 'directory') {
      const wasExpanded = expandedDirs.has(path)
      if (wasExpanded) {
        expandedDirs.delete(path)
      } else {
        expandedDirs.add(path)
        // Lazy-load children if not cached
        if (!childrenCache.has(path)) {
          renderTree() // show loading placeholder
          try {
            const children = await fetchFileList(path)
            childrenCache.set(path, children)
          } catch (_) {
            childrenCache.set(path, []) // empty on error
          }
        }
      }
      renderTree()
    } else {
      // File click — fetch and show in modal
      try {
        el.style.opacity = '0.5'
        const result = await fetchFileContent(absolute)
        el.style.opacity = ''
        if (result && result.type === 'text') {
          openFileModal(absolute, result.content ?? '')
        } else if (result && result.type === 'binary') {
          openFileModal(absolute, `[binary file — ${result.mimeType ?? 'unknown type'}]`)
        }
      } catch (_) {
        el.style.opacity = ''
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Force-refresh the tree (clears cache). */
  function refresh() {
    childrenCache.clear()
    expandedDirs.clear()
    refreshTree()
  }

  // Initial load
  refreshTree()

  return { refresh }
}
