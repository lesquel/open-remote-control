# Publishing opencode-pilot to npm

This guide walks through publishing the plugin so other people can install it
with `npm install opencode-pilot` (or `bun add opencode-pilot`) into their own
OpenCode setup.

## What "npm publish" actually means for this project

opencode-pilot is a **plugin**, not a standalone app. When someone installs it
via npm, they get the source files (`src/`, `package.json`, `README.md`,
`LICENSE`, `CHANGELOG.md`). They then load it into OpenCode by adding it to
their `opencode.json` plugins array.

**Each user runs their OWN instance.** Their plugin reads their OWN `.env`.
Variables you set on your machine are NOT replicated. Each user configures
their own `PILOT_PORT`, `PILOT_HOST`, `PILOT_TUNNEL`, etc. (more on this in
the `.env` section below).

## One-time setup: your npm account

1. Create an npm account at https://www.npmjs.com/signup if you don't have one.
2. Verify your email — npm requires this before publishing.
3. Choose your package name strategy:
   - **Unscoped** (`opencode-pilot`) — current name. Must be globally unique on npm.
   - **Scoped** (`@lesquel/opencode-pilot`) — namespaced under your username,
     never collides. Requires `--access public` on first publish.

   Check availability: `npm view opencode-pilot` — if it returns "404", the
   name is free. If it returns metadata, someone already published it.

