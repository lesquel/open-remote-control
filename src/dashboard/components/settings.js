// settings.js — Settings menu: sound, notifications, theme, tool calls,
// and (v1.12) the Plugin configuration section backed by /settings endpoints.
import { getState, setState } from '../state/state.js'
import {
  fetchPluginSettings,
  patchPluginSettings,
  resetPluginSettings,
  generateVapidKeys,
} from '../api/api.js'
import { toast } from '../ui/toast.js'
import { openModal } from '../modals/modal-helper.js'

const STORAGE_KEY = 'pilot_settings'

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const settings = { ...getState().settings, ...saved }
    setState({ settings })
  } catch (_) {}
  applySettings()
}

export function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getState().settings))
}

export function applySettings() {
  const { sound, notif, theme, tools, showReasoning, dailyBudget } = getState().settings
  document.getElementById('s-sound').checked = sound
  document.getElementById('s-notif').checked = notif
  document.getElementById('s-theme').checked = theme
  document.getElementById('s-tools').checked = tools
  const reasoningEl = document.getElementById('s-reasoning')
  if (reasoningEl) reasoningEl.checked = showReasoning ?? false
  const budgetEl = document.getElementById('s-daily-budget')
  if (budgetEl) budgetEl.value = dailyBudget != null && dailyBudget > 0 ? String(dailyBudget) : ''
  document.body.classList.toggle('theme-light', theme)
  document.querySelectorAll('.tool-block').forEach(el => {
    el.classList.toggle('hidden-tools', !tools)
  })
}

export function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .3)
    osc.start()
    osc.stop(ctx.currentTime + .3)
  } catch (_) {}
}

function initSettingsTabs() {
  const tabs = document.querySelectorAll('.settings-tab')
  const panes = document.querySelectorAll('.settings-pane')
  if (!tabs.length) return

  function selectTab(tabId) {
    tabs.forEach(t => {
      const active = t.dataset.tab === tabId
      t.setAttribute('aria-selected', active ? 'true' : 'false')
      t.classList.toggle('is-active', active)
    })
    panes.forEach(p => {
      const match = p.dataset.pane === tabId
      p.hidden = !match
    })
    try { localStorage.setItem('pilot:settings:last-tab', tabId) } catch (_) {}
  }

  tabs.forEach(t => {
    t.addEventListener('click', () => selectTab(t.dataset.tab))
    // Arrow key navigation for accessibility
    t.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
      ev.preventDefault()
      const ordered = Array.from(tabs)
      const idx = ordered.indexOf(t)
      const next = ev.key === 'ArrowLeft'
        ? (idx - 1 + ordered.length) % ordered.length
        : (idx + 1) % ordered.length
      ordered[next].focus()
      selectTab(ordered[next].dataset.tab)
    })
  })

  // Restore last-used tab or default to prefs
  let last = 'prefs'
  try { last = localStorage.getItem('pilot:settings:last-tab') ?? 'prefs' } catch (_) {}
  selectTab(last)
}

let _settingsHandle = null

function openSettingsModal() {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  modal.hidden = false
  initSettingsTabs()
  // Refresh the plugin config each time the modal opens so source badges
  // and values reflect whatever was last saved (or shell-env changes).
  loadPluginConfig().catch(() => {})
  _settingsHandle = openModal({
    node: modal,
    onClose: () => {
      modal.hidden = true
      _settingsHandle = null
    },
    labelledBy: 'settings-modal-title',
  })
}

function closeSettingsModal() {
  _settingsHandle?.close()
}

