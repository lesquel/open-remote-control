// permissions.js — Permission banner and approve/deny logic
import { getState, setState } from './state.js'
import { fetchPermissions, respondPermission } from './api.js'
import { playBeep } from './settings.js'
import { toast } from './toast.js'

export async function loadPermissions() {
  try {
    const perms = await fetchPermissions()
    setState({ pendingPerms: Array.isArray(perms) ? perms : [] })
    showNextPerm()
  } catch (_) {}
}

export function showNextPerm() {
  const banner = document.getElementById('perm-banner')
  const { pendingPerms, settings } = getState()

  if (!pendingPerms.length) {
    banner.classList.remove('visible')
    return
  }

  const p = pendingPerms[0]
  document.getElementById('perm-desc').textContent =
    p.description ?? p.command ?? p.tool ?? JSON.stringify(p)
  banner.classList.add('visible')

  if (settings.sound) playBeep()
  if (settings.notif && Notification.permission === 'granted') {
    new Notification('Permission requested', { body: p.description ?? p.tool ?? '' })
  }
}

async function respondPerm(action) {
  const { pendingPerms } = getState()
  if (!pendingPerms.length) return
  const p = pendingPerms[0]
  const remaining = pendingPerms.slice(1)
  setState({ pendingPerms: remaining })
  try {
    await respondPermission(p.id, action)
  } catch (_) {}
  showNextPerm()
}

export function initPermissions() {
  document.getElementById('btn-allow').addEventListener('click', () => respondPerm('allow'))
  document.getElementById('btn-deny').addEventListener('click', () => respondPerm('deny'))
}

export function handlePermissionRequested(data) {
  const { pendingPerms } = getState()
  if (data?.id) {
    setState({ pendingPerms: [...pendingPerms, data] })
    showNextPerm()
  } else {
    loadPermissions()
  }
}

export function handlePermissionResolved(data) {
  const { pendingPerms } = getState()
  setState({ pendingPerms: pendingPerms.filter(p => p.id !== (data.id ?? data)) })
  showNextPerm()
}
