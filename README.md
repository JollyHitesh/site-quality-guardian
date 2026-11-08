# Site Quality Guardian

A browser-based quality audit agent for public websites. It runs repeatable Playwright journeys and accessibility scans against a live site, optionally uses Claude to explore further, remembers what it has covered across runs, and publishes an evidence-backed report.

It works purely from the outside. No access to the target site's source code, database, servers or credentials is needed.

The repository ships with one site profile, [OV Berlin](https://www.ov-berlin.de), which serves as a reference configuration.

## Features

- **Deterministic audits:** page reachability, HTTP status, navigation, filters, views and search, viewport overflow, broken images, uncaught JavaScript exceptions, and automated WCAG checks via axe-core.
- **AI-assisted exploration (optional):** Claude proposes additional actions and UX hypotheses through a constrained JSON schema. It has no shell, file or secret access.
- **Persistent memory:** coverage, discovered URLs, recurring defects and action history are stored on a separate `guardian-state` branch, so each run builds on the last.
- **Evidence-first reporting:** Markdown, JSON and HTML reports with screenshots and Playwright traces, published to GitHub Pages.
- **Strict safety model:** an origin allowlist and an action allowlist prevent the agent from submitting forms, buying tickets, signing up or changing any state on the target site.

## How it works

1. The runner loads a site profile from `sites/<name>.json`.
2. Playwright executes the profile's journeys and records every action.
3. In `intelligent` mode, Claude reviews the discovered controls and the stored memory, then returns a JSON plan of additional allowlisted actions. The executor rejects anything outside the profile's allowlist.
4. Results are merged into persistent memory and rendered into a report.

| Module | Responsibility |
| --- | --- |
| `src/runner.mjs` | Orchestrates runs and risk-based journeys |
| `src/browser.mjs` | Discovers visible controls and executes allowlisted actions |
| `src/security.mjs` | Origin policy and prohibited interactions |
| `src/claude.mjs` | Structured planning and UX analysis via Claude Code (`--safe-mode --tools ""`) |
| `src/memory.mjs` | Coverage and defect recurrence memory |
| `src/report.mjs` | Report, screenshot and trace output |
| `sites/*.json` | Site profiles |
| `.github/workflows/audit.yml` | Scheduled and manual audit runs |

## Quick start (local)

Requirements: Node.js and npm. Intelligent mode additionally requires the [Claude Code CLI](https://code.claude.com/docs/en/quickstart), installed and authenticated.

```sh
npm install
npx playwright install chromium
npm test

# Deterministic checks only
npm run audit -- --mode smoke --config sites/ov-berlin.json

# Deterministic checks plus AI-assisted exploration
npm run audit -- --mode intelligent --config sites/ov-berlin.json
```

If Claude Code is unavailable, an intelligent run still produces browser evidence and records the limitation in the report.

## Running on GitHub Actions

1. Fork this repository.
2. Generate a Claude Code OAuth token with `claude setup-token`.
3. Add it as a repository secret: **Settings > Secrets and variables > Actions > New repository secret**, named `CLAUDE_CODE_OAUTH_TOKEN`. Store it only as a secret, never in code, `.env` files or workflow definitions.
4. Enable Pages: **Settings > Pages > Build and deployment > Source > GitHub Actions**.
5. Run **Actions > Audit external website > Run workflow**. Start with `smoke`, then try `intelligent` once smoke passes.

The workflow runs a daily smoke audit and a weekly intelligent audit. Full evidence (screenshots, traces) is attached to each job's **Artifacts**; the latest report is served on the repository's Pages site.

## Adding a site

Copy `sites/ov-berlin.json` and adjust it for your site. A profile defines:

- the allowed HTTPS hosts,
- the buttons, views and detail-path prefixes the agent may interact with,
- the journeys to run.

Anything not explicitly allowed is blocked by the executor.

**Only audit sites you own or have permission to test.** Keep runs low frequency and rate limited.

## What is verified, and what is not

**Verified deterministically:** reachability, HTTP responses, selected filters, views, search and navigation, viewport overflow, failed image loads, uncaught JavaScript exceptions, axe-core WCAG findings, and site-specific checks defined in the profile (for OV Berlin, "Next" showtime headings that are already in the past, in Berlin local time). An interaction that fails is reported as failed or skipped, not automatically as a site defect.

**AI suggestions:** hypotheses are anchored to recorded action IDs and are explicitly labelled as unconfirmed.

**Not verified:** correctness of site data against its upstream sources (for OV Berlin, showtimes against the cinemas' own websites, and booking link parity per session), exhaustive usability coverage, and visual interpretation of screenshots. Source accuracy is reported as `NOT_VERIFIED`. Closing this gap requires a source adapter, not comparing two parts of the same site.

## Security model

- The executor enforces the profile's host and action allowlists and blocks tickets, signups, watchlist edits and form submission.
- Claude receives page content only as untrusted evidence. It can return JSON plans and nothing else: no shell, no source edits, no secrets.
- The workflow runs only on schedule or manual dispatch, never on pull requests from forks.
- Reports contain only publicly observable content and metadata.

## Costs and limits

- Standard GitHub-hosted runners are free for public repositories. The workflow does not use larger paid runners.
- Claude Code usage via a Pro or Max subscription is subject to that plan's usage limits.
- GitHub may disable scheduled workflows in public repositories after 60 days of inactivity.
- Pages sites and workflow artifacts in a public repository are publicly visible. Do not point the agent at authenticated, private or personally identifying flows.

## Disclaimer

Site Quality Guardian surfaces evidence; it does not guarantee that every UX or data issue will be found. Investigate any reported defect or hypothesis before acting on it in production.
