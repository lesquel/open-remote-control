// markdown.js — Marked + hljs initialization and render helpers

/**
 * Must be called after CDN scripts are loaded.
 * Configures marked to use hljs for code highlighting.
 */
export function initMarkdown() {
  if (window.hljs) {
    hljs.configure({ ignoreUnescapedHTML: true })

    const renderer = new marked.Renderer()
    renderer.code = function(code, lang) {
      let highlighted = ''
      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(code, { language: lang }).value
        } catch (_) {
          highlighted = escapeHtml(code)
        }
      } else {
        try {
          highlighted = hljs.highlightAuto(code).value
        } catch (_) {
          highlighted = escapeHtml(code)
        }
      }
      return `<pre><code class="hljs language-${escapeHtml(lang || '')}">${highlighted}</code></pre>`
    }
    marked.setOptions({ renderer, breaks: true, gfm: true })
  } else {
    marked.setOptions({ breaks: true, gfm: true })
  }
}

/**
 * Parse markdown text to HTML. Falls back to escaped text on error.
 */
export function renderMarkdown(text) {
  try {
    return window.marked ? marked.parse(text ?? '') : escapeHtml(text ?? '')
  } catch (_) {
    return escapeHtml(text ?? '')
  }
}

/**
 * HTML-escape a string for safe insertion.
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
