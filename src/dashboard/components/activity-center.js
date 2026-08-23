import { getActivityStore } from './activity-store.js'
import { openModal } from '../modals/modal-helper.js'

let modalHandle = null
const store = () => getActivityStore()

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function timeAgo(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function activityIcon(kind) {
  if (kind === 'permission') return '⚠'
  if (kind === 'error') return '×'
  if (kind === 'completed') return '✓'
  return '•'
}

function ensureModal() {
  let modal = document.getElementById('activity-center')
  if (modal) return modal
  modal = document.createElement('div')
  modal.id = 'activity-center'
  modal.className = 'modal-backdrop activity-center'
  modal.hidden = true
  modal.innerHTML = `<section class="modal-panel activity-panel" aria-labelledby="activity-title">
    <header class="modal-header">
      <div><h2 id="activity-title">Activity center</h2><p class="activity-subtitle">What needs your attention across agents and sessions.</p></div>
      <button class="modal-close" data-activity-close aria-label="Close activity center">×</button>
    </header>
    <div class="activity-toolbar"><button class="btn btn-ghost" data-activity-clear>Clear recent</button></div>
    <div class="activity-list" data-activity-list></div>
  </section>`
  document.body.appendChild(modal)
  modal.querySelector('[data-activity-close]')?.addEventListener('click', closeActivityCenter)
  modal.querySelector('[data-activity-clear]')?.addEventListener('click', () => store().clearRecent())
  modal.querySelector('[data-activity-list]')?.addEventListener('click', (event) => {
    const item = event.target?.closest?.('[data-activity-id]')
    if (!item) return
    const entry = store().list().find(candidate => candidate.id === item.dataset.activityId)
    if (!entry) return
    closeActivityCenter()
    if (entry.kind === 'permission') {
      document.getElementById('perm-banner')?.scrollIntoView?.({ behavior: 'smooth' })
    } else if (entry.sessionID) {
      import('./sessions.js')
        .then(module => module.selectSession(entry.sessionID))
        .catch(error => console.warn('[pilot] Could not open activity session', error))
    }
  })
  return modal
}

function renderGroup(title, items) {
  if (items.length === 0) return ''
  return `<section class="activity-group"><h3>${title}</h3>${items.map(entry =>
    `<button class="activity-item${entry.attention && !entry.resolved ? ' needs-attention' : ''}" data-activity-id="${escapeHtml(entry.id)}">
      <span class="activity-icon" aria-hidden="true">${activityIcon(entry.kind)}</span>
      <span class="activity-copy"><strong>${escapeHtml(entry.title)}</strong>${entry.detail ? `<span>${escapeHtml(entry.detail)}</span>` : ''}${entry.project ? `<small>${escapeHtml(entry.project)}</small>` : ''}</span>
      <time datetime="${new Date(entry.createdAt).toISOString()}">${timeAgo(entry.createdAt)}</time>
    </button>`).join('')}</section>`
}

function render() {
  const modal = ensureModal()
  const list = modal.querySelector('[data-activity-list]')
  const entries = store().list()
  const attention = entries.filter(entry => entry.attention && !entry.resolved)
  const recent = entries.filter(entry => !entry.attention || entry.resolved)
  list.innerHTML = entries.length === 0
    ? '<div class="activity-empty"><strong>Nothing needs attention</strong><span>Finished tasks, permissions, and errors will appear here.</span></div>'
    : renderGroup('Needs attention', attention) + renderGroup('Recent activity', recent)

  const counts = store().counts()
  const badge = document.getElementById('activity-count')
  if (badge) {
    badge.textContent = String(counts.attention || counts.unread)
    badge.hidden = counts.attention === 0 && counts.unread === 0
  }
  document.getElementById('activity-center-btn')?.setAttribute('aria-label', counts.attention > 0
    ? `Activity center: ${counts.attention} need attention`
    : `Activity center: ${counts.unread} unread`)
}

export function openActivityCenter() {
  const modal = ensureModal()
  modal.hidden = false
  render()
  store().markAllRead()
  modalHandle = openModal({
    node: modal,
    panel: modal.querySelector('.activity-panel'),
    labelledBy: 'activity-title',
    onClose: () => {
      modal.hidden = true
      modalHandle = null
    },
  })
}

export function closeActivityCenter() {
  if (modalHandle) {
    const handle = modalHandle
    modalHandle = null
    handle.close()
  } else {
    const modal = document.getElementById('activity-center')
    if (modal) modal.hidden = true
  }
}

export function recordActivity(entry) { store().add(entry) }
export function resolveActivity(key) { store().resolve(key) }

export function initActivityCenter() {
  ensureModal()
  render()
  document.getElementById('activity-center-btn')?.addEventListener('click', openActivityCenter)
  store().subscribe(render)
}
