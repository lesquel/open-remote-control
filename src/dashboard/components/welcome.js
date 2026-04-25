// welcome.js — Getting-started collapsible shown on first visit.
// Import and call initWelcome() from main.js bootstrap.

const STORAGE_KEY = 'pilot_welcome_dismissed'

const WELCOME_CSS = `
.welcome-card {
  position: relative;
  margin: 8px 8px 0;
  padding: 12px 14px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}
.welcome-card h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--text);
}
.welcome-card ol {
  margin: 0 0 8px;
  padding-left: 18px;
}
.welcome-card ol li {
  margin-bottom: 3px;
}
.welcome-card a {
  color: var(--accent);
  text-decoration: none;
  font-size: 11px;
}
.welcome-card a:hover {
  text-decoration: underline;
}
.welcome-close {
  position: absolute;
  top: 6px;
  right: 8px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.welcome-close:hover {
  color: var(--text);
}
.welcome-card.fade-out {
  opacity: 0;
  transition: opacity 200ms ease;
}
`

export function initWelcome() {
  if (localStorage.getItem(STORAGE_KEY) === '1') return

  const mount = document.getElementById('welcome-mount')
  if (!mount) return

  // Inject styles once
  if (!document.getElementById('welcome-card-style')) {
    const style = document.createElement('style')
    style.id = 'welcome-card-style'
    style.textContent = WELCOME_CSS
    document.head.appendChild(style)
  }

  const card = document.createElement('div')
  card.className = 'welcome-card'
  card.setAttribute('role', 'region')
  card.setAttribute('aria-label', 'Getting started')
  card.innerHTML = `
    <button class="welcome-close" aria-label="Dismiss" title="Dismiss">\xd7</button>
    <h3>Getting started</h3>
    <ol>
      <li>Type a prompt below and press Enter to send it to OpenCode.</li>
      <li>Approve or deny permission requests as they appear.</li>
      <li>Click the phone icon to connect your phone via QR code or tunnel.</li>
      <li>Click the gear (⚙) to configure Telegram, Web Push, and more.</li>
    </ol>
    <a href="https://github.com/lesquel/open-remote-control#readme" target="_blank" rel="noopener">Full docs →</a>
  `

  mount.appendChild(card)

  card.querySelector('.welcome-close').addEventListener('click', () => {
    localStorage.setItem(STORAGE_KEY, '1')
    card.classList.add('fade-out')
    setTimeout(() => card.remove(), 200)
  })
}
