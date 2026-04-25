// toast.js — Lightweight in-dashboard toast notifications
let toastTimer = null

export function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2500)
}