export function initSettings() {
  // Every `addEventListener` below is wrapped in optional chaining (`?.`).
  // Same class of regression that bit `initSessions` in v1.16.0 → v1.16.7:
  // a single missing element throws TypeError and aborts the rest of init,
  // so the gear-icon listener never gets attached and the modal refuses to
  // open. This blinds it against any future markup change.
  document.getElementById('settings-btn')?.addEventListener('click', openSettingsModal)

  document.getElementById('settings-close')?.addEventListener('click', closeSettingsModal)

  document.getElementById('s-sound')?.addEventListener('change', e => {
    const settings = { ...getState().settings, sound: e.target.checked }
    setState({ settings })
    saveSettings()
  })

  document.getElementById('s-notif')?.addEventListener('change', async e => {
    let settings = { ...getState().settings, notif: e.target.checked }
    setState({ settings })
    saveSettings()
    if (settings.notif && Notification.permission !== 'granted') {
      if (Notification.permission === 'denied') {
        settings = { ...getState().settings, notif: false }
        e.target.checked = false
        setState({ settings })
        saveSettings()
        toast('Notifications are blocked in your browser. Enable them in site settings and reload.')
        return
      }
      const p = await Notification.requestPermission()
      if (p !== 'granted') {
        settings = { ...getState().settings, notif: false }
        e.target.checked = false
        setState({ settings })
        saveSettings()
      }
    }
  })

  document.getElementById('s-theme')?.addEventListener('change', e => {
    const settings = { ...getState().settings, theme: e.target.checked }
    setState({ settings })
    saveSettings()
    applySettings()
  })

  document.getElementById('s-tools')?.addEventListener('change', e => {
    const settings = { ...getState().settings, tools: e.target.checked }
    setState({ settings })
    saveSettings()
    document.querySelectorAll('.tool-block').forEach(el => {
      el.classList.toggle('hidden-tools', !settings.tools)
    })
  })

  // Feature C: show reasoning by default toggle
  const reasoningEl = document.getElementById('s-reasoning')
  if (reasoningEl) {
    reasoningEl.addEventListener('change', e => {
      const settings = { ...getState().settings, showReasoning: e.target.checked }
      setState({ settings })
      saveSettings()
    })
  }

  // Cost tracking: daily budget limit
  const budgetEl = document.getElementById('s-daily-budget')
  if (budgetEl) {
    budgetEl.addEventListener('change', e => {
      const val = parseFloat(e.target.value)
      const dailyBudget = (!isNaN(val) && val > 0) ? val : 0
      const settings = { ...getState().settings, dailyBudget }
      setState({ settings })
      saveSettings()
    })
  }

  initPluginConfig()
}

// ── Plugin configuration (v1.12) ─────────────────────────────────────────
// Maps between the UI inputs and the /settings payload. Everything is
// loaded on demand when the modal opens (see click handler above).

/**
 * Map of settings field → { input element id, type }.
 * The order here also drives iteration for source-badge updates.
 */
const FIELD_MAP = {
  port:                { id: 'pcf-port',            kind: 'int' },
  host:                { id: 'pcf-host',            kind: 'string' },
  tunnel:              { id: 'pcf-tunnel',          kind: 'string' },
  telegramToken:       { id: 'pcf-telegram-token',  kind: 'string' },
  telegramChatId:      { id: 'pcf-telegram-chat',   kind: 'string' },
  vapidPublicKey:      { id: 'pcf-vapid-public',    kind: 'string' },
  vapidPrivateKey:     { id: 'pcf-vapid-private',   kind: 'string' },
  vapidSubject:        { id: 'pcf-vapid-subject',   kind: 'string' },
  permissionTimeoutMs: { id: 'pcf-perm-timeout',    kind: 'int' },
  enableGlobOpener:    { id: 'pcf-glob',            kind: 'bool' },
  fetchTimeoutMs:      { id: 'pcf-fetch-timeout',   kind: 'int' },
}

let _lastLoadedSnapshot = null // { settings, sources, restartRequired, configFilePath }

/**
 * Attach a blur-time advisory validator to an input.
 * `validate(value)` returns a string error message or null if valid.
 * Shows/hides a <small> element injected immediately after the input (or its wrapper).
 */
function attachInlineValidation(inputId, validate) {
  const el = document.getElementById(inputId)
  if (!el) return
  const hint = document.createElement('small')
  hint.className = 'pcf-hint'
  hint.style.color = '#ff8585'
  hint.style.display = 'none'
  // Insert after the input's closest wrapping element (.pcf-secret-wrap) or the input itself.
  const anchor = el.closest('.pcf-secret-wrap') || el
  anchor.insertAdjacentElement('afterend', hint)
  el.addEventListener('blur', () => {
    const msg = validate(el.value.trim())
    if (msg) {
      hint.textContent = msg
      hint.style.display = 'block'
    } else {
      hint.style.display = 'none'
    }
  })
}

/**
 * Inject a one-line field hint adjacent to a given input element.
 * Hint is placed immediately after the input (or its .pcf-secret-wrap).
 */
function addFieldHint(inputId, text) {
  const el = document.getElementById(inputId)
  if (!el) return
  const hint = document.createElement('small')
  hint.className = 'pcf-hint'
  hint.style.display = 'block'
  hint.style.marginTop = '2px'
  hint.textContent = text
  const anchor = el.closest('.pcf-secret-wrap') || el
  anchor.insertAdjacentElement('afterend', hint)
}

