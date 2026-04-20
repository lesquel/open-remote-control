// project-tabs.js — Multi-project tabs bar (v1.11)
// Renders the tab strip at the top of the layout and wires add / close /
// switch actions. All state lives in state.js; this module is a pure view.
import {
  getState,
  addProjectTab as stateAddTab,
  removeProjectTab as stateRemoveTab,
  switchProjectTab as stateSwitchTab,
  getActiveProjectTab,
  findProjectTabByDirectory,
  syncActiveTabToState,
  syncStateToActiveTab,
  subscribe,
} from './state.js'
import { STORAGE_KEYS } from './constants.js'
import { toast } from './toast.js'

const LS_TABS       = STORAGE_KEYS.PROJECT_TABS
const LS_ACTIVE_TAB = STORAGE_KEYS.ACTIVE_PROJECT_ID
const LS_ACTIVE_DIR = STORAGE_KEYS.ACTIVE_DIRECTORY

const MAX_LABEL_CHARS_SMALL = 20

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncateLabel(label, max = MAX_LABEL_CHARS_SMALL) {
  if (!label) return ''
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

// ── Persistence ───────────────────────────────────────────────────────────

/**
 * Save the current tab strip (ids + directory + label only — NOT the cached
 * sessions/statuses, which are re-fetched on load). activeProjectId is saved
 * separately so we can restore the selection.
 */
function persistTabs() {
  const { projectTabs, activeProjectId } = getState()
  try {
    const lite = projectTabs.map(t => ({ id: t.id, directory: t.directory, label: t.label }))
    localStorage.setItem(LS_TABS, JSON.stringify(lite))
    if (activeProjectId) localStorage.setItem(LS_ACTIVE_TAB, activeProjectId)
    else                 localStorage.removeItem(LS_ACTIVE_TAB)
    // Keep legacy pilot_active_directory in sync so api.js and other readers
    // that fall back to the plain key keep working.
    const activeTab = projectTabs.find(t => t.id === activeProjectId) ?? null
    if (activeTab?.directory) localStorage.setItem(LS_ACTIVE_DIR, activeTab.directory)
    else                      localStorage.removeItem(LS_ACTIVE_DIR)
  } catch (_) {}
}

/**
 * Restore tabs from localStorage. Returns the restored `activeProjectId` or
 * null if nothing was persisted. Does NOT load sessions — caller owns that.
 */
export function restoreTabsFromStorage() {
  let rawTabs = null
  let rawActive = null
  try {
    rawTabs   = localStorage.getItem(LS_TABS)
    rawActive = localStorage.getItem(LS_ACTIVE_TAB)
  } catch (_) {}

  if (!rawTabs) {
    // Fallback: if we have a legacy pilot_active_directory, open it as the
    // first tab. Keeps users who upgrade from v1.10 from seeing an empty bar.
    try {
      const legacyDir = localStorage.getItem(LS_ACTIVE_DIR)
      if (legacyDir) {
        const tab = stateAddTab(legacyDir, null)
        stateSwitchTab(tab.id)
        persistTabs()
        return tab.id
      }
    } catch (_) {}
    return null
  }

  let list = []
  try { list = JSON.parse(rawTabs) } catch (_) { list = [] }
  if (!Array.isArray(list) || list.length === 0) return null

  let restoredActive = null
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const tab = stateAddTab(entry.directory ?? null, entry.label ?? null)
    // Keep the persisted id if we have one so activeProjectId still matches.
    if (entry.id) {
      tab.id = entry.id
      if (rawActive && entry.id === rawActive) restoredActive = entry.id
    }
  }

  if (!restoredActive) {
    const tabs = getState().projectTabs
    restoredActive = tabs[0]?.id ?? null
  }
  if (restoredActive) stateSwitchTab(restoredActive)
  return restoredActive
}

// ── High-level tab operations ────────────────────────────────────────────

/**
 * Add a new tab for `directory` (use `null` for default instance) and switch
 * to it. Returns the tab. If a tab for this directory already exists, just
 * switches to it.
 */
export function addProjectTab(directory, label) {
  const existing = findProjectTabByDirectory(directory)
  if (existing) {
    switchProjectTab(existing.id)
    return existing
  }
  const tab = stateAddTab(directory, label)
  switchProjectTab(tab.id)
  return tab
}

/**
 * Switch to tab `id`. Updates state, persists, refreshes related panels, and
 * loads sessions for the tab lazily (only when not already cached).
 */
export async function switchProjectTab(id) {
  // Mirror current top-level data back into the outgoing tab's cache so we
  // don't lose anything that was written directly via setState.
  syncStateToActiveTab()

  const tab = stateSwitchTab(id)
  if (!tab) return null

  persistTabs()

  // Refresh panels that depend on activeDirectory.
  try { window.__refreshRightPanel?.() } catch (_) {}
  try { window.__refreshLabelStrip?.() } catch (_) {}

  // Re-fetch references for the new directory (agents, providers, MCP, …).
  // This is cheap-ish (one-shot load per session) and necessary so the label
  // strip / right panel reflect the new project's config.
  try { await window.__refreshReferences?.() } catch (_) {}

  // Lazy session load: only fetch if this tab hasn't been populated yet.
  if (!tab.loaded) {
    await ensureSessionsLoaded(tab)
  }

  renderTabs()
  return tab
}

