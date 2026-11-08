# Site Quality Guardian

An independent, autonomous quality agent for public websites. It drives real browsers, finds out for itself what a site can do, tests it like a demanding visitor, remembers what it learned, and publishes an evidence-backed dashboard you can read on an iPad.

It never needs the audited site's source code, database or credentials. The first configured site is [OV Berlin](https://www.ov-berlin.de/).

## What it does

| Capability | How |
| --- | --- |
| Discovers functionality | Explores the controls it finds, with no list of expected buttons |
| Models the site | Records states and the transitions between them |
| Finds defects without scripts | Compares the site with itself: filter order, reload, empty results, and its own history |
| Checks showtimes | Compares structured data with the page, the clock, and each cinema's own website |
| Reasons about usability | Claude proposes visitor goals, steers towards them and reviews screenshots |
| Separates flukes from defects | Re-tests failures, then tracks each one across runs |
| Learns | Prioritises what is untested, what is failing, and which sources give answers |

Each finding is labelled **NEW**, **RECURRING**, **REGRESSED**, **FLAKY** or **TRANSIENT**. A finding only counts as resolved after two runs that actually re-checked the same place.

Modes: **smoke** runs every check except AI, daily. **intelligent** adds Claude, weekly. If Claude is unavailable the run still completes and says so.

## Safety

The agent is read-only by construction, not by good intentions.

- **Network guard.** Every request from every page passes through a guard. Writes are aborted before they leave the browser, and so is navigation off the audited site. A site can declare a read-only POST only with an anchored pattern for its exact body.
- **Control policy.** It never presses anything that looks like buying, booking, signing up, logging in, contacting or saving, in English or German, and rechecks the element at click time.
- **Consent.** It only ever refuses optional tracking. Analytics requests are blocked, so audits do not distort the site's numbers.
- **robots.txt** is respected, and the browser identifies itself as `SiteQualityGuardian`.
- **Prompt injection.** Claude runs with no tools, in an empty directory, and only with the variables it needs. Page text is fenced as untrusted, and every action Claude proposes is re-validated. Text from Claude is bounded and stripped of links before it reaches the report or memory.

Do not point it at private, authenticated or personal flows: the dashboard and artifacts can be public.

## Deployment

You need a GitHub account, and Claude Pro or better for intelligent mode.

1. Review the changes and merge them to `main`.
2. Publish the repository with `./scripts/publish.sh`. This creates a **public** repository, which is what makes standard runners free.
3. On your own machine, run `claude setup-token`. Add the result under **Settings → Secrets and variables → Actions** as `CLAUDE_CODE_OAUTH_TOKEN`. Do not add `ANTHROPIC_API_KEY`.
4. In **Settings → Pages**, set the source to **GitHub Actions**.
5. In **Actions → Audit external website → Run workflow**, choose **smoke**. When that passes, run **intelligent**.
6. Open the Pages URL on your iPad. Add it to the home screen for one-tap access.

Scheduled runs then happen on their own. GitHub pauses schedules after 60 days without repository activity, and a one-click re-enable appears on the Actions page. The setup token lasts one year.

## Adding a website

Any public site works with no configuration:

```sh
node src/cli.mjs --mode smoke --url https://example.com/
```

For scheduled audits, add a file to `sites/`. Only `name`, `url` and `allowedHosts` are required.

| Setting | Purpose |
| --- | --- |
| `purpose`, `priorities`, `audiences` | Tell Claude what the site is for and what matters most |
| `devices` | First device gets the most budget. Options: `mobile`, `mobile-small`, `mobile-android`, `mobile-webkit`, `tablet`, `desktop` |
| `filters`, `views`, `safeButtons` | Names to try first. These are hints, not limits |
| `filterSemantics` | Optional rules for what a filter's results must contain |
| `excludePaths`, `denyLabels` | Paths and labels never touched |
| `readOnly.allowPostBodies` | Exact POST bodies that only read data |
| `showtimes` | Enable event-data and source checks |
| `ai` | Models, call budget, and goals per run |

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
npm ci --ignore-scripts
npx playwright install chromium webkit
npm test
npm run audit -- --mode smoke --site ov-berlin
npm run audit -- --mode intelligent --site ov-berlin
```

If a private registry on your machine lacks these packages, add `--registry=https://registry.npmjs.org/` to the install. Local learning state goes in `memory/`, and reports in `out/`.

## Cost and limits

- **GitHub.** Standard runners are free in public repositories. The audit uses only those.
- **Claude.** Calls use your subscription and count toward its usage limits. A run is capped by `ai.maxCalls` (12 by default), and when the limit is reached the audit finishes without AI. Anthropic describes Pro limits as assuming ordinary individual use, so keep intelligent runs infrequent.
- **Models.** Sonnet is tried first, then Haiku. The account's default model may require extra credits, so it is never relied on.
- **The audited site.** Requests are rate limited and the sampling is small.

## Further reading

- [docs/AUDIT.md](docs/AUDIT.md): findings from the engineering audit, what is verified, and what remains future work.

MIT licensed. Reports are evidence to investigate, not a guarantee that every defect was found.