function initPluginConfig() {
  const section = document.getElementById('plugin-config-section')
  if (!section) return

  // Field hints (advisory, one line each)
  addFieldHint('pcf-port', 'HTTP port for the dashboard. Default 4097.')
  addFieldHint('pcf-host', 'Bind address. Use 0.0.0.0 to accept LAN/phone access — localhost only by default.')
  addFieldHint('pcf-tunnel', 'Expose the dashboard via a public URL. Needs cloudflared or ngrok installed.')
  addFieldHint('pcf-telegram-token', 'Optional. Get one from @BotFather on Telegram.')
  addFieldHint('pcf-telegram-chat', 'Your numeric chat ID. Message @userinfobot to find yours.')
  addFieldHint('pcf-vapid-public', 'Web Push credentials. Use the Generate button if unsure.')
  addFieldHint('pcf-vapid-private', 'Web Push credentials. Use the Generate button if unsure.')
  addFieldHint('pcf-glob', 'Allows the dashboard’s file browser to list and read project files. Off by default for security.')

  // Password-eye toggles (scoped to the whole modal — fields span multiple panes)
  const modal = document.getElementById('settings-modal')
  const eyeScope = modal ?? section
  eyeScope.querySelectorAll('.pcf-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-toggle-for'))
      if (!target) return
      target.type = target.type === 'password' ? 'text' : 'password'
    })
  })

  document.getElementById('settings-save')?.addEventListener('click', onSave)
  document.getElementById('pcf-reset')?.addEventListener('click', onReset)
  document.getElementById('pcf-vapid-generate')?.addEventListener('click', onGenerateVapid)

  // Inline validation hints (advisory only — do not block save)
  attachInlineValidation('pcf-telegram-token', v => {
    if (!v) return null
    return /^\d+:[A-Za-z0-9_-]+$/.test(v)
      ? null
      : "That doesn’t look like a Telegram bot token (expected format: 123456789:ABC...)."
  })
  attachInlineValidation('pcf-telegram-chat', v => {
    if (!v) return null
    return /^-?\d+$/.test(v)
      ? null
      : 'Chat ID should be a number (may start with - for groups).'
  })
  attachInlineValidation('pcf-vapid-public', v => {
    if (!v) return null
    return /^[A-Za-z0-9_-]{40,}$/.test(v)
      ? null
      : 'Invalid VAPID key format.'
  })
  attachInlineValidation('pcf-vapid-private', v => {
    if (!v) return null
    return /^[A-Za-z0-9_-]{40,}$/.test(v)
      ? null
      : 'Invalid VAPID key format.'
  })
}

async function loadPluginConfig() {
  const statusEl = document.getElementById('plugin-config-status')
  if (statusEl) statusEl.style.display = 'none'
  try {
    const data = await fetchPluginSettings()
    _lastLoadedSnapshot = data
    applySnapshotToInputs(data)
    updateRestartNote(data)
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'plugin-config-status error'
      statusEl.textContent = 'Could not load plugin settings: ' + (err?.message || err)
      statusEl.style.display = 'block'
    }
  }
}

function applySnapshotToInputs(snap) {
  const { settings, sources, configFilePath } = snap

  const pathCode = document.getElementById('plugin-config-path-code')
  if (pathCode) pathCode.textContent = configFilePath

  for (const [field, spec] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(spec.id)
    if (!el) continue
    const value = settings[field]
    if (spec.kind === 'bool') {
      el.checked = !!value
    } else if (value === undefined || value === null) {
      el.value = ''
    } else {
      el.value = String(value)
    }

    const source = sources[field] || 'default'
    const row = el.closest('.pcf-row')
    if (row) row.classList.toggle('pcf-row--locked', source === 'shell-env')
    el.disabled = source === 'shell-env'

    const badge = document.querySelector(`.pcf-source[data-source-for="${field}"]`)
    if (badge) {
      badge.textContent = formatSource(source)
      badge.setAttribute('data-source', source)
      badge.title =
        source === 'shell-env'
          ? 'Set via shell environment — unset the env var to edit here'
          : source === 'settings-store'
            ? 'Saved in ' + configFilePath
            : source === 'env-file'
              ? 'Loaded from .env file'
              : 'Default value'
    }
  }
}

function formatSource(source) {
  switch (source) {
    case 'shell-env':      return 'shell'
    case 'settings-store': return 'saved'
    case 'env-file':       return '.env'
    case 'default':        return 'default'
    default:               return source
  }
}

function updateRestartNote(snap) {
  const note = document.getElementById('pcf-restart-note')
  if (!note) return
  const fields = snap?.restartRequired ?? []
  note.style.display = fields.length > 0 ? 'block' : 'none'
  note.textContent =
    'Changes to these fields require an OpenCode restart: ' + fields.join(', ')
}

function readInputsAsPatch() {
  const patch = {}
  for (const [field, spec] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(spec.id)
    if (!el || el.disabled) continue
    if (spec.kind === 'bool') {
      patch[field] = !!el.checked
    } else if (spec.kind === 'int') {
      const raw = el.value.trim()
      if (raw === '') continue
      const n = parseInt(raw, 10)
      if (!Number.isFinite(n)) continue
      patch[field] = n
    } else {
      // String: send even if empty so the user can clear a value.
      patch[field] = el.value
    }
  }
  return patch
}

