# Engineering audit

Written for anyone deciding how far to trust this agent. It records what was wrong with the first version, what changed, and what remains unproven.

## Problems found in the first version

Severity reflects impact on the stated product goals. Every item below was fixed unless marked otherwise.

| Severity | Problem | Evidence |
| --- | --- | --- |
| Critical | AI mode could not run on a Pro account | With no `--model`, the live CLI returned `credits_required` |
| Critical | Accessibility scans failed on every page | The handler that closed popups also closed the helper tab that axe opens |
| Critical | Showtime accuracy was untested | Only a regex over the "Next:" label existed |
| Critical | Not autonomous | Claude could only choose from hand-written button names |
| High | No read-only guarantee | Safety relied on labels. Links opening new tabs fired before being closed |
| High | Workflow over-privileged | Secrets and write scopes covered the whole job, including `npm install` with no lockfile |
| High | An API key silently overrode the subscription | Print mode always prefers `ANTHROPIC_API_KEY` |
| High | Failed runs corrupted the baseline | Partial runs replaced `lastFindings`, and `candidateRegressions` was never written |
| High | One transient failure was a confirmed defect | No retries and no history of intermittent results |
| High | Timed-out runs published nothing | Publishing required `success()` |
| High | Memory could carry injected text forward | Page-derived strings went back into prompts without bounds |
| Medium | Single hard-coded site, outdated actions, side effects on import | Workflow and `runner.mjs` |
| Medium | Denied words matched innocent ones | `book` matched "Facebook" |
| Medium | Findings changed identity between runs | Ids inside titles altered the fingerprint |

Unit tests passed throughout: 29 of 29 before any of this was fixed.

## How the agent decides now

Discovery, state modelling, invariants, re-testing and memory all work without Claude. Claude adds three things: visitor goals, steering towards them, and judgment on screenshots. It is one process with one budget, not a multi-agent system, because nothing here showed that more agents would find more.

## Validation status

Run the checks yourself before relying on them. Results as of the final run are in the delivery notes.

Automated tests use a fixture site with planted defects and traps. They assert that writes, purchases, popups, robots-disallowed pages and excluded paths never reach the server, including when Claude requests them.

**Not executed here:** the workflows have not run on GitHub, because publishing was not authorized. `actionlint` was not run either. `tests/workflow.test.mjs` checks permissions, pinning and secret scope, but it does not replace a linter or a real run.

To lint the workflows locally:

```sh
brew install actionlint && actionlint
```

## What is implemented, and what is not

| Area | Implemented | Future work |
| --- | --- | --- |
| Discovery | Controls, drawers, links, search and selects found at runtime | Shadow DOM, canvas and map interactions |
| Site model | States and transitions, persisted baselines | Visual diagrams and path mining |
| Filter testing | Order, reload, empty states, declared meanings | Three-way combinations and date boundaries |
| Showtimes | Structured data against page and clock. Source pages compared by text. Sources ranked by usefulness | Per-cinema adapters to raise match rates |
| Booking links | Inspected on the page, never followed | Sampling redirects, once you decide it is acceptable (see below) |
| Visual review | Claude reviews screenshots | Pixel baselines |
| Regressions | Same-run retry, cross-run lifecycle, baseline anomalies | Statistical flake modelling |
| Dashboard | iPad-friendly and multi-site with history | Trend charts |

### Open decisions for the site owner

- **Booking links.** Links run through `/go/...` redirects marked as sponsored, and following them could count as clicks. They are not followed, so the booking destination stays `NOT_VERIFIED`. Following them is not implemented, and would need your decision first.
- **AI training signal.** The site's `robots.txt` sets `ai-train=no`. Screenshots are sent to Claude in intelligent mode. If you audit a site you do not own, check your Claude privacy settings so this content is not used for training, or use smoke mode.
- **Source coverage.** Many cinema sites return 403, load listings with JavaScript or POST, or list only part of the programme. These stay `UNAVAILABLE` or inconclusive. Absence never counts as a mismatch.
