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
| Evaluates UX | Scores journeys, visual design and keyboard use, and keeps measured facts apart from expert judgement |

AI visitor journeys end as **SUCCESS**, **FAILURE** or **INCOMPLETE**. Success requires a condition, fixed before the journey began, to be true on the final page, and it must not have been true at the start. Claude's own opinion is never the verdict. Exploring a site never counts as a completed journey.

Each finding is labelled **NEW**, **RECURRING**, **REGRESSED**, **FLAKY** or **TRANSIENT**. A finding only counts as resolved after two runs that actually re-checked the same place.

Modes: **smoke** runs every check except AI. **intelligent** adds Claude and runs only when started by hand. **ux** runs the [UX Research & Design Auditor](docs/UX-AUDIT.md), also only when started by hand. If Claude is unavailable the run still completes and says so.

Scheduled smoke audits are off until you set the repository variable `GUARDIAN_SCHEDULED_SMOKE` to `true`. This switch has no effect on Claude: scheduled runs are always smoke.

## Safety

The agent is read-only by construction, not by good intentions.

- **Network guard.** Every request from every page passes through a guard. Writes are aborted before they leave the browser, and so is navigation off the audited site. A site can declare a read-only POST only with an anchored pattern for its exact body.
- **Control policy.** It never presses anything that looks like buying, booking, signing up, logging in, contacting or saving, in English or German, and rechecks the element at click time.
- **Consent.** It only ever refuses optional tracking. Analytics requests are blocked, so audits do not distort the site's numbers.
- **robots.txt** is respected, and the browser identifies itself as `SiteQualityGuardian`.
- **Sponsored links.** Sponsored `/go/` redirects are never requested. Booking destinations are validated from the `offers` data the site publishes.
- **Private data.** The browser is anonymous, and a site file cannot supply credentials or sessions. Text sent to Claude and everything published is redacted. Traces are off unless you pass `--trace` locally, and CI blocks publication if a final scan finds a secret or a trace file.
- **Prompt injection.** Claude runs with no tools, in an empty directory, and only with the variables it needs. Page text is fenced as untrusted, and every action Claude proposes is re-validated. Text from Claude is bounded and stripped of links before it reaches the report or memory.

**Only audit sites you own or have permission to test.** Do not point it at private, authenticated or personal flows: the dashboard and artifacts can be public.

Sites behind bot protection may refuse GitHub's network. The agent never disguises itself to get past this: it reports the run as `BLOCKED_BY_SITE_PROTECTION`, withholds the failures the block caused, and learns nothing from it. If you run the site, allow requests whose user agent contains `SiteQualityGuardian`.

## Deployment

You need a GitHub account, and Claude Pro or better for intelligent mode.

1. Merge the changes to `main` and push to a **public** repository, which is what makes standard runners free.
2. On your own machine, run `claude setup-token`. Add the result under **Settings → Secrets and variables → Actions** as `CLAUDE_CODE_OAUTH_TOKEN`. Do not add `ANTHROPIC_API_KEY`.
3. In **Settings → Pages**, set the source to **GitHub Actions**.
4. In **Actions → Audit external website → Run workflow**, choose **smoke**. When that passes, run **intelligent**.
5. Open the Pages URL on your iPad. Add it to the home screen for one-tap access.
6. To schedule smoke audits, add the repository variable `GUARDIAN_SCHEDULED_SMOKE` with the value `true`.

GitHub pauses schedules after 60 days without repository activity, and a one-click re-enable appears on the Actions page. The setup token lasts one year.

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

## Commands

```sh
npm ci --ignore-scripts
npx playwright install chromium webkit
npm test
npm run audit -- --mode smoke --site ov-berlin
npm run audit -- --mode intelligent --site ov-berlin
npm run audit -- --mode ux --site ov-berlin
```

If a private registry on your machine lacks these packages, add `--registry=https://registry.npmjs.org/` to the install. Local learning state goes in `memory/`, and reports in `out/`.

## Cost and limits

- **GitHub.** Standard runners are free in public repositories. The audit uses only those.
- **Claude.** Calls use your subscription and count toward its usage limits. A run is capped by `ai.maxCalls` (12 by default), and when the limit is reached the audit finishes without AI. Anthropic describes Pro limits as assuming ordinary individual use, so keep intelligent runs infrequent.
- **Models.** Sonnet is tried first, then Haiku. The account's default model may require extra credits, so it is never relied on.
- **The audited site.** Requests are rate limited and the sampling is small.

## Further reading

- [UX Research & Design Auditor](docs/UX-AUDIT.md)
- [docs/AUDIT.md](docs/AUDIT.md): findings from the engineering audit, what is verified, and what remains future work.

MIT licensed. Reports are evidence to investigate, not a guarantee that every defect was found.
