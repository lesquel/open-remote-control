// permissions.js — Permission banner and approve/deny logic
import { getState, setState } from './state.js'
import { fetchPermissions, respondPermission } from './api.js'
import { playNotifySound } from './notif-sound.js'
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

  try {
    const p = pendingPerms[0]
    const descEl = document.getElementById('perm-desc')
    if (descEl) {
      descEl.textContent = p.title ?? p.description ?? p.command ?? p.tool ?? JSON.stringify(p)
      if (pendingPerms.length > 1) {
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = ` (1/${pendingPerms.length})`
        descEl.appendChild(badge)
      }
    }
    banner.classList.add('visible')

    if (settings.sound) playNotifySound()
    if (settings.notif && Notification.permission === 'granted') {
      new Notification('Permission requested', { body: p.description ?? p.tool ?? '' })
    }
  } catch (err) {
    console.error('[panel-error] perm-banner:', err)
    if (banner) {
      banner.classList.add('visible')
      const desc = document.getElementById('perm-desc')
      if (desc) desc.textContent = '⚠ Permission request failed to render (check console)'
    }
  }
}

async function respondPerm(action) {
  const { pendingPerms } = getState()
  if (!pendingPerms.length) return
  const p = pendingPerms[0]
  const remaining = pendingPerms.slice(1)
  setState({ pendingPerms: remaining })
  try {
    await respondPermission(p.id ?? p.permissionID, action)
  } catch (_) {}
  showNextPerm()
}

export function initPermissions() {
  document.getElementById('btn-allow').addEventListener('click', () => respondPerm('allow'))
  document.getElementById('btn-deny').addEventListener('click', () => respondPerm('deny'))
}

export function handlePermissionRequested(data) {
  if (!data) {
    loadPermissions()  // server push told us something changed; re-fetch list
    return
  }
  const id = data.id ?? data.permissionID
  if (!id) {
    loadPermissions()
    return
  }
  const { pendingPerms } = getState()
  // Don't double-add if an existing poll already placed it
  if (pendingPerms.some(p => (p.id ?? p.permissionID) === id)) return
  setState({ pendingPerms: [...pendingPerms, { ...data, id }] })
  showNextPerm()
}

export function handlePermissionResolved(data) {
  const id = data?.id ?? data?.permissionID ?? data
  const { pendingPerms } = getState()
  setState({ pendingPerms: pendingPerms.filter(p => (p.id ?? p.permissionID) !== id) })
  showNextPerm()
}
