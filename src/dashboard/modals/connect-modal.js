// connect-modal.js — "Connect from phone" modal
// Shows LAN URL (+ tunnel above it when active) with QR code rendered via
// dynamically loaded qrcode library. Localhost URL is intentionally omitted —
// phones cannot reach 127.0.0.1 (closes #7).
import { createDevicePairing, fetchConnectInfo } from '../api/api.js'
import { toast } from '../ui/toast.js'
import { openModal } from './modal-helper.js'
import { pickBestUrlForMobile } from './connect-url-picker.js'

// ── QR loader (cached promise, loaded once) ────────────────────────────────

let _qrLoadPromise = null

/**
 * Dynamically import the qrcode library from CDN.
 * Caches the load promise so the script is only fetched once.
 * Resolves with the QRCode global, or null if offline/unavailable.
 */
function loadQRLib() {
  if (_qrLoadPromise) return _qrLoadPromise
  _qrLoadPromise = new Promise((resolve) => {
    if (window.QRCode) { resolve(window.QRCode); return }
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js'
    script.onload = () => resolve(window.QRCode ?? null)
    script.onerror = () => { _qrLoadPromise = null; resolve(null) }
    document.head.appendChild(script)
  })
  return _qrLoadPromise
}

/**
 * Render a QR code for `url` into `container`.
 * If the library fails to load, falls back to a copyable URL display.
 * @param {HTMLElement} container
 * @param {string} url
 */
async function renderQR(container, url) {
  container.innerHTML = '<div class="qr-loading">Loading QR…</div>'

  const QRCode = await loadQRLib()
  if (!QRCode) {
    container.innerHTML = `
      <div class="qr-offline">
        <div class="qr-offline-label">QR code unavailable offline</div>
        <div class="qr-offline-hint">Copy the URL manually:</div>
        <code class="qr-fallback-url">${escHtml(url)}</code>
      </div>`
    return
  }

  const canvas = document.createElement('canvas')
  container.innerHTML = ''
  container.appendChild(canvas)

  try {
    await QRCode.toCanvas(canvas, url, {
      width: 200,
      margin: 2,
      color: { dark: '#1e1b2e', light: '#f0eef8' },
    })
  } catch {
    container.innerHTML = `
      <div class="qr-offline">
        <div class="qr-offline-label">QR rendering failed</div>
        <code class="qr-fallback-url">${escHtml(url)}</code>
      </div>`
  }
}

// ── State ──────────────────────────────────────────────────────────────────

let _isOpen = false
let _connectInfo = null
let _refreshTimer = null
let _modalHandle = null
let _pairing = null

function pairingUrl(rawUrl, pairingToken) {
  try {
    const url = new URL(rawUrl)
    url.searchParams.delete('token')
    url.searchParams.set('pair', pairingToken)
    return url.toString()
  } catch {
    return rawUrl
  }
}

/**
 * Invalidate the cached connect-info snapshot.
 * Call this after a settings save that may affect the tunnel provider so that
 * the next modal open (or the current poll tick) shows fresh data.
 * If the modal is already open it will re-fetch within the next 10 s poll;
 * if it is closed, the stale cache is discarded so the next open gets a fresh
 * fetch immediately rather than briefly flashing old state.
 */
export function invalidateConnectInfoCache() {
  _connectInfo = null
  if (_isOpen) _refresh()
}

// ── Open / Close ──────────────────────────────────────────────────────────

export function openConnectModal() {
  const modal = document.getElementById('connect-phone-modal')
  if (!modal || _isOpen) return
  modal.classList.add('open')
  _isOpen = true
  _refresh()
  _startPolling()
  const panel = modal.querySelector('.modal-panel') ?? modal.querySelector('.cpm-box') ?? modal.firstElementChild
  _modalHandle = openModal({
    node: modal,
    panel,
    onClose: closeConnectModal,
  })
}

export function closeConnectModal() {
  const modal = document.getElementById('connect-phone-modal')
  if (!modal || !_isOpen) return
  modal.classList.remove('open')
  _isOpen = false
  _stopPolling()
  _modalHandle = null
}

function _startPolling() {
  _stopPolling()
  _refreshTimer = setInterval(_refresh, 10_000)
}

function _stopPolling() {
  if (_refreshTimer !== null) {
    clearInterval(_refreshTimer)
    _refreshTimer = null
  }
}

// ── Data refresh ──────────────────────────────────────────────────────────

