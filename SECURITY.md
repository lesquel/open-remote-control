# Security Policy

OpenCode Pilot runs inside a developer's local OpenCode process and can expose a remote-control dashboard over LAN or a public tunnel. Please treat security reports seriously and privately.

## Supported versions

Security fixes are made on `main` and released in the next patch/minor version. Users should upgrade to the latest published version as soon as a fix is available.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use a private channel instead:

1. Open a GitHub Security Advisory if available for the repository, or
2. Contact the maintainer privately through the GitHub profile linked from the repository.

If neither option is available, open a minimal public issue that says only: "I need to report a security vulnerability privately". Do not include exploit details, tokens, logs, or reproduction steps in that issue.

## What to include

Please include as much of this as possible:

- A short summary of the vulnerability.
- Affected version or commit.
- Operating system and OpenCode version.
- Whether `PILOT_TUNNEL`, Telegram, Web Push, or `PILOT_ENABLE_GLOB_OPENER` are enabled.
- Reproduction steps or proof of concept.
- Impact: what data or action becomes exposed.
- Whether the issue is already public or known elsewhere.

## What not to include publicly

Never post these in public issues, discussions, screenshots, or PRs:

- Pilot auth tokens.
- Tunnel URLs containing tokens.
- Telegram bot tokens.
- VAPID private keys.
- Contents of `~/.opencode-pilot/config.json`.
- Private project files, shell history, `.env` files, SSH keys, or credentials.

## Response expectations

The maintainer will try to:

1. Acknowledge the report.
2. Reproduce and assess impact.
3. Prepare a fix privately if needed.
4. Release a patched version.
5. Credit the reporter if they want credit.

Timelines depend on severity and maintainer availability. Please do not disclose details publicly until a fix is available and users have had a reasonable chance to upgrade.

## Security-sensitive areas

Reports are especially useful around:

- Dashboard authentication and token handling.
- Public tunnel exposure.
- File browser and glob/read endpoints.
- Settings secrets redaction and config file permissions.
- Web Push endpoints and SSRF risk.
- Telegram callback handling.
- Service worker caching of authenticated API responses.
- Multi-instance primary/passive behavior.
