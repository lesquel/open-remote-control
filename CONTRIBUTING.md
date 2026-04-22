# Contributing to OpenCode Pilot

Thanks for your interest in improving OpenCode Pilot. This document explains how we work so your contribution has the best chance of being accepted quickly.

## TL;DR — the flow

1. **Open an issue first.** Don't write code until the idea is agreed.
2. **Wait for a maintainer reply.** You'll get one of three answers:
   - *"Thanks, I'll do this myself"* — the maintainer will fix it, comment on the issue, and close it. No PR needed from you.
   - *"Please send a PR"* — you're cleared to implement. See "Submitting a PR" below.
   - *"Out of scope / won't fix"* — reasoned decline. Usually with a suggested alternative.
3. **PR is reviewed, not merged.** Expect questions, requests for tests, style fixes.
4. **Merge.** Maintainer handles the release, changelog, and tag. You don't need to bump versions or touch `CHANGELOG.md`.

Most contributions end at step 2 case 2. That's intentional — it saves everyone's time.

---

## 1. Open an issue first

**For bugs:** use the bug template. Include:
- What you did (exact command or steps).
- What happened.
- What you expected.
- Relevant logs (especially anything from `~/.opencode-pilot/` or OpenCode's log panel).
- Your OS, Node/Bun version, OpenCode version, plugin version.

**For features:** use the feature template. Answer:
- What problem does this solve?
- Who else would benefit (not just you)?
- Is there a workaround today?
- Any thoughts on implementation (optional, but helpful).

**For questions / discussion:** use [GitHub Discussions](https://github.com/lesquel/open-remote-control/discussions) instead of an issue. Issues are for actionable work.

### Why the issue-first rule?

We've had PRs land that:
- Re-implemented something already in a PR branch.
- Conflicted with an internal refactor in flight.
- Solved the wrong problem because scope wasn't aligned first.

A 2-minute issue comment avoids days of rework. No exceptions, not even for "trivial" changes.

---

## 2. Wait for maintainer triage

A maintainer will reply to your issue and assign a label:

| Label | What it means |
|-------|---------------|
| `accepted` | Yes, this needs to be fixed. A maintainer might do it or ask you to. |
| `help-wanted` | Accepted + we'd love your PR. Clear go-ahead for you to implement. |
| `good-first-issue` | Accepted + scoped small enough for a first-time contributor. |
| `needs-info` | We need more detail before deciding. |
| `wontfix` | Not accepted. Reason explained in the thread. |
| `duplicate` | Already tracked elsewhere; link provided. |

**Until you see `help-wanted` or `good-first-issue` (or the maintainer explicitly says "go ahead"), please don't open a PR.** We may be planning to do it ourselves, or we may want to discuss the approach first.

**Small fixes the maintainer may handle directly** (typos, one-line bug fixes, documentation errors, config-file mistakes). You'll see a comment like *"Fixed in commit abc1234 — thanks for the report!"* and the issue will close. Your name goes in the commit message / changelog as the reporter.

---

## 3. Submitting a PR

Once you have the green light:

### Setup

```bash
git clone https://github.com/lesquel/open-remote-control.git
cd open-remote-control
bun install
```

### Before you code

- Read the [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) file to understand the layout.
- Read [`AGENTS.md`](AGENTS.md) — same conventions apply to human contributors.
- Check if there's a related discussion in the issue you're resolving.

### While you code

- **One PR per issue.** Don't bundle unrelated changes.
- **Keep it small.** PRs under ~200 lines of diff are reviewed fastest.
- **Match the style.** TypeScript strict (no `any`), factory functions with `create` prefix (no classes), no `console.log` in server plugin (use `console.error` or `ctx.client.app.log`). See `AGENTS.md` for more.
- **Add tests.** Unit tests for new helpers, integration tests for new HTTP endpoints. Put them in `**/__tests__/*.test.ts` next to the code they cover.
- **No dependencies unless necessary.** We prefer Bun built-ins + standard lib over npm packages.
- **Do not** edit `CHANGELOG.md`, `package.json::version`, or `src/server/constants.ts::PILOT_VERSION`. Those are maintainer-only.

### Verify locally

```bash
bun run typecheck
bun test
```

Both must pass. The repo's `prepublishOnly` hook enforces this before a release goes to npm — if you break either, the release cannot ship.

### Commit style

Conventional commits, **no AI attribution**, **no `Co-Authored-By`**:

```
fix(scope): what was fixed and why

Optional body explaining the context: why the old behavior was
wrong, what root cause you traced it to, any edge cases you
considered.
```

Examples:
- `fix(dashboard): session tab switch leaves stale files-changed panel`
- `feat(telegram): add circuit breaker with exponential backoff`
- `docs(readme): clarify Windows path requirement`
- `chore: bump dev dependencies`

### Open the PR

- Use the PR template (it loads automatically).
- Link the issue: `Closes #123` or `Fixes #123`.
- Describe what changed and **why** — not what the diff already shows.
- List breaking changes under a clear heading if any (there should almost never be any).

### During review

- Maintainers may ask for changes, request tests, or push small edits to your branch.
- Respond to comments within ~1 week so we can keep momentum. Stale PRs may be closed (you can always reopen).
- Don't force-push over review comments. Add commits on top; we squash on merge.

---

## Code of Conduct

By participating in this project you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md). TL;DR: be respectful, assume good faith, no harassment.

---

## Security

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the disclosure process.

---

## License

OpenCode Pilot is licensed under [MIT](LICENSE). By contributing, you agree that your contributions will be licensed the same way, and you certify you have the right to submit them.

There is no CLA to sign. Your Git commits are the record of authorship; `git log` makes your contribution permanent and visible.

---

## Crediting contributors

Every merged PR is attributed to its author in:

- The Git history (`git log`).
- The `CHANGELOG.md` entry for the release it ships in (e.g. *"Fix reported by @username"*, *"PR by @username"*).
- GitHub's auto-generated Contributors graph.

If a significant feature is yours, expect to be named in the release notes.

---

## Questions?

Open a [Discussion](https://github.com/lesquel/open-remote-control/discussions) or ping the maintainer in an existing issue. Thanks for reading this far.
