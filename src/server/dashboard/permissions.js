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

function classifyRisk(perm) {
  const type = (perm.type ?? perm.permissionType ?? '').toLowerCase()
  const tool = (perm.tool ?? '').toLowerCase()
  // Shell / bash / exec
  if (type === 'shell' || type === 'bash' || tool.includes('bash') || tool.includes('shell') || tool.includes('exec')) {
    return { kind: 'shell', label: 'Shell command', icon: '⚠' }
  }
  // Network (fetch, http, mcp remote)
  if (type === 'network' || type === 'fetch' || type === 'http' || tool.includes('fetch') || tool.includes('http')) {
    return { kind: 'network', label: 'Network request', icon: '↗' }
  }
  // Write / edit / delete
  if (type === 'write' || type === 'edit' || type === 'delete' || tool.includes('write') || tool.includes('edit') || tool.includes('delete')) {
    return { kind: 'write', label: 'File write', icon: '✎' }
  }
  // Read / glob / list
  if (type === 'read' || type === 'glob' || type === 'list' || tool.includes('read') || tool.includes('glob')) {
    return { kind: 'read', label: 'File read', icon: '👁' }
  }
  // Unknown
  return { kind: 'unknown', label: perm.type ?? 'Permission request', icon: '?' }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c])
}

export function showNextPerm() {
  const banner = document.getElementById('perm-banner')
  if (!banner) return
  const { pendingPerms, settings } = getState()

  if (!pendingPerms.length) {
    banner.classList.remove('visible')
    return
  }

  const p = pendingPerms[0]
  const risk = classifyRisk(p)

  // Icon + data-risk for CSS styling
  const iconEl = banner.querySelector('.perm-banner-icon')
  if (iconEl) {
    iconEl.textContent = risk.icon
    iconEl.setAttribute('data-risk', risk.kind)
  }

  // Risk label
  const riskEl = document.getElementById('perm-risk')
  if (riskEl) riskEl.textContent = risk.label

  // Queue badge
  const queueEl = document.getElementById('perm-queue')
  if (queueEl) {
    if (pendingPerms.length > 1) {
      queueEl.textContent = `1 of ${pendingPerms.length} pending`
      queueEl.hidden = false
    } else {
      queueEl.hidden = true
    }
  }

  // Title
  const titleEl = document.getElementById('perm-title')
  if (titleEl) titleEl.textContent = p.title ?? p.description ?? '(no title)'

  // Detail — the actual command/pattern/path
  const detailEl = document.getElementById('perm-detail')
  if (detailEl) {
    const detail = p.pattern ?? p.command ?? p.metadata?.command ?? p.metadata?.path ?? ''
    if (detail) {
      detailEl.innerHTML = `<code>${escapeHtml(String(detail))}</code>`
    } else {
      detailEl.textContent = ''
    }
  }

  // Meta — project/session context
  const metaEl = document.getElementById('perm-meta')
  if (metaEl) {
    const parts = []
    if (p.sessionID) parts.push(`session: ${String(p.sessionID).slice(0, 10)}`)
    const proj = p.metadata?.project ?? p.metadata?.worktree ?? p.metadata?.directory
    if (proj) parts.push(`project: ${String(proj).split('/').filter(Boolean).pop()}`)
    metaEl.textContent = parts.join(' · ')
  }

  banner.classList.add('visible')

  if (settings.sound) playNotifySound()
  if (settings.notif && Notification.permission === 'granted') {
    new Notification(`${risk.label}: ${p.title ?? ''}`, {
      body: p.pattern ?? p.command ?? ''
    })
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
