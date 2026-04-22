// connect-modal.js — "Connect from phone" modal
// Shows LAN, tunnel, and local URLs with QR codes rendered via dynamically
// loaded qrcode library. Falls back to copyable URL text if CDN unavailable.
import { fetchConnectInfo } from './api.js'
import { toast } from './toast.js'
import { openModal } from './modal-helper.js'

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
let _activeTab = 'lan'
let _connectInfo = null
let _refreshTimer = null
let _modalHandle = null

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
  } catch {
    // If fetch fails (e.g. offline), keep the last known info
  }
  _renderContent()
}

// ── Render ─────────────────────────────────────────────────────────────────

function _renderContent() {
  const body = document.getElementById('connect-phone-body')
  if (!body) return

  body.innerHTML = `
    <div class="cpm-tabs">
      <button class="cpm-tab${_activeTab === 'lan' ? ' active' : ''}" data-tab="lan">Local network</button>
      <button class="cpm-tab${_activeTab === 'tunnel' ? ' active' : ''}" data-tab="tunnel">Public tunnel</button>
      <button class="cpm-tab${_activeTab === 'local' ? ' active' : ''}" data-tab="local">Localhost</button>
    </div>
    <div class="cpm-tab-content" id="cpm-tab-content"></div>
  `

  body.querySelectorAll('.cpm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab
      body.querySelectorAll('.cpm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab))
      _renderTab(document.getElementById('cpm-tab-content'))
    })
  })

  _renderTab(document.getElementById('cpm-tab-content'))
}

function _renderTab(container) {
  if (!container) return

  if (!_connectInfo) {
    container.innerHTML = '<div class="cpm-loading">Loading…</div>'
    return
  }

  if (_activeTab === 'lan')    _renderLanTab(container)
  if (_activeTab === 'tunnel') _renderTunnelTab(container)
  if (_activeTab === 'local')  _renderLocalTab(container)
}

function _renderLanTab(container) {
  const { lan } = _connectInfo

  if (!lan.available) {
    container.innerHTML = `
      <div class="cpm-warning-box">
        No non-loopback network interface detected. Connect to a Wi-Fi or wired network.
      </div>`
    return
  }

  if (!lan.exposed) {
    container.innerHTML = `
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
    return
  }

  container.innerHTML = `
    <div class="cpm-qr-wrap" id="cpm-qr-lan"></div>
    <div class="cpm-url-row">
      <code class="cpm-url" id="cpm-url-lan">${escHtml(lan.url ?? '')}</code>
      <button class="btn btn-ghost cpm-copy-btn" data-copy="${escHtml(lan.url ?? '')}">Copy</button>
    </div>
    <div class="cpm-note">Make sure your phone is on the same Wi-Fi network.</div>
  `
  _wireCopyButtons(container)
  renderQR(document.getElementById('cpm-qr-lan'), lan.url ?? '')
}

function _renderTunnelTab(container) {
  const { tunnel } = _connectInfo

  if (!tunnel.available) {
    const providerHint = tunnel.provider
      ? `Provider: <strong>${escHtml(tunnel.provider)}</strong> — status: <strong>${escHtml(tunnel.status)}</strong><br>`
      : ''
    container.innerHTML = `
      <div class="cpm-info-box">
        ${providerHint}
        No tunnel is currently active.
      </div>
      <div class="cpm-instructions">
        <div class="cpm-instructions-title">How to enable a public tunnel:</div>
        <div class="cpm-instructions-step">
          <strong>Option 1 — Cloudflare Tunnel (recommended, zero-config):</strong><br>
          <ol>
            <li>Install cloudflared: <code>brew install cloudflare/cloudflare/cloudflared</code></li>
            <li>Restart OpenCode with: <code>PILOT_TUNNEL=cloudflared</code></li>
          </ol>
        </div>
        <div class="cpm-instructions-step">
          <strong>Option 2 — ngrok:</strong><br>
          <ol>
            <li>Install ngrok: <code>brew install ngrok/ngrok/ngrok</code></li>
            <li>Authenticate: <code>ngrok config add-authtoken YOUR_TOKEN</code></li>
            <li>Restart OpenCode with: <code>PILOT_TUNNEL=ngrok</code></li>
          </ol>
        </div>
      </div>
      <div class="cpm-note">
        ${escHtml(tunnel.howTo ?? '')}
      </div>`
    return
  }

  container.innerHTML = `
    <div class="cpm-qr-wrap" id="cpm-qr-tunnel"></div>
    <div class="cpm-url-row">
      <code class="cpm-url" id="cpm-url-tunnel">${escHtml(tunnel.url ?? '')}</code>
      <button class="btn btn-ghost cpm-copy-btn" data-copy="${escHtml(tunnel.url ?? '')}">Copy</button>
    </div>
    <div class="cpm-provider-badge">via ${escHtml(tunnel.provider ?? '')}</div>
    <div class="cpm-warning-box cpm-warning-box--security">
      Anyone with this URL + token can control your OpenCode. Treat the token as a password.
      Rotate it regularly via the command palette (Rotate Token).
    </div>
  `
  _wireCopyButtons(container)
  renderQR(document.getElementById('cpm-qr-tunnel'), tunnel.url ?? '')
}

function _renderLocalTab(container) {
  const { local } = _connectInfo

  container.innerHTML = `
    <div class="cpm-qr-wrap" id="cpm-qr-local"></div>
    <div class="cpm-url-row">
      <code class="cpm-url" id="cpm-url-local">${escHtml(local.url)}</code>
      <button class="btn btn-ghost cpm-copy-btn" data-copy="${escHtml(local.url)}">Copy</button>
    </div>
    <div class="cpm-note">
      Localhost only — useful for same-device access or Tauri-style setups.
    </div>
  `
  _wireCopyButtons(container)
  renderQR(document.getElementById('cpm-qr-local'), local.url)
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
