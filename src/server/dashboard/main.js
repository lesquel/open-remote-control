// main.js — Entry point: resolves auth, bootstraps all modules
import { initWelcome } from './welcome.js'
import { resolveToken, showTokenExpiredScreen, clearStoredToken } from './auth.js'
import { setState, getActiveDirectory, subscribe, getProjectTabs } from './state.js'
import { initMarkdown } from './markdown.js'
import { loadSettings } from './settings.js'
import { loadMVState, initMultiView, showMultiview } from './multi-view.js'
import { loadSessions, initSessions } from './sessions.js'
import { toast } from './toast.js'
import { loadPermissions, initPermissions } from './permissions.js'
import { initSettings } from './settings.js'
import { initShortcuts } from './shortcuts.js'
import { connect as sseConnect } from './sse.js'
import { initCommandPalette, openPalette, openProjectPicker, openCustomFolderModal } from './command-palette.js'
import {
  getConnection,
  saveConnection,
  parseConnectHash,
  showConnectScreen,
} from './connect.js'
import { createFilesChangedPanel } from './files-changed.js'
import { registerFilesChangedPanel } from './files-changed-bridge.js'
import { init as initReferences, refresh as refreshReferences } from './references.js'
import { createLabelStrip } from './label-strip.js'
import { createUsageIndicator } from './usage-indicator.js'
import { createAgentPanel } from './agent-panel.js'
import { createRightPanel } from './right-panel.js'
import { createTodoDock } from './todo-dock.js'
import { createPushNotifications } from './push-notifications.js'
import { createCommandHistory } from './command-history.js'
import { createFileBrowser } from './file-browser.js'
import { createCostPanel } from './cost-panel.js'
import { createPinnedTodos } from './pinned-todos.js'
import { initConnectModal, openConnectModal } from './connect-modal.js'
import { createProjectTabs, restoreTabsFromStorage, addProjectTab as ptAddProjectTab, switchProjectTab as ptSwitchProjectTab } from './project-tabs.js'
import { resolveDirFromHash, resolveTabAction } from './hash-dir-router.js'

// Expose references refresh globally so command-palette can call it
window.__refreshReferences = refreshReferences
// Expose palette open for data-action delegation and any other callers
window.__openPalette = () => openPalette()

// ── PWA: register service worker (HTTPS or localhost) ────────────────────
// Service Workers require a secure context, but localhost / 127.0.0.1 count as
// secure. Registering on localhost unlocks the Web Push flow for local dev.
if ('serviceWorker' in navigator) {
  const isLocalhost = ['127.0.0.1', 'localhost'].includes(location.hostname)
  if (location.protocol === 'https:' || isLocalhost) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
}