async function _refresh() {
  try {
    _connectInfo = await fetchConnectInfo()
    if (!_pairing || _pairing.expiresAt - Date.now() < 30_000) {
      _pairing = await createDevicePairing('operator')
    }
    if (_pairing?.pairingToken) {
      if (_connectInfo.lan?.url) _connectInfo.lan.url = pairingUrl(_connectInfo.lan.url, _pairing.pairingToken)
      if (_connectInfo.tunnel?.url) _connectInfo.tunnel.url = pairingUrl(_connectInfo.tunnel.url, _pairing.pairingToken)
    }
  } catch {
    // If fetch fails (e.g. offline), keep the last known info
  }
  _renderContent()
}

// ── Render ─────────────────────────────────────────────────────────────────

function _renderContent() {
  const body = document.getElementById('connect-phone-body')
  if (!body) return

  if (!_connectInfo) {
    body.innerHTML = '<div class="cpm-loading">Loading…</div>'
    return
  }

  const { lan, tunnel } = _connectInfo

  let html = ''

  // ── Tunnel section (shown only when active) ────────────────────────────
  if (tunnel?.available && tunnel?.url) {
    html += `
      <div class="cpm-section cpm-section--tunnel">
        <div class="cpm-section-header">
          <span class="cpm-section-label">Public tunnel</span>
          <span class="cpm-provider-badge">via ${escHtml(tunnel.provider ?? '')}</span>
        </div>
        <div class="cpm-qr-wrap" id="cpm-qr-tunnel"></div>
        <div class="cpm-url-row">
          <code class="cpm-url">${escHtml(tunnel.url)}</code>
          <button class="btn btn-ghost cpm-copy-btn" data-copy="${escHtml(tunnel.url)}">Copy</button>
        </div>
        <div class="cpm-warning-box cpm-warning-box--security">
          This one-time operator pairing link expires in five minutes. Only share it with a device you trust.
        </div>
      </div>
    `
  }

  // ── LAN section ────────────────────────────────────────────────────────
  html += '<div class="cpm-section cpm-section--lan">'

  if (tunnel?.available) {
    html += '<div class="cpm-section-label">Local network</div>'
  }

  if (!lan?.available) {
    html += `
      <div class="cpm-warning-box">
        LAN access is disabled. Set <code>PILOT_HOST=0.0.0.0</code> and restart to enable mobile access.
      </div>`
  } else if (!lan.exposed) {
    html += `
      <div class="cpm-warning-box">
        Server is bound to localhost only. To allow phone access, set
        <code>PILOT_HOST=0.0.0.0</code> and restart OpenCode.
      </div>
      <div class="cpm-url-row">
        <span class="cpm-url-label">Would be:</span>
        <code class="cpm-url cpm-url--disabled">${escHtml(lan.url ?? '')}</code>
      </div>
      <div class="cpm-note">
        Make sure your phone is on the same Wi-Fi network before binding to 0.0.0.0.
      </div>`
  } else {
    // LAN is available and exposed — show QR only when no tunnel (avoid two QR codes)
    if (!tunnel?.available) {
      html += `<div class="cpm-qr-wrap" id="cpm-qr-lan"></div>`
    }
    html += `
      <div class="cpm-url-row">
        <code class="cpm-url">${escHtml(lan.url ?? '')}</code>
        <button class="btn btn-ghost cpm-copy-btn" data-copy="${escHtml(lan.url ?? '')}">Copy</button>
      </div>
      <div class="cpm-note">Make sure your phone is on the same Wi-Fi network.</div>`
  }

  html += '</div>'

  body.innerHTML = html
  _wireCopyButtons(body)

  // Render QR for the primary URL (tunnel takes priority)
  if (tunnel?.available && tunnel?.url) {
    renderQR(document.getElementById('cpm-qr-tunnel'), tunnel.url)
  } else if (lan?.available && lan?.exposed && lan?.url) {
    renderQR(document.getElementById('cpm-qr-lan'), lan.url)
  }
}

function _wireCopyButtons(container) {
  container.querySelectorAll('.cpm-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.copy
      if (!url) return
      navigator.clipboard?.writeText(url).then(() => toast('URL copied'))
    })
  })
}

// ── Escape helper ─────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Init ───────────────────────────────────────────────────────────────────

export function initConnectModal() {
  const modal = document.getElementById('connect-phone-modal')
  if (!modal) return

  // Backdrop click and Esc are handled by openModal (called inside openConnectModal).
  // Close button delegates to the active handle so focus is restored properly.
  modal.querySelector('.cpm-close')?.addEventListener('click', () => {
    if (_modalHandle) _modalHandle.close()
    else closeConnectModal()
  })

  // Launcher button in header
  const launchBtn = document.getElementById('connect-phone-btn')
  if (launchBtn) {
    launchBtn.addEventListener('click', openConnectModal)
  }
}