4. Generate an npm token for CI:
   - Go to https://www.npmjs.com/settings/{your-username}/tokens
   - Create token type **"Automation"** (these don't require 2FA on each publish)
   - Copy the token — you'll only see it once

5. Add the token to GitHub Secrets:
   - Go to your repo → Settings → Secrets and variables → Actions
   - New repository secret named `NPM_TOKEN`
   - Paste the token value

## The package.json — what you ship

Open `package.json` and verify:

```jsonc
{
  "name": "opencode-pilot",          // or "@lesquel/opencode-pilot"
  "version": "1.11.0",                // bumped per release
  "type": "module",
  "exports": {
    "./server": "./src/server/index.ts",
    "./tui": "./src/tui/index.ts"
  },
  "main": "./src/server/index.ts",
  "files": [
    "src/",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  // ...
}
```

The `files` array is what npm includes in the published tarball. Anything not
listed is excluded — your `.env`, your `node_modules/`, your test files all
stay private.

To preview what gets published WITHOUT actually publishing:

```bash
npm pack --dry-run
```

This prints every file that would be in the tarball. Review it before your
first publish.

## Manual first publish

```bash
# Make sure you're logged in
npm login

# Bump version (or do it manually in package.json)
# Use one of: patch / minor / major
npm version patch    # 1.11.0 → 1.11.1
# or
npm version minor    # 1.11.0 → 1.12.0
# or
npm version major    # 1.11.0 → 2.0.0
```

`npm version` automatically commits the bump and creates a git tag.

```bash
# Run tests + typecheck before publishing — never publish broken code
bun test
bun run typecheck

# Publish. For unscoped: just `npm publish`. For scoped, --access public:
npm publish --access public

# Push the version commit and tag to GitHub
git push origin main --tags
```

After this, anyone can install:

```bash
npm install opencode-pilot
# or
bun add opencode-pilot
```

## Automated publish via GitHub Actions

The repo already has `.github/workflows/release.yml` that publishes on every
git tag matching `v*.*.*`. It needs `NPM_TOKEN` configured (step 5 above).

Workflow:

```bash
# Bump and tag in one shot
npm version patch     # creates commit + tag locally
git push origin main --tags
```

GitHub Actions sees the new tag, runs tests, and publishes. The release
workflow also creates a GitHub Release with the changelog body.

## Pre-publish checklist (run before EVERY release)

- [ ] `bun install` — lockfile is in sync with package.json
- [ ] `bun run typecheck` — 0 errors
- [ ] `bun test` — all green
- [ ] `CHANGELOG.md` has an entry for this version
- [ ] Version bumped in `package.json` AND `src/server/constants.ts` AND
      `src/server/dashboard/debug-modal.js` AND `src/server/dashboard/right-panel.js`
      (the codebase has 4 places). Use a single search-and-replace.
- [ ] `npm pack --dry-run` shows the right files (no `.env`, no test files
      bigger than expected)
- [ ] Manual smoke test: install the tarball locally and load in OpenCode

To smoke test the tarball before public publish:

```bash
npm pack                              # creates opencode-pilot-1.11.0.tgz
mkdir /tmp/test-install && cd /tmp/test-install
npm init -y
npm install /path/to/opencode-pilot-1.11.0.tgz
# Inspect node_modules/opencode-pilot/ — is everything there?
```

## What new users have to do (write this in your README)

After they `npm install opencode-pilot`, they need:

1. Add the plugin to their `opencode.json`:
   ```jsonc
   {
     "plugins": ["opencode-pilot"]
   }
   ```
2. Create a `.env` file in their OpenCode project root (or wherever they launch
   OpenCode from) with at minimum:
   ```bash
   PILOT_HOST=127.0.0.1   # or 0.0.0.0 for LAN access
   PILOT_PORT=4097
   ```
3. (Optional) For tunnel access: `PILOT_TUNNEL=cloudflared`
4. (Optional) For Telegram: `PILOT_TELEGRAM_TOKEN=…` + `PILOT_TELEGRAM_CHAT_ID=…`
5. (Optional) For Web Push: `PILOT_VAPID_PUBLIC_KEY=…` + `PILOT_VAPID_PRIVATE_KEY=…`
   (generate via `npx web-push generate-vapid-keys`)
6. Restart OpenCode. The plugin auto-loads. Banner with QR code prints to
   terminal. Open the URL or scan the QR.

## About environment variables and other users

**Variables are NOT shared.** Each user has their own `.env`. Your `PILOT_TOKEN`
is generated fresh on every plugin start (random UUID). Other users get their
own random tokens.

What IS shared via npm:
- The plugin code itself
- Default values (`PILOT_PORT=4097`, `PILOT_HOST=127.0.0.1`, etc.)
- Documentation

What is NOT shared:
- `.env` (gitignored, never published)
- Generated tokens
- Telegram bot tokens
- VAPID keys
- Tunnel-provider-specific config

## Versioning policy (recommended)

Follow semver:

- **Patch** (`1.11.0 → 1.11.1`) — bug fixes, no new features, no breaking changes
- **Minor** (`1.11.0 → 1.12.0`) — new features, backward compatible
- **Major** (`1.11.0 → 2.0.0`) — breaking changes (config rename, removed endpoint, etc.)

Pre-1.0 versions can break anything in any release. You're past 1.0 — be more
careful with majors.

## Unpublishing (use sparingly)

If you publish a broken version:

```bash
# Within 72 hours of publish, you can unpublish:
npm unpublish opencode-pilot@1.11.0

# After 72 hours, you can only deprecate (mark as broken, install warns user):
npm deprecate opencode-pilot@1.11.0 "broken — use 1.11.1+"
```

Unpublishing is discouraged because it breaks anyone who depends on that
version. Always prefer to publish a fix as a new version.

## Troubleshooting common publish errors

| Error | Meaning | Fix |
|-------|---------|-----|
| `403 Forbidden` | Name taken, or no publish access | Use scoped name `@user/pkg` or pick a different name |
| `ENEEDAUTH` | Not logged in / no token | `npm login` or set `NPM_TOKEN` env var |
| `EPUBLISHCONFLICT` | Version already published | Bump version, can't republish same number |
| `--frozen-lockfile` failure in CI | `bun.lock` out of sync with `package.json` | Run `bun install` locally, commit lockfile |
| Tarball too big (>100MB) | Including too many files | Refine `files` array in package.json |

## After publish: your users

Once published, your users can find your package at:

- https://www.npmjs.com/package/opencode-pilot
- Stats: install count, dependents, weekly downloads
- Issues: route through your GitHub Issues (linked in package.json)

Watch the GitHub Issues queue. Early users will hit edge cases your local
testing didn't catch.
