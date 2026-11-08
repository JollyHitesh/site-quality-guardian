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

You need the Claude Code CLI installed/authenticated for intelligent mode; if unavailable, the run still produces browser evidence and reports the limitation. `--out` and `--memory` choose where results and learning state are written.

## Running on GitHub Actions

- `src/runner.mjs`: audit pipeline per device, mobile first
- `src/config.mjs`: site config validation, device profiles, per-device overrides
- `src/browser.mjs`: discovery of visible controls and execution of allowlisted actions
- `src/checks.mjs`: mobile and usability measurements, and the rules that judge them
- `src/perf.mjs`: throttled phone performance (LCP, CLS, TBT, FCP, TTFB)
- `src/security.mjs`: strict origin policy and prohibited interactions
- `src/claude.mjs`: structured planning and screenshot review through Claude Code with all tools disabled
- `src/memory.mjs`: persistent coverage and defect recurrence memory
- `src/report.mjs`: finding merge, Markdown, JSON and HTML output
- `sites/ov-berlin.json`: editable, source-independent site config
- `.github/workflows/audit.yml`: daily smoke testing plus weekly AI exploration

## Adding another website

Copy `sites/ov-berlin.json` and change the URL and hosts. The order of `devices` sets priority: the first gets 60% of the budget, AI exploration and the performance pass. Available devices are `mobile`, `mobile-small` (320px), `mobile-android`, `mobile-webkit` (Safari engine) and `desktop`.

| Setting | Purpose |
| --- | --- |
| `filters`, `views`, `safeButtons` | Exact button names the audit may press |
| `deviceOverrides` | Different button names per device or per family (`mobile`) |
| `revealButtons`, `revealCloseButtons` | Buttons that open and close drawers holding those controls |
| `detailPathPrefixes` | Paths the audit may open by tapping a link |
| `excludePaths` | Paths never visited, such as outbound booking redirects |
| `primaryActionPattern` | Regex marking the main call-to-action links |
| `checks.nextScreening` | Enables the cinema-specific "Next" showtime check |

Controls that are not found are listed in the report, so a redesign shows up as a coverage gap and not as a silent pass.

The workflow runs a daily smoke audit and a weekly intelligent audit. Full evidence (screenshots, traces) is attached to each job's **Artifacts**; the latest report is served on the repository's Pages site.

**Every run, on every device:** HTTP status of pages and first-party requests, blank and soft-error pages, uncaught JavaScript and console errors, content blocked by CSP, sideways overflow, broken images, invalid call-to-action links, WCAG automated axe-core findings on one page of each type, and whether each filter, view and search actually changed the page.

**On phones:** touch target size against WCAG 2.5.8 and the 44px guideline, form fields that make iPhones zoom, unreadably small text, oversized images, how much of the screen sticky bars cover, and landscape layout. Layout findings include a screenshot with the affected elements outlined.

**On the first device:** internal link checks, and performance measured with an empty cache on Slow 4G with a 4x CPU slowdown. These are lab numbers and real visitors will differ.

**AI mode:** chooses additional safe actions based on the site inventory and persistent memory, then reviews the screenshots for problems automated checks cannot see, such as confusing hierarchy or labels. Suggestions are explicitly *not confirmed defects*.

Severities: **P0** site down or blank (turns the GitHub run red), **P1** blocks a core task, **P2** hurts usability, **P3** polish. A finding marked "Likely" needs a quick manual look.

**Not independently verified:** individual cinema showtime truth against authoritative cinema websites; booking destination parity for each individual session; exhaustive usability coverage. The report labels showtime source accuracy `NOT_VERIFIED`. Those need a cinema-source adapter, not a comparison between two parts of the same website.

Anything not explicitly allowed is blocked by the executor.

**Only audit sites you own or have permission to test.** Keep runs low frequency and rate limited.

## What is verified, and what is not

The target profile controls allowed HTTPS hosts and an explicit allowlist of buttons, views and detail-path prefixes; the executor rejects actions outside those lists, including tickets, signups, watchlist edits and forms, in English and German. The only consent choice the audit ever makes is to refuse optional tracking, and links opening new tabs are closed unvisited. Claude sees untrusted text only as evidence; it is restricted to JSON plans and cannot run shell commands, edit source or read secrets. The workflow runs only on manually dispatched or scheduled events, not untrusted external pull requests. Each audit publishes only browser-observable public content and metadata.

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
