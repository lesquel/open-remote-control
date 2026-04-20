// settings.js — Settings menu: sound, notifications, theme, tool calls,
// and (v1.12) the Plugin configuration section backed by /settings endpoints.
import { getState, setState } from './state.js'
import {
  fetchPluginSettings,
  patchPluginSettings,
  resetPluginSettings,
  generateVapidKeys,
} from './api.js'
import { toast } from './toast.js'

const STORAGE_KEY = 'pilot_settings'

export function loadSettings() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')
    const settings = { ...getState().settings, ...saved }
    setState({ settings })
  } catch (_) {}
  applySettings()
}

export function saveSettings() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(getState().settings))
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

export function initSettings() {
  const modal = document.getElementById('settings-modal')

  document.getElementById('settings-btn').addEventListener('click', () => {
    modal.classList.add('open')
    // Refresh the plugin config each time the modal opens so source badges
    // and values reflect whatever was last saved (or shell-env changes).
    loadPluginConfig().catch(() => {})
  })

  document.getElementById('settings-close').addEventListener('click', () => {
    modal.classList.remove('open')
  })

  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('open')
  })

  document.getElementById('s-sound').addEventListener('change', e => {
    const settings = { ...getState().settings, sound: e.target.checked }
    setState({ settings })
    saveSettings()
  })

  document.getElementById('s-notif').addEventListener('change', async e => {
    let settings = { ...getState().settings, notif: e.target.checked }
    setState({ settings })
    saveSettings()
    if (settings.notif && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission()
      if (p !== 'granted') {
        settings = { ...getState().settings, notif: false }
        e.target.checked = false
        setState({ settings })
        saveSettings()
      }
    }
  })

  document.getElementById('s-theme').addEventListener('change', e => {
    const settings = { ...getState().settings, theme: e.target.checked }
    setState({ settings })
    saveSettings()
    applySettings()
  })

  document.getElementById('s-tools').addEventListener('change', e => {
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

function initPluginConfig() {
  const section = document.getElementById('plugin-config-section')
  if (!section) return

  // Password-eye toggles
  section.querySelectorAll('.pcf-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-toggle-for'))
      if (!target) return
      target.type = target.type === 'password' ? 'text' : 'password'
    })
  })

  document.getElementById('pcf-save').addEventListener('click', onSave)
  document.getElementById('pcf-reset').addEventListener('click', onReset)
  document.getElementById('pcf-vapid-generate').addEventListener('click', onGenerateVapid)
}

async function loadPluginConfig() {
  const statusEl = document.getElementById('plugin-config-status')
  statusEl.style.display = 'none'
  try {
    const data = await fetchPluginSettings()
    _lastLoadedSnapshot = data
    applySnapshotToInputs(data)
    updateRestartNote(data)
  } catch (err) {
    statusEl.className = 'plugin-config-status error'
    statusEl.textContent = 'Could not load plugin settings: ' + (err?.message || err)
    statusEl.style.display = 'block'
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
  const statusEl = document.getElementById('plugin-config-status')
  statusEl.style.display = 'none'
  const saveBtn = document.getElementById('pcf-save')
  saveBtn.disabled = true

  try {
    const patch = readInputsAsPatch()
    const updated = await patchPluginSettings(patch)
    _lastLoadedSnapshot = updated
    applySnapshotToInputs(updated)
    updateRestartNote(updated)
    statusEl.className = 'plugin-config-status ok'
    statusEl.textContent = 'Saved to ' + updated.configFilePath
    statusEl.style.display = 'block'
    try { toast('Settings saved') } catch (_) {}
  } catch (err) {
    statusEl.className = 'plugin-config-status error'
    statusEl.textContent = 'Save failed: ' + (err?.message || err)
    statusEl.style.display = 'block'
  } finally {
    saveBtn.disabled = false
  }
}

async function onReset() {
  const confirmed = window.confirm(
    'Reset plugin settings to defaults? This deletes ~/.opencode-pilot/config.json and takes effect on the next OpenCode restart.',
  )
  if (!confirmed) return
  const statusEl = document.getElementById('plugin-config-status')
  statusEl.style.display = 'none'
  try {
    await resetPluginSettings()
    await loadPluginConfig()
    statusEl.className = 'plugin-config-status ok'
    statusEl.textContent = 'Config file deleted. Restart OpenCode for changes to take effect.'
    statusEl.style.display = 'block'
    try { toast('Settings reset') } catch (_) {}
  } catch (err) {
    statusEl.className = 'plugin-config-status error'
    statusEl.textContent = 'Reset failed: ' + (err?.message || err)
    statusEl.style.display = 'block'
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