async function onSave() {
  const statusEl = document.getElementById('settings-status')
  const pcfStatusEl = document.getElementById('plugin-config-status')
  if (pcfStatusEl) pcfStatusEl.style.display = 'none'
  if (statusEl) statusEl.textContent = ''
  const saveBtn = document.getElementById('settings-save')
  if (saveBtn) saveBtn.disabled = true

  // Snapshot BEFORE the patch so we can diff after save and surface only the
  // fields that actually changed AND require a plugin restart. Without this
  // we were showing the full list of restart-capable fields every time,
  // which is noisy and hides which ones the user actually touched.
  const previousSettings = _lastLoadedSnapshot?.settings ? { ..._lastLoadedSnapshot.settings } : {}

  try {
    const patch = readInputsAsPatch()
    const updated = await patchPluginSettings(patch)
    _lastLoadedSnapshot = updated
    applySnapshotToInputs(updated)
    updateRestartNote(updated)

    // Compute actual changes. Compare against the previous snapshot, not the
    // patch payload (the patch is the user's intent; the updated snapshot is
    // what the server accepted — they differ on shell-env-pinned fields).
    const restartCapable = new Set(updated.restartRequired ?? [])
    const actuallyChangedRestart = []
    for (const key of Object.keys(updated.settings ?? {})) {
      if (!restartCapable.has(key)) continue
      const prev = previousSettings[key]
      const next = updated.settings[key]
      // Normalise undefined/null to '' for comparison — UI clears a field by
      // omitting it, which the backend stores as absent. Both read the same.
      if ((prev ?? '') !== (next ?? '')) {
        actuallyChangedRestart.push(key)
      }
    }

    if (actuallyChangedRestart.length > 0) {
      // Prominent, can't-miss-it banner. Repeats the exact fields so the user
      // knows the restart is needed specifically for these.
      if (statusEl) {
        statusEl.innerHTML = `<span class="restart-required-banner">⚠ Saved. Reiniciá OpenCode para aplicar: <strong>${actuallyChangedRestart.join(', ')}</strong></span>`
      }
      try { toast(`Settings saved. Restart OpenCode to apply: ${actuallyChangedRestart.join(', ')}`, { duration: 8000 }) } catch (_) {}
    } else {
      if (statusEl) statusEl.textContent = 'Saved to ' + updated.configFilePath
      try { toast('Settings saved') } catch (_) {}
    }
  } catch (err) {
    if (err?.status === 409 && err?.code === 'SHELL_ENV_PINNED') {
      // Roll back inputs to the server's actual state, then explain what's locked.
      try {
        const current = await fetchPluginSettings()
        _lastLoadedSnapshot = current
        applySnapshotToInputs(current)
        updateRestartNote(current)
        // Extract field names from the error message (format: "Cannot override: field1, field2 (set via shell env)...")
        const match = err.message.match(/Cannot override:\s*([^(]+)/)
        const fieldList = match ? match[1].trim() : err.message
        statusEl.textContent =
          'Locked by shell env: ' + fieldList + '. Unset them to edit here.'
      } catch (_) {
        statusEl.textContent =
          'Some fields are locked by your shell environment.'
      }
    } else if (err?.status >= 500 || !err?.status) {
      statusEl.textContent = 'Could not save settings. Check the server log or try again.'
    } else {
      statusEl.textContent = 'Save failed: ' + (err?.message || err)
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false
  }
}

async function onReset() {
  const confirmed = window.confirm(
    'Reset plugin settings to defaults? This deletes ~/.opencode-pilot/config.json and takes effect on the next OpenCode restart.',
  )
  if (!confirmed) return
  const statusEl = document.getElementById('settings-status')
  statusEl.textContent = ''
  try {
    await resetPluginSettings()
    await loadPluginConfig()
    statusEl.textContent = 'Config file deleted. Restart OpenCode for changes to take effect.'
    try { toast('Settings reset') } catch (_) {}
  } catch (err) {
    statusEl.textContent = 'Reset failed: ' + (err?.message || err)
  }
}

async function onGenerateVapid() {
  const btn = document.getElementById('pcf-vapid-generate')
  btn.disabled = true
  try {
    const keys = await generateVapidKeys()
    const pub = document.getElementById('pcf-vapid-public')
    const priv = document.getElementById('pcf-vapid-private')
    const subj = document.getElementById('pcf-vapid-subject')
    if (pub) pub.value = keys.publicKey
    if (priv) priv.value = keys.privateKey
    if (subj && !subj.value) subj.value = keys.subject
    try { toast('VAPID keys generated — click Save to persist') } catch (_) {}
  } catch (err) {
    try { toast('VAPID generation failed: ' + (err?.message || err)) } catch (_) {}
  } finally {
    btn.disabled = false
  }
}