/**
 * Close a tab by id. If it was the active tab, switch to the first remaining
 * tab. If there are no tabs left, clears the active tab.
 */
export async function removeProjectTab(id) {
  const { projectTabs, activeProjectId } = getState()
  const wasActive = activeProjectId === id
  const tab = stateRemoveTab(id)
  if (!tab) return
  if (wasActive) {
    const remaining = getState().projectTabs
    if (remaining.length) {
      await switchProjectTab(remaining[0].id)
    } else {
      stateSwitchTab(null)
      persistTabs()
      clearEmptyView()
    }
  }
  persistTabs()
  renderTabs()
}

/**
 * Fetch sessions for the given tab and store them in its cache. If the new
 * project has no sessions, auto-create one so the user isn't stuck with a
 * disabled composer (fix for v1.11 bug #2).
 */
async function ensureSessionsLoaded(tab) {
  // Dynamic imports to avoid circular deps (sessions.js imports state.js).
  const { loadSessions, createSession } = await import('./sessions.js')
  try {
    await loadSessions(true) // autoselect most recent
  } catch (_) {}
  const { sessions } = getState()
  if (!sessions || Object.keys(sessions).length === 0) {
    try { await createSession() } catch (_) {}
  }
  tab.loaded = true
  // Mirror whatever loadSessions wrote into the top-level slots back into
  // the tab cache so subsequent switches don't refetch.
  syncStateToActiveTab()
}

/**
 * Clear the single-session pane when no tabs remain.
 */
function clearEmptyView() {
  const label = document.getElementById('header-session-label')
  const badge = document.getElementById('header-status-badge')
  if (label) label.textContent = 'No project'
  if (badge) badge.style.display = 'none'
  const bar = document.getElementById('session-info-bar')
  if (bar) bar.classList.add('hidden')
  const tabs = document.getElementById('session-tabs')
  if (tabs) tabs.style.display = 'none'
  const box = document.getElementById('messages')
  if (box) box.innerHTML = '<div id="no-session-state"><h3>No project open</h3><p>Click + to open a project.</p></div>'
  const list = document.getElementById('sessions-list')
  if (list) list.innerHTML = ''
  const input = document.getElementById('prompt-input')
  if (input) {
    input.disabled = true
    input.value = ''
    input.placeholder = 'Open a project to start…'
  }
}

// ── Rendering ────────────────────────────────────────────────────────────

let _containerEl = null

function renderTabs() {
  if (!_containerEl) return
  const { projectTabs, activeProjectId } = getState()

  const tabsHtml = projectTabs.map(tab => {
    const active  = tab.id === activeProjectId
    const label   = truncateLabel(tab.label || 'project')
    const title   = tab.directory || 'default instance'
    const loading = tab.loaded ? '' : ' project-tab--loading'
    return `<button class="project-tab${active ? ' project-tab--active' : ''}${loading}"
              data-tab-id="${esc(tab.id)}" title="${esc(title)}">
        <span class="project-tab-label">${esc(label)}</span>
        <span class="project-tab-close" data-close-id="${esc(tab.id)}" title="Close tab" aria-label="Close tab">×</span>
      </button>`
  }).join('')

  const addBtn = `<button class="project-tab-add" id="project-tab-add-btn" title="Open project" aria-label="Open project">+</button>`

  const empty = projectTabs.length === 0
    ? `<span class="project-tab-empty">No project open — click + to start</span>`
    : ''

  _containerEl.innerHTML = tabsHtml + addBtn + empty

  // Wire clicks
  _containerEl.querySelectorAll('.project-tab').forEach(el => {
    el.addEventListener('click', async (e) => {
      // If user clicked the close × inside the tab, don't also switch.
      const closeEl = e.target?.closest?.('.project-tab-close')
      if (closeEl) {
        e.stopPropagation()
        e.preventDefault()
        const id = closeEl.dataset.closeId
        if (id) await removeProjectTab(id)
        return
      }
      const id = el.dataset.tabId
      if (id && id !== getState().activeProjectId) {
        await switchProjectTab(id)
      }
    })
  })

  const addEl = _containerEl.querySelector('#project-tab-add-btn')
  if (addEl) {
    addEl.addEventListener('click', async () => {
      try {
        const mod = await import('./command-palette.js')
        if (typeof mod.openProjectPicker === 'function') mod.openProjectPicker()
      } catch (_) {
        toast('Could not open project picker')
      }
    })
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Create the project tabs view and mount it into `container`.
 * Returns `{ refresh, addTab, removeTab, switchTab }` for programmatic control.
 */
export function createProjectTabs({ container }) {
  if (!container) throw new Error('createProjectTabs: container required')
  _containerEl = container
  _containerEl.classList.add('project-tabs-bar')

  // Re-render whenever projectTabs / activeProjectId changes. We simply subscribe
  // to the generic state bus and diff-check the rendered HTML by deferring.
  let _raf = null
  subscribe('project-tabs', () => {
    if (_raf) return
    _raf = setTimeout(() => { _raf = null; renderTabs() }, 16)
  })

  renderTabs()

  return {
    refresh: renderTabs,
    addTab:  addProjectTab,
    removeTab: removeProjectTab,
    switchTab: switchProjectTab,
  }
}

// Re-export syncActiveTabToState for callers that need to force a mirror
// (e.g. after programmatic state.sessions mutations).
export { syncActiveTabToState, getActiveProjectTab }
