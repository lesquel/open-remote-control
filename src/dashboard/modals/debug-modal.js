// debug-modal.js — Secret-free local diagnostics panel.
import { getState } from '../state/state.js'
import { fetchDiagnostics } from '../api/api.js'
import { openModal } from './modal-helper.js'
import { diagnosticsCopyPayload, renderDiagnostics } from './diagnostics-view.js'

let copyPayload = ''

function ensureModal() {
  if (document.getElementById('debug-modal')) return
  const el = document.createElement('div')
  el.id = 'debug-modal'
  el.className = 'modal-overlay'
  el.innerHTML = `
    <div class="modal-box modal-box--wide diagnostics-modal">
      <div class="modal-header">
        <div>
          <h2 id="diagnostics-title">Diagnostics</h2>
          <p>Local operational data only. Prompts, source code, and credentials are excluded.</p>
        </div>
        <div class="diagnostics-actions">
          <button id="debug-refresh-btn" class="btn btn--secondary" type="button">Refresh</button>
          <button id="debug-copy-btn" class="btn btn--secondary" type="button">Copy report</button>
          <button id="debug-close-btn" class="btn btn--ghost" type="button">Close</button>
        </div>
      </div>
      <div id="debug-modal-body" class="diagnostics-body" aria-live="polite">Loading diagnostics…</div>
    </div>`
  document.body.appendChild(el)
}

async function refreshDiagnostics() {
  const body = document.getElementById('debug-modal-body')
  const refresh = document.getElementById('debug-refresh-btn')
  if (!body) return
  body.textContent = 'Loading diagnostics…'
  if (refresh) refresh.disabled = true
  try {
    const snapshot = await fetchDiagnostics()
    const client = { connected: Boolean(getState().sse?.connected) }
    body.innerHTML = renderDiagnostics(snapshot, client)
    copyPayload = diagnosticsCopyPayload(snapshot, client)
  } catch (error) {
    copyPayload = ''
    const requestId = error?.requestId ? ` Error ID: ${error.requestId}.` : ''
    const failure = document.createElement('div')
    failure.className = 'diagnostics-error'
    failure.setAttribute('role', 'alert')
    const title = document.createElement('strong')
    title.textContent = 'Couldn’t load diagnostics.'
    const detail = document.createElement('span')
    detail.textContent = `Check the connection and try again.${requestId}`
    failure.append(title, detail)
    body.replaceChildren(failure)
  } finally {
    if (refresh) refresh.disabled = false
  }
}

export async function openDebugModal() {
  ensureModal()
  const modal = document.getElementById('debug-modal')
  modal.classList.add('open')
  const panel = modal.querySelector('.modal-box') ?? modal.firstElementChild
  const handle = openModal({
    node: modal,
    panel,
    labelledBy: 'diagnostics-title',
    onClose: () => modal.classList.remove('open'),
  })

  document.getElementById('debug-close-btn').onclick = () => handle.close()
  document.getElementById('debug-refresh-btn').onclick = () => refreshDiagnostics()
  document.getElementById('debug-copy-btn').onclick = async () => {
    if (!copyPayload) return
    const button = document.getElementById('debug-copy-btn')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(copyPayload)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Copy failed'
    }
    setTimeout(() => { button.textContent = 'Copy report' }, 1500)
  }
  await refreshDiagnostics()
}
