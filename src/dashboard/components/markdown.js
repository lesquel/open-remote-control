// markdown.js — Marked initialization and safe render helpers

/**
 * Must be called after the self-hosted parser and sanitizer load.
 *
 * Agent output is untrusted input. Marked turns it into HTML, so every parsed
 * result must pass through DOMPurify before it reaches an innerHTML sink.
 */
export function initMarkdown() {
  if (window.marked) marked.setOptions({ breaks: true, gfm: true })
}

/**
 * Parse untrusted markdown to safe HTML. The HTML profile deliberately omits
 * SVG and MathML, and interactive/document-level nodes are forbidden to avoid
 * script execution, unsafe URL schemes, and DOM clobbering in message bodies.
 */
export function renderMarkdown(text) {
  try {
    if (!window.marked || !window.DOMPurify) return escapeHtml(text ?? '')
    const rendered = marked.parse(text ?? '')
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['base', 'button', 'embed', 'form', 'iframe', 'img', 'input', 'link', 'meta', 'object', 'style'],
      FORBID_ATTR: ['id', 'name', 'style'],
    })
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
