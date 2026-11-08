# Site Quality Guardian

Independent, browser-based, self-improving quality audit agent for *public* websites. The first site profile is [OV Berlin](https://www.ov-berlin.de). The target repository, server credentials, source code and database are **never required**.

The agent conducts repeatable Playwright journeys and accessibility scans, then (in intelligent mode) asks Claude Code to propose new safe actions using only a constrained JSON schema. Claude does not receive shell access. It remembers coverage, URLs, recurrent defects, and action history on a separate `guardian-state` branch. It produces a public static report with evidence and trace artifacts.

## Start today from a Mac

**Use a personal GitHub account.** If the Mac is employer-managed, do not store personal Claude/GitHub tokens there unless company policy permits. You can do the same setup in personal GitHub Codespaces.

1. Download and extract the project ZIP, then open Terminal in `site-quality-guardian`.
2. Install GitHub CLI if needed: `brew install gh`; authenticate: `gh auth login`.
3. Publish using `./scripts/publish.sh`. This creates a **public repository** under your GitHub account. If Git author name/email are not configured, Git will tell you how to set them.
4. Get the subscription token using the official Claude Code CLI (`claude setup-token`, after Claude is installed and authenticated using your own Claude Pro account). If missing, install Claude Code using the official installer documented at https://code.claude.com/docs/en/quickstart or use a personal cloud development environment. Set GitHub repo **Settings → Secrets and variables → Actions → New repository secret**: name `CLAUDE_CODE_OAUTH_TOKEN`. Paste the token only into that secret. Never put it in chat, `.env`, commits or workflow text.
5. GitHub repo **Settings → Pages → Build and deployment → Source → GitHub Actions**.
6. Go to **Actions → Audit external website → Run workflow**. Choose **smoke** for the first run. After it passes, run again with **intelligent**.
7. Open the job's **Artifacts** for full screenshot/trace evidence and the repo's **Pages** link for the latest mobile-friendly dashboard.

### Without the Mac

Create a new public GitHub repo, open a personal GitHub Codespace, upload/extract the ZIP, then run `git init -b main; git add .; git commit -m init; git remote add origin <YOUR-REPO-URL>; git push -u origin main`. Generate a Claude token in a terminal available to your personal account and set it as a repository secret. Do not put it into the Codespace source files.

## Commands

```sh
npm install
npx playwright install chromium
npm test
npm run audit -- --mode smoke --config sites/ov-berlin.json
npm run audit -- --mode intelligent --config sites/ov-berlin.json
```

You need the Claude Code CLI installed/authenticated for intelligent mode; if unavailable, the run still produces browser evidence and reports the limitation.

## Architecture

- `src/runner.mjs`: safe browser execution and risk-based test journeys
- `src/browser.mjs`: discovery of visible controls and execution of allowlisted actions
- `src/security.mjs`: strict origin policy and prohibited interactions
- `src/claude.mjs`: structured planning + UX analysis through Claude Code (`--safe-mode --tools ""`)
- `src/memory.mjs`: persistent coverage / defect recurrence memory
- `src/report.mjs`: Markdown, JSON, HTML, screenshots and Playwright trace output
- `sites/ov-berlin.json`: editable, source-independent site config
- `.github/workflows/audit.yml`: automatic daily smoke testing plus weekly AI exploration

## What is actually verified?

**Deterministic checks:** reachable pages, HTTP response, selected filters/views/search/navigation, viewport overflow, failed image loads, uncaught JavaScript exceptions, WCAG automated axe-core findings, and obviously past-dated “Next” showtime headings (Berlin local time). Interaction failures are marked as failed/skipped, not automatically declared site bugs.

**AI mode:** chooses additional safe actions based on the site inventory and persistent memory and proposes UX hypotheses anchored to recorded action IDs. Suggestions are explicitly *not confirmed defects*.

**Not yet independently verified:** individual cinema showtime truth against authoritative cinema websites; booking destination parity for each individual session; exhaustive usability coverage; visual screenshot interpretation. The report explicitly labels showtime source accuracy `NOT_VERIFIED`. These require a cinema-source adapter or independent verification strategy, not simply comparing two parts of the same website.

## Cost and policy

Standard GitHub-hosted runners are free in public repositories. Do not use paid large runners. Claude Pro/Max OAuth use is subject to the subscription's rate and usage limits. Public Pages and artifacts can be visible to other people—**do not test authenticated, private or personally identifying user flows**. Keep runs low frequency and rate-limited. Actions schedule may be disabled after 60 days of inactivity in public repos.

## Security

The target profile controls allowed HTTPS hosts and an explicit allowlist of buttons, views and detail-path prefixes; the executor rejects actions outside those lists, including tickets, signups, watchlist edits and forms. Claude sees untrusted text only as evidence; it is restricted to JSON plans and cannot run shell commands, edit source or read secrets. The workflow runs only on manually dispatched or scheduled events, not untrusted external pull requests. Each audit publishes only browser-observable public content and metadata.

**Important:** This is a practical initial release, not a guarantee that all possible UX or data errors will be discovered. Use testing reports as evidence; investigate any hypothesis or source mismatch before fixing production.
