// diff-anchor.test.ts — Regression guards for diff tab anchor wiring.
//
// The diff view added in #22 must emit stable per-file data-file attributes so
// that file-row clicks in the Files Changed panel can scroll-and-highlight the
// right section.  These pure helpers are inlined here (same pattern as
// normalizeMessage.test.ts) to avoid pulling browser-only modules (state.js,
// api.js) into the test runner.
//
// If you change fileAnchorKey or the renderDiff file-section logic in
// src/dashboard/ui/diff.js, update these tests to match — they are the
// contract between files-changed.js click handlers and diff.js output.

import { describe, test, expect } from "bun:test"

// ── Inline copy of fileAnchorKey (must stay identical to diff.js) ──────────
function fileAnchorKey(filePath: string): string {
  return encodeURIComponent(filePath.replace(/\\/g, '/'))
}

// ── Inline copy of escapeHtml (must stay identical to markdown.js) ─────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Inline copy of renderDiff core logic (must stay aligned with diff.js) ──
function renderDiff(diffText: string): string {
  if (!diffText || !diffText.trim()) {
    return '<div class="diff-empty-state"'
  }

  const rawLines = diffText.split('\n')
  type Section = { path: string | null; lines: string[] }
  const sections: Section[] = []
  let current: Section | null = null

  for (const line of rawLines) {
    if (line.startsWith('+++ ')) {
      const raw = line.slice(4).replace(/^[ab]\//, '').trim()
      if (raw !== '/dev/null') {
        current = { path: raw, lines: [line] }
        sections.push(current)
        continue
      }
    }
    if (current) {
      current.lines.push(line)
    } else {
      if (!sections.length) {
        sections.push({ path: null, lines: [line] })
      } else {
        sections[0].lines.push(line)
      }
    }
  }

  if (!sections.length) {
    return '<div class="diff-empty-state"'
  }

  return sections.map(section => {
    const lineHtml = section.lines.map(line => {
      let cls = 'diff-line'
      if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add'
      else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del'
      else if (line.startsWith('@@')) cls += ' diff-hunk'
      return `<div class="${cls}">${escapeHtml(line)}</div>`
    }).join('')

    if (!section.path) {
      return `<div class="diff-container">${lineHtml}</div>`
    }

    const key = fileAnchorKey(section.path)
    return `<div class="diff-file-section diff-container" data-file="${escapeHtml(key)}">\n  <div class="diff-file-header" title="${escapeHtml(section.path)}">${escapeHtml(section.path)}</div>\n  ${lineHtml}\n</div>`
  }).join('')
}

// ── Sample unified diff fixture ────────────────────────────────────────────
const SAMPLE_DIFF = `--- a/src/foo/bar.ts
+++ b/src/foo/bar.ts
@@ -1,3 +1,4 @@
 context line
-removed line
+added line
+another added
--- a/src/baz/qux.ts
+++ b/src/baz/qux.ts
@@ -10,2 +10,3 @@
 ctx
+new line
`

// ── Tests ──────────────────────────────────────────────────────────────────

describe("fileAnchorKey", () => {
  test("forward-slash paths encode correctly", () => {
    const key = fileAnchorKey("src/foo/bar.ts")
    // encodeURIComponent encodes slashes
    expect(key).toBe("src%2Ffoo%2Fbar.ts")
  })

  test("backslash paths are normalised to forward-slash before encoding", () => {
    const key = fileAnchorKey("src\\foo\\bar.ts")
    expect(key).toBe("src%2Ffoo%2Fbar.ts")
  })

  test("roundtrips correctly via decodeURIComponent", () => {
    const path = "some/deeply/nested/file.js"
    expect(decodeURIComponent(fileAnchorKey(path))).toBe(path)
  })

  test("backslash and forward-slash paths produce the same key", () => {
    expect(fileAnchorKey("a\\b\\c.ts")).toBe(fileAnchorKey("a/b/c.ts"))
  })
})

describe("renderDiff — empty state", () => {
  test("empty string returns empty-state element", () => {
    expect(renderDiff("")).toContain("diff-empty-state")
  })

  test("whitespace-only string returns empty-state element", () => {
    expect(renderDiff("   \n  ")).toContain("diff-empty-state")
  })
})

describe("renderDiff — file-section anchors", () => {
  test("each file in the diff gets a diff-file-section with correct data-file", () => {
    const html = renderDiff(SAMPLE_DIFF)

    const key1 = fileAnchorKey("src/foo/bar.ts")
    const key2 = fileAnchorKey("src/baz/qux.ts")

    expect(html).toContain(`data-file="${escapeHtml(key1)}"`)
    expect(html).toContain(`data-file="${escapeHtml(key2)}"`)
  })

  test("each section has a diff-file-header showing the file path", () => {
    const html = renderDiff(SAMPLE_DIFF)
    expect(html).toContain(`class="diff-file-header"`)
    expect(html).toContain("src/foo/bar.ts")
    expect(html).toContain("src/baz/qux.ts")
  })

  test("added lines get diff-add class", () => {
    const html = renderDiff(SAMPLE_DIFF)
    expect(html).toContain("diff-add")
  })

  test("removed lines get diff-del class", () => {
    const html = renderDiff(SAMPLE_DIFF)
    expect(html).toContain("diff-del")
  })

  test("hunk headers get diff-hunk class", () => {
    const html = renderDiff(SAMPLE_DIFF)
    expect(html).toContain("diff-hunk")
  })

  test("data-file attribute key matches fileAnchorKey output for the same path", () => {
    // This verifies the contract: files-changed.js uses el.dataset.path (the
    // full path from parseDiff), passes it to navigateToDiffFile, which calls
    // fileAnchorKey to build the query selector — the same key that renderDiff
    // embeds in data-file. If these diverge, scroll-to-file breaks silently.
    const path = "src/foo/bar.ts"
    const html = renderDiff(SAMPLE_DIFF)
    const expectedKey = fileAnchorKey(path)
    expect(html).toContain(`data-file="${expectedKey}"`)
  })
})

describe("renderDiff — HTML safety", () => {
  test("special characters in file paths are escaped", () => {
    const maliciousDiff = `--- a/<script>alert(1)</script>
+++ b/<script>alert(1)</script>
@@ -1 +1 @@
+line
`
    const html = renderDiff(maliciousDiff)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
