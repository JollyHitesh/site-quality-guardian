# UX Research & Design Auditor

Run it with `--mode ux`, or choose `ux` when starting the workflow by hand. It is a separate mode, so smoke and intelligent audits behave exactly as before.

It answers four questions for a website owner: what visitors are trying to do, where the design makes that harder, what should change, and how to tell whether the change worked.

## Three kinds of result

| Class | Who decides | What it means |
| --- | --- | --- |
| Measured defects | A published rule, in a real browser | Reproducible fact |
| Expert design hypotheses | Claude, from cited screenshots and actions, then cross-checked | Well-supported hypothesis |
| Ideas needing user research | Claude, or a claim that was weak on cross-check | An idea to test with people |

Automation timings describe the run. They are never presented as human task times. The agent does not report visitor feelings, satisfaction or cognitive states. A claim that asserts them is discarded.

## What runs

1. **Pages on every device.** The same pages on phone, tablet and desktop, with layout measurements and comparable screenshots.
2. **Visitor journeys.** Declared under `ux.journeys`. The planner can use only controls a visitor can see, so hidden controls cost real steps. A screenshot is taken at each stage.
3. **Recovery probes.** A search that cannot match anything, and one read of an address that cannot exist.
4. **Keyboard tests.** A real tab walk, operation of menus and filters with Enter and Space, dialog focus management, and focus recovery after updates.
5. **Accessibility tree.** Landmarks, headings, exposed control state and live regions, read through Chromium. axe-core still runs on every page.
6. **Expert review.** Five independent groups of criteria, each with its own screenshots.

Automated accessibility checks cannot establish WCAG conformance, and every report says so.

## Journey measures

Actions, automation time, response after an action, unique states, returns to an earlier state, repeated actions, unnecessary navigation, dead ends and whether a way out existed, results in or out of the viewport, actions with no visible change, pages that only lead onward, and the shortest route known from the site model.

A journey counts as reached only if a condition fixed in advance is true on the final page.

## Evidence rules for expert claims

Software removes a claim that:

- cites no screenshot Claude was shown and no real action
- asserts how visitors feel, or gives invented human numbers
- quotes text that is on no audited page
- lacks a problem, recommendation or validation method
- is contradicted by a separate sceptical reading

Root causes in expert claims are always labelled hypotheses.

## Severity and confidence

| Impact | Other pages | Core task pages |
| --- | --- | --- |
| Blocks a task | P1 | P1, or P0 if measured on every device |
| Major difficulty | P2 | P1 |
| Minor friction | P3 | P2 |
| Polish | P3 | P3 |

Low confidence lowers a rating by one level. Software sets expert confidence from the cross-check and the amount of independent evidence. Repetition across runs never raises it. Only an owner-recorded research result does.

## Scorecard

Five categories: discoverability, task efficiency, clarity, visual design and accessibility. **A score comes only from measured criteria.** Expert assessments appear beside it as pass, concern and fail counts, and cannot move it.

A pass earns the criterion's full weight, a concern earns half and a fail earns none. The score is the points earned divided by the points assessed. No number appears unless at least half of the category's measured weight was assessed and at least two measured criteria were assessed. A criterion with no screenshot or action to cite is left out. The report shows each criterion's points, reason and evidence, and every reference links to the evidence index.

Trends compare only runs with the same rubric version and the same journeys. Thresholds and weights are set per site under `ux.thresholds` and `ux.scorecard.weights`. Changing them changes the rubric version.

## Memory

- A measured problem is resolved after two runs that repeated the same measurement and no longer found it.
- An expert hypothesis is retired after two runs that assessed the same criterion on the same page type without raising it.
- A resolved hypothesis returns only if the page's structure changed or a measurement now backs it.
- Routes that worked are replayed, which costs no Claude calls and keeps runs comparable. A route that stops working is reported.
- Pages from earlier runs are kept so scores stay comparable. One slot rotates, going first to pages never reviewed, then to pages with open problems. The least-assessed criteria are reviewed first when calls are limited. A trend says so when the pages reviewed differ.

Record what your own research found in the site file. The key is the issue id from the report.

```json
"ux": {"decisions": {"ux-expert-1a2b3c4d5e": {"decision": "validated", "note": "Confirmed in a tree test"}}}
```

Decisions are `validated`, `needs-research`, `rejected`, `accepted-risk` and `fixed`. The last three hide the issue until the page's structure changes.

## Claude usage

Every call counts against a hard budget. Set it for one run with `--claude-budget N` or the workflow's `claude_budget` input, or for all hosted runs with the repository variable `GUARDIAN_CLAUDE_BUDGET`. Hosted runs default to 12. Local runs default to `ux.maxCalls`, which is 24.

- Routes that worked are replayed at no cost.
- Up to half the budget, and at most `ux.reviewCalls`, is kept for expert review. Unused planning calls go to the review.
- When calls are short, the least-assessed criteria are reviewed first, so successive runs cover everything.
- One call is kept for the cross-check whenever at least two remain.

If the budget cuts anything short, the report opens with exactly what was skipped, the run is marked as having limitations, and the workflow raises a warning and writes a job summary. Measured results are not affected. With a budget of 0, or without Claude, the measured half of the report still completes.

## Validation

`tests/fixtures/ux-sites.mjs` serves a site with planted anti-patterns and a well-built control site. The integration test requires every planted problem to be found with evidence, and requires zero measured problems on the control site.
