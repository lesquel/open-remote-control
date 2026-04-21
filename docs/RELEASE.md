# Release checklist — `@lesquel/opencode-pilot`

This is the **execution** checklist for shipping a new version. First-time npm-account setup is covered in [`PUBLISHING_TO_NPM.md`](./PUBLISHING_TO_NPM.md); don't duplicate that here.

**The entire release pipeline is driven by one action: pushing a tag `vX.Y.Z` to `origin`.** Everything else is preparation.

---

## The three places version lives

Every release must bump **all three of these in a single commit**. The asset-sanity test (`src/server/dashboard/__tests__/asset-sanity.test.ts`) fails the build if they drift.

| File | Line to change | Notes |
|------|---------------|-------|
| `package.json` | `"version": "X.Y.Z"` | Canonical — npm reads this one. |
| `src/server/constants.ts` | `export const PILOT_VERSION = "X.Y.Z"` | Served from `/health` so the dashboard + TUI show the live version. |
| `src/server/dashboard/index.html` | `var GEN = "X.Y.Z"` | Bumps the self-heal marker so browsers purge the old service worker + localStorage. |

If you forget any of them, `bun test` fails with a clear diff, which is the whole point — CI catches it before anything leaves your machine.

---

## The only pipeline that ships to users

```
git push origin vX.Y.Z
  │
  └──►  .github/workflows/release.yml
         ├─ bun install --frozen-lockfile
         ├─ bun run typecheck            # tsc --noEmit
         ├─ bun test                     # 228+ tests
         ├─ npm publish --access public --provenance
         └─ softprops/action-gh-release  # GitHub Release from CHANGELOG.md
```

**Do not run `npm publish` locally.** It skips the CI safety net and bypasses npm provenance. The only supported path to production is the tag push.

---

## Step-by-step for every release

### 1. Decide the version

Semver, applied to a user-facing plugin:

- **Patch (Z)** — bug fixes, observability improvements, doc-only changes, non-breaking internal refactors. Issue #1 fix shipped as 1.13.12 → 1.13.13.
- **Minor (Y)** — new optional features, new endpoints, new slash commands. No breaking change to `opencode.json::plugin` spec, `PilotState` shape, or HTTP route table.
- **Major (X)** — break any of the above. Plan a deprecation cycle first. Major bumps are rare for plugins because every user must restart OpenCode.

### 2. Bump the three version strings

```bash
# Use your editor or a quick sd/sed pass:
sd '"version": "[^"]*"'              '"version": "X.Y.Z"'          package.json
sd 'PILOT_VERSION = "[^"]*"'         'PILOT_VERSION = "X.Y.Z"'     src/server/constants.ts
sd 'var GEN = "[^"]*";'              'var GEN = "X.Y.Z";'          src/server/dashboard/index.html
```

### 3. Write the CHANGELOG entry

Most recent version at the top. Keep-a-Changelog format. A good entry explains **what**, **why**, and **how to verify the fix** — future you will read this when a user reports "it's broken again in 2 months".

