// settings.js — Settings menu: sound, notifications, theme, tool calls
import { getState, setState } from './state.js'

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
  const { sound, notif, theme, tools, showReasoning } = getState().settings
  document.getElementById('s-sound').checked = sound
  document.getElementById('s-notif').checked = notif
  document.getElementById('s-theme').checked = theme
  document.getElementById('s-tools').checked = tools
  const reasoningEl = document.getElementById('s-reasoning')
  if (reasoningEl) reasoningEl.checked = showReasoning ?? false
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
}