// ── Mode detection ───────────────────────────────────────────────────────
// "Embedded" = the dashboard is being served by the plugin itself, so all
// API calls can use same-origin fetch. "Standalone" = the dashboard was
// deployed to a CDN (e.g. GitHub Pages) and needs to be told the API URL.
function isEmbeddedMode() {
  const host = location.hostname

  // 1. URL carries ?token= → page was opened from a plugin-generated link
  // (QR or banner). The API is wherever the page came from.
  if (new URLSearchParams(location.search).get('token')) return true

  // 2. Localhost — classic embedded case.
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true

  // 3. RFC1918 private network IPs (LAN access via PILOT_HOST=0.0.0.0).
  //    192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12
  if (/^192\.168\./.test(host)) return true
  if (/^10\./.test(host)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true

  // 4. Tunnel hostnames (the plugin serves the dashboard over the tunnel).
  if (host.endsWith('.trycloudflare.com')) return true
  if (host.endsWith('.ngrok.io') || host.endsWith('.ngrok-free.app') || host.endsWith('.ngrok.app')) return true

  // 5. Otherwise assume standalone (CDN deploy, no plugin on this origin).
  return false
}

/**
 * Make a cheap authenticated GET /status to verify the token the dashboard
 * just resolved actually matches what the running pilot server expects.
 * Returns true on 200, false on 401 (or any other failure — better to show
 * the expired-token UI than to boot into a broken dashboard).
 */
async function validateTokenAgainstServer(serverUrl, token) {
  try {
    const res = await fetch(`${serverUrl}/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    return res.ok
  } catch {
    // Network error: let the normal dashboard UI handle it and display
    // reconnect banners. We only want to short-circuit on definitive 401.
    return true
  }
}

async function bootstrap() {
  // 1. Check for connect deep-link in URL hash (from QR code scan)
  const fromHash = parseConnectHash()
  if (fromHash) {
    saveConnection(fromHash.serverUrl, fromHash.token)
    history.replaceState(null, '', location.pathname + location.search)
  }

  // 2. Determine mode
  if (isEmbeddedMode()) {
    let token
    try {
      token = await resolveToken()
    } catch {
      return
    }
    if (!token) return
    setState({ serverUrl: '', token })

    // Early validation — catches the "localStorage has a stale token from
    // a previous OpenCode session" case before any UI renders. Without this
    // the dashboard boots normally, then every data fetch 401s and the user
    // sees broken panels. Introduced in 1.13.15 for issue #1 follow-up.
    const valid = await validateTokenAgainstServer('', token)
    if (!valid) {
      clearStoredToken()
      showTokenExpiredScreen()
      return
    }
  } else {
    const conn = getConnection()
    if (!conn) {
      showConnectScreen()
      return
    }
    setState({ serverUrl: conn.serverUrl, token: conn.token })

    const gate = document.getElementById('token-gate')
    if (gate) gate.style.display = 'none'
  }

  // 3. Show app shell
  const app = document.getElementById('app')
  app.style.display = 'flex'

  // 3.1 Getting-started welcome card (dismissible, first-visit only)
  initWelcome()

  // 3.2 Global data-action delegation — declarative button wiring for empty/error states.
  //     Handlers are exposed as window.__* by sessions.js and files-changed.js.
  document.addEventListener('click', (ev) => {
    const btn = ev.target?.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    switch (action) {
      case 'create-session':
        window.__createSession?.()
        break
      case 'open-palette':
        window.__openPalette?.()
        break
      case 'retry-sessions':
        window.__retrySessions?.()
        break
      case 'retry-files-changed':
        window.__retryFilesChanged?.()
        break
    }
  })

  // 3.5 Restore project tabs + active directory from localStorage (v1.11).
  //     This MUST happen before any API call so api.js appends the right
  //     ?directory= on initial /agents, /providers, /sessions fetches.
  const _restoredActiveTabId = restoreTabsFromStorage()

  // 3.6 Auto-focus project tab from #dir= hash fragment (v1.13.12).
  //     When the user runs /remote from a project directory, the TUI appends
  //     #dir=<encoded-cwd> to the URL.  We consume it here — AFTER tabs are
  //     restored from localStorage so we never duplicate a tab that is already
  //     open — and then erase the fragment so a page refresh is idempotent.
  //
  //     Must run synchronously (before loadSessions) so state.activeDirectory
  //     is correct for the very first API fetch.
  ;(function applyDirHash() {
    try {
      const parsed = resolveDirFromHash(location.hash)
      if (!parsed.ok) return

      const tabs = getProjectTabs()
      const action = resolveTabAction(parsed.dir, tabs)
      if (action.action === 'activate') {
        ptSwitchProjectTab(action.tabId)
      } else {
        ptAddProjectTab(action.dir, action.label)
      }

      // Clear the hash so a page refresh doesn't re-trigger with stale state.
      history.replaceState(null, '', location.pathname + location.search)
    } catch (_err) {
      // Never let hash parsing block the rest of the boot sequence.
    }
  })()

  // Mount the project tabs bar (between header and layout).
  const tabsBarEl = document.getElementById('project-tabs-bar')
  if (tabsBarEl) {
    createProjectTabs({ container: tabsBarEl })
  }

  // 4. Init references FIRST (agents, models, MCP servers, project) — must
  //    complete before any module that uses getAgent/getModel/getMcpServers.
  await initReferences()

  // 5. Init all modules
  initMarkdown()
  loadSettings()
  loadMVState()

  initSessions()
  initPermissions()
  initSettings()
  initCommandPalette()
  initShortcuts()
  initMultiView()
  initConnectModal()
  // Expose for shortcuts.js and command-palette.js
  window.__openConnectModal = openConnectModal

  // Mount files-changed panel
  const filesContainer = document.getElementById('files-changed-panel')
  if (filesContainer) {
    const filesPanel = createFilesChangedPanel({ container: filesContainer })
    registerFilesChangedPanel(filesPanel)
    window.__refreshFilesChanged = (sessionId) => filesPanel.refresh(sessionId)?.catch(() => {})
  }

  // Mount label strip (prompt composer footer — agent · model · provider)
  const labelStripContainer = document.getElementById('input-label-strip')
  if (labelStripContainer) {
    const labelStrip = createLabelStrip({ container: labelStripContainer })
    // Expose refresh so SSE handler can call it on message.updated
    window.__refreshLabelStrip = labelStrip.refresh
  }

  // Agent quick-switch: clicking the agent label in the compose bar opens agent picker
  document.getElementById('lbl-agent-btn')?.addEventListener('click', () => {
    import('./command-palette.js').then(m => {
      // openAgentPicker is not exported — go via togglePalette + programmatic search
      // Use the exported palette with a pre-filled query workaround:
      // We expose a dedicated __openAgentPicker global from initCommandPalette
      window.__openAgentPicker?.()
    }).catch(() => {})
  })

  // Mount usage indicator in TUI header (right side)
  const headerEl = document.getElementById('tui-header')
  if (headerEl) {
    const usageEl = document.createElement('div')
    usageEl.id = 'usage-indicator-mount'
    usageEl.className = 'usage-indicator-wrap'
    headerEl.appendChild(usageEl)
    const usageIndicator = createUsageIndicator({ container: usageEl })
    window.__refreshUsageIndicator = usageIndicator.refresh
  }

  // Mount agent context panel (below files-changed in sessions sidebar)
  const sessionsPanel = document.getElementById('sessions-panel')
  if (sessionsPanel) {
    const agentPanelEl = document.createElement('div')
    agentPanelEl.id = 'agent-context-panel'
    agentPanelEl.className = 'agent-panel'
    sessionsPanel.appendChild(agentPanelEl)
    const agentPanel = createAgentPanel({ container: agentPanelEl })
    window.__agentPanel = agentPanel  // exposed for command-palette "Show Agent Context" action
  }

  // Mount file browser panel (below agent context panel, at bottom of sessions sidebar)
  if (sessionsPanel) {
    const fileBrowserEl = document.createElement('div')
    fileBrowserEl.id = 'file-browser-mount'
    sessionsPanel.appendChild(fileBrowserEl)
    const fileBrowser = createFileBrowser({ container: fileBrowserEl })
    window.__fileBrowser = fileBrowser
  }

  // Mount right info panel
  const rightPanelEl = document.getElementById('right-panel')
  if (rightPanelEl) {
    const rightPanel = createRightPanel({ container: rightPanelEl })
    window.__rightPanel = rightPanel
    // On mobile, default to hidden so the panel doesn't pile up next to
    // the main view. User can reveal it via the "i" button in the header.
    if (window.innerWidth <= 768) {
      rightPanelEl.classList.add('right-panel--hidden')
    }
    // Wire the header info button — toggles the right panel from any viewport.
    const infoBtn = document.getElementById('info-toggle-btn')
    if (infoBtn) {
      infoBtn.addEventListener('click', () => {
        rightPanelEl.classList.toggle('right-panel--hidden')
      })
    }
  }

  // Mount cost panel — lives inside right panel DOM (sessions-panel bottom section)
  const costPanelMount = document.getElementById('cost-panel-mount')
  if (costPanelMount) {
    const costPanel = createCostPanel({ container: costPanelMount })
    // Expose so SSE / messages refresh can call it
    window.__costPanel = costPanel
  }

  // Mount pinned todos — lives in sessions sidebar above sessions list
  const pinnedTodosMount = document.getElementById('pinned-todos-mount')
  if (pinnedTodosMount) {
    const pinnedTodos = createPinnedTodos({ container: pinnedTodosMount })
    window.__pinnedTodos = pinnedTodos
  }

  // Wire pin button handler — called from inline onclick in rendered TodoWrite items
  window.__pinTodoItem = function(btn) {
    if (!btn) return
    const text = btn.dataset.text
    if (!text) return
    // Import state lazily to get current activeSession/sessions
    import('./state.js').then(({ getState }) => {
      const { activeSession, sessions } = getState()
      const sessionTitle = sessions?.[activeSession]?.title ?? ''
      if (window.__pinnedTodos && activeSession) {
        window.__pinnedTodos.addItem({ text, sessionId: activeSession, sessionTitle })
      }
    }).catch(() => {})
  }

  // Mount todo dock (above messages list, inside messages-tab)
  const todoDockMount = document.getElementById('todo-dock-mount')
  if (todoDockMount) {
    createTodoDock({ container: todoDockMount })
  }

  // Init push notifications (wires settings checkbox + SSE listener)
  createPushNotifications()

  // Init command history for prompt input
  const promptInputEl = document.getElementById('prompt-input')
  if (promptInputEl) {
    const commandHistory = createCommandHistory({
      inputEl: promptInputEl,
      storageKey: 'pilot_prompt_history',
    })
    // Expose push so the send handler (messages.js / shortcuts.js) can call it
    window.__commandHistory = commandHistory
  }

  // Wire footer label strip from label-strip values (sync with existing label-strip)
  function syncFooterLabels() {
    const agentEl    = document.getElementById('lbl-agent')
    const modelEl    = document.getElementById('lbl-model')
    const providerEl = document.getElementById('lbl-provider')
    const fAgent     = document.getElementById('footer-lbl-agent')
    const fModel     = document.getElementById('footer-lbl-model')
    const fProvider  = document.getElementById('footer-lbl-provider')
    if (fAgent && agentEl) {
      fAgent.textContent  = agentEl.textContent
      fAgent.style.color  = agentEl.style.color || ''
    }
    if (fModel    && modelEl)    fModel.textContent    = modelEl.textContent
    if (fProvider && providerEl) fProvider.textContent = providerEl.textContent
  }
  // Patch the label-strip refresh to also sync footer
  const origRefresh = window.__refreshLabelStrip
  if (origRefresh) {
    window.__refreshLabelStrip = async (...args) => {
      await origRefresh(...args)
      syncFooterLabels()
    }
  }
  // Initial sync after a tick
  setTimeout(syncFooterLabels, 200)

  // ── Mobile drawer: backdrop + ESC + session-tap-to-close ────────────────
  // The sidebar uses `.open-overlay` class (toggled by shortcuts.js).
  // On mobile we show a backdrop and auto-close on backdrop tap, ESC, or
  // when a session item is tapped.
  function createMobileDrawer() {
    const backdrop = document.getElementById('mobile-backdrop')
    const panel    = document.getElementById('sessions-panel')
    if (!backdrop || !panel) return

    function isDrawerOpen() {
      return panel.classList.contains('open-overlay')
    }

    function closeDrawer() {
      panel.classList.remove('open-overlay')
      backdrop.classList.remove('visible')
    }

    function openDrawer() {
      panel.classList.add('open-overlay')
      backdrop.classList.add('visible')
    }

    // Intercept the sidebar-toggle button: on mobile, fully take over so the
    // shortcuts.js handler doesn't ALSO toggle .open-overlay (its toggle would
    // cancel ours, leaving the drawer half-open + backdrop visible).
    const sidebarBtn = document.getElementById('sidebar-toggle-btn')
    if (sidebarBtn) {
      sidebarBtn.addEventListener('click', (e) => {
        if (window.innerWidth > 768) return
        // Stop the shortcuts.js handler on the same button from running.
        e.stopImmediatePropagation()
        e.preventDefault()
        if (isDrawerOpen()) {
          closeDrawer()
        } else {
          openDrawer()
        }
      }, { capture: true })
    }

    // Backdrop tap closes drawer
    backdrop.addEventListener('click', closeDrawer)

    // Tapping a session while drawer is open closes it
    panel.addEventListener('click', (e) => {
      if (!isDrawerOpen()) return
      if (window.innerWidth > 768) return
      const item = e.target.closest('.session-item')
      if (item) {
        // Small delay so selectSession() gets the click first
        setTimeout(closeDrawer, 80)
      }
    })

    // ESC closes drawer (supplement to shortcuts.js which closes modals)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isDrawerOpen()) {
        closeDrawer()
      }
    })
  }

  createMobileDrawer()

  // ── Mobile kebab menu ────────────────────────────────────────────────────
  function createMobileKebab() {
    const kebabBtn  = document.getElementById('mobile-kebab-btn')
    const popover   = document.getElementById('mobile-kebab-popover')
    if (!kebabBtn || !popover) return

    function openKebab() {
      popover.classList.add('open')
      kebabBtn.setAttribute('aria-expanded', 'true')
    }

    function closeKebab() {
      popover.classList.remove('open')
      kebabBtn.setAttribute('aria-expanded', 'false')
    }

    function toggleKebab() {
      if (popover.classList.contains('open')) closeKebab()
      else openKebab()
    }

    kebabBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleKebab()
    })

    // Dismiss on outside tap
    document.addEventListener('click', (e) => {
      if (popover.classList.contains('open') && !popover.contains(e.target) && e.target !== kebabBtn) {
        closeKebab()
      }
    })

    // Wire kebab actions
    document.getElementById('mkp-palette')?.addEventListener('click', () => {
      closeKebab()
      import('./command-palette.js').then(m => m.openPalette()).catch(() => {})
    })

    document.getElementById('mkp-shortcuts')?.addEventListener('click', () => {
      closeKebab()
      document.getElementById('keymap-modal')?.classList.add('open')
    })

    document.getElementById('mkp-connect')?.addEventListener('click', () => {
      closeKebab()
      window.__openConnectModal?.()
    })

    document.getElementById('mkp-right-panel')?.addEventListener('click', () => {
      closeKebab()
      document.getElementById('right-panel')?.classList.toggle('right-panel--hidden')
    })

    document.getElementById('mkp-switch-project')?.addEventListener('click', () => {
      closeKebab()
      openProjectPicker().catch(() => {})
    })
  }

  createMobileKebab()

  // ── Project switcher: sidebar button + header badge ──────────────────────
  function openProjectPickerUI() {
    openProjectPicker().catch(() => {})
  }

  function _refreshProjectLabel() {
    const dir = getActiveDirectory()
    const label = dir ? (dir.split('/').filter(Boolean).pop() ?? 'project') : 'default'
    const sidebarLabel = document.getElementById('sessions-project-label')
    const headerLabel  = document.getElementById('header-project-label')
    if (sidebarLabel) sidebarLabel.textContent = label
    if (headerLabel)  headerLabel.textContent  = label
  }

  document.getElementById('sessions-project-btn')?.addEventListener('click', openProjectPickerUI)
  document.getElementById('header-project-badge')?.addEventListener('click', openProjectPickerUI)

  // Subscribe to state changes to keep project label current
  subscribe('project-label', _refreshProjectLabel)
  // Initial label
  _refreshProjectLabel()

  // Alt+I — toggle right panel
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault()
      const rp = document.getElementById('right-panel')
      if (rp) rp.classList.toggle('right-panel--hidden')
    }
  })

  // Footer help button — keymap modal
  const footerHelpBtn = document.getElementById('footer-help-btn')
  const keymapModal   = document.getElementById('keymap-modal')
  const keymapClose   = document.getElementById('keymap-close')
  footerHelpBtn?.addEventListener('click', () => keymapModal?.classList.add('open'))
  keymapClose?.addEventListener('click',   () => keymapModal?.classList.remove('open'))
  keymapModal?.addEventListener('click',   (e) => { if (e.target === keymapModal) keymapModal.classList.remove('open') })

  // Footer action buttons (alt+p handled by shortcuts.js; wire info toggle here too)
  document.getElementById('tui-footer')?.querySelectorAll('.footer-shortcut--btn[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action
      if (action === 'info') {
        document.getElementById('right-panel')?.classList.toggle('right-panel--hidden')
      }
    })
  })

  // 6. Load initial data.
  //    If a tab was restored from storage, its state.activeDirectory is already
  //    set; loadSessions() will fetch for that tab. If no tab was restored,
  //    we first create a "default" tab so that state.activeProjectId is set
  //    before loadSessions writes results into state — that way setState
  //    correctly mirrors into the tab's cache.
  const stateMod = await import('./state.js')
  if (!_restoredActiveTabId && !stateMod.getActiveProjectTab?.()) {
    // Fresh install / no legacy data: open a "default" tab synchronously
    // (stateAddTab + stateSwitchTab, not the async project-tabs wrapper)
    // so loadSessions below writes into it via the setState mirroring.
    const defaultTab = stateMod.addProjectTab(null, 'default')
    stateMod.switchProjectTab(defaultTab.id)
  }

  await loadSessions(true)

  // One-time mobile hint: let user know the (i) button reveals session details
  if (window.innerWidth <= 768 && !localStorage.getItem('pilot_mobile_panel_hint_shown')) {
    localStorage.setItem('pilot_mobile_panel_hint_shown', '1')
    setTimeout(() => toast('Tap the (i) button to see session details'), 1200)
  }

  // Mark the active tab as loaded and mirror the fetched data into its cache
  // so switching away and back doesn't refetch.
  const activeTab = stateMod.getActiveProjectTab?.() ?? null
  if (activeTab) {
    activeTab.loaded = true
    stateMod.syncStateToActiveTab?.()
  }

  await loadPermissions()

  // 7. Connect SSE
  sseConnect()

  // 8. If multiview was restored, show it
  const { multiviewActive } = (await import('./state.js')).getState()
  if (multiviewActive) showMultiview()
}

bootstrap()