Template:

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Fixed — <one-line summary> ([#N](https://github.com/lesquel/open-remote-control/issues/N))

**The report**

<what the user saw, in the user's words if possible>

**Root cause(s)**

1. …
2. …

**The fix**

<what changed, where, and why that closes the issue>

**Regression test**

<pointer to the test file / test name that guards against recurrence>
```

### 4. Run the exact CI pipeline locally

```bash
bun scripts/prepublish-guard.ts   # asset sanity, file manifest, etc
bun run typecheck                 # tsc --noEmit
bun test                          # 228+ tests
```

If anything fails, fix it before commit — never commit and then patch on top, the history becomes noisy.

### 5. Conventional commit

Scope is the version, not a feature scope. This is the repo convention and makes `git log --oneline` scan as a release ledger.

```bash
git commit -m "$(cat <<'EOF'
fix(vX.Y.Z): <one-line summary>

<optional multi-paragraph body, wrapped at 72 chars>
EOF
)"
```

Use `fix(...)` for bug fixes, `feat(...)` for features, `chore(...)` for version-bump-only or doc-only releases.

### 6. Tag

```bash
git tag vX.Y.Z
```

Do not use `-a -m` — the tag message is redundant with the commit message and clutters `git log`.

### 7. Push commit, wait, push tag

```bash
git push origin main
# → watch .github/workflows/ci.yml go green on the commit
gh run watch --exit-status  # or open the run in the browser

# Only after CI is green:
git push origin vX.Y.Z
# → release.yml runs, npm publishes, GH Release is cut
```

**Why separate pushes:** if the tag lands before CI finishes on the commit, the release workflow may race CI and publish against untested state. Two pushes cost you 30 seconds; skipping the wait costs you an unpublishable npm version.

### 8. Verify after publish

```bash
# The package is live on npm within ~30s of workflow success:
npm view @lesquel/opencode-pilot version
# → should print X.Y.Z

# The GH Release has auto-generated notes:
gh release view vX.Y.Z --web

# End-to-end smoke test:
bunx @lesquel/opencode-pilot@X.Y.Z --version
```

---

## If a release goes bad

### You pushed a bad tag before CI was green and CI failed

The release workflow failed before `npm publish`. Nothing went out.

```bash
# Delete the bad tag locally and on origin:
git tag -d vX.Y.Z
git push origin --delete vX.Y.Z

# Fix the commit, amend if not pushed, or add a new commit.
# Re-tag once CI is green.
```

### The package published but is broken

You cannot unpublish after 72 hours. You cannot republish the same version. The recovery is:

1. Bump to the next patch (X.Y.Z+1) with the actual fix.
2. Release that version following this checklist.
3. Mark the broken version as deprecated so installs get a warning:
   ```bash
   npm deprecate @lesquel/opencode-pilot@X.Y.Z \
     "Broken release — upgrade to X.Y.(Z+1). See CHANGELOG for details."
   ```

Never try to overwrite a published version. Npm treats that as a supply-chain attack.

### A user reports a regression in the just-shipped version

1. Open a GitHub issue (or take the one they filed) and label it `regression`.
2. Reproduce locally against the exact published version: `bunx @lesquel/opencode-pilot@X.Y.Z init` in a clean OpenCode config dir.
3. Revert the suspect commit on a branch, not on `main`. Verify the revert fixes the symptom.
4. Decide: ship a revert-patch (X.Y.Z+1 that undoes the change), or ship a forward-patch that keeps the intent but fixes the regression.
5. Follow steps 1–8 above.

---

## Pre-flight checks CI will run anyway

These run in `.github/workflows/release.yml` — local is a fast-feedback dress rehearsal, not a gate:

- `bun install --frozen-lockfile` — `bun.lock` must be clean.
- `bun run typecheck` — zero type errors.
- `bun test` — all tests pass (228+ as of 1.13.13).
- `npm publish --access public --provenance` — signed publish.

Things CI **does not** check:

- `oxlint` is in the repo's npm scripts but marked `continue-on-error: true` in CI because it's not fully configured yet. Don't rely on it.
- Runtime testing against a real OpenCode instance. If you changed anything around plugin loading, event hooks, or TUI integration, test manually with `opencode` before pushing the tag.

---

## Security / secrets

- `NPM_TOKEN` is stored in repo Settings → Secrets → Actions. It's a granular access token scoped to this package only. If it ever leaks, rotate it on npmjs.com immediately and update the GH secret.
- `id-token: write` is granted to the release job so npm provenance works. Provenance proves the package was built by this exact commit on this exact workflow — users can verify with `npm view @lesquel/opencode-pilot --json | jq .dist.attestations`.

---

## Who can release

Any collaborator with push access to tags on the repo. The NPM_TOKEN in Actions is what actually signs the publish, so personal npm credentials are not used and do not need to be shared.
