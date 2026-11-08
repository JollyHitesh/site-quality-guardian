# OV Berlin: expert UX report

2026-11-08T19:20:31.090Z. Devices: mobile, tablet, desktop.

> Measured results and expert judgements are labelled separately. Automated accessibility checks do not establish WCAG conformance.

## Scorecard

- **Discoverability:** 90
- **Task efficiency:** 91
- **Clarity:** 81
- **Visual design:** 52
- **Accessibility:** 57

## Visitor journeys

- **Reached** on mobile: Find films with English audio. 4 actions, 0 returns, 0 dead ends.
- **Reached** on mobile: Open a film and find where to get tickets. 1 actions, 0 returns, 0 dead ends.
- **Reached** on mobile: Open a cinema's page to see what it shows. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Find films with English audio. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Open a film and find where to get tickets. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Open a cinema's page to see what it shows. 2 actions, 0 returns, 0 dead ends.

## Detected by measurement

A rule measured these in the browser. The result is reproducible.

### P1: Sticky bars cover over 30% of the screen on phones.

- **Who:** Visitor on a phone, trying to: See the content while scrolling
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** Sticky bars cover over 30% of the screen on phones.
- **Evidence:** Sticky bars cover over 30% of the screen on phones. Measured by the audit on mobile. (A001, S01)
- **Reproduce:** Open / on mobile; Check: Does the layout fit small screens and fingers?
- **Cause:** Several fixed or sticky bars stack up.
- **Recommendation:** Keep only the essentials sticky.
- **Alternative:** Hide the bar on downward scroll.
- **Expected benefit:** More content is visible.
- **Implementation:** Collapse filters into one compact bar.
- **Acceptance:** Sticky bars cover at most 30% of the screen
- **Validate:** Re-run the layout check on a phone profile.

### P1: Some controls are below 24px and crowded by neighbours.

- **Who:** Visitor on a phone, trying to: Press the intended control
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P1, high, multiple-page-types
- **Problem:** Some controls are below 24px and crowded by neighbours.
- **Evidence:** Some controls are below 24px and crowded by neighbours. Measured by the audit on mobile. (S37, A002, S01, S02)
- **Reproduce:** Open /movies/:slug on mobile; Check: Does the layout fit small screens and fingers?
- **Cause:** Hit areas match the visual size.
- **Recommendation:** Give these controls at least 24px, ideally 44px.
- **Alternative:** Add padding to enlarge the hit area without changing the visual size.
- **Expected benefit:** Fewer wrong taps.
- **Implementation:** Use padding or a pseudo-element to extend the hit area.
- **Acceptance:** No crowded target is under 24 by 24px
- **Validate:** Re-run the layout check on a phone profile.

### P1: Focused controls are covered by another element: View details for Staatsschutz, Add to watchlist, View details for Queens of the Dead, Add to watchlis

- **Who:** Keyboard-only visitor, trying to: Use every part of the site without a mouse
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** Focused controls are covered by another element: View details for Staatsschutz, Add to watchlist, View details for Queens of the Dead, Add to watchlist, View details for Iván & Hadoum, Add to watchlist, View details for Minotaurus, Add to watchlist.
- **Evidence:** Focused controls are covered by another element: View details for Staatsschutz, Add to watchlist, View details for Queens of the Dead, Add to watchlist, View details for Iván & Hadoum, Add to watchlist, View details for Minotaurus, Add to watchlist. Measured by the audit on desktop. (S28, A047)
- **Reproduce:** Open / on desktop; Check: Is keyboard focus visible and unobscured?
- **Likely cause (hypothesis):** A sticky bar likely overlaps content when the browser scrolls to the focused control.
- **Recommendation:** Keep focused controls clear of sticky bars.
- **Alternative:** Reduce or unstick the bar while the visitor moves through content.
- **Expected benefit:** The focused control stays visible.
- **Implementation:** Add scroll-padding-top equal to the sticky header height on the scrolling element.
- **Acceptance:** No focused control is hidden by a sticky element
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: Opening "Open navigation menu (narrow window)" leaves focus outside the panel.

- **Who:** Keyboard-only visitor, trying to: Use a menu or filter panel
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** Opening "Open navigation menu (narrow window)" leaves focus outside the panel.
- **Evidence:** Opening "Open navigation menu (narrow window)" leaves focus outside the panel. Measured by the audit on desktop. (S31, A055)
- **Reproduce:** Open / on desktop; Check: Do dialogs manage focus?
- **Likely cause (hypothesis):** The panel is shown without moving focus into it.
- **Recommendation:** Move focus into the panel when it opens.
- **Alternative:** Use the native dialog element with showModal.
- **Expected benefit:** The visitor starts where the new content is.
- **Implementation:** Call focus() on the panel heading or first control after opening.
- **Acceptance:** Focus is inside the panel after it opens
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: While "Open navigation menu (narrow window)" is open, 12 of 12 tab presses landed behind it.

- **Who:** Keyboard-only visitor, trying to: Use a menu or filter panel
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** While "Open navigation menu (narrow window)" is open, 12 of 12 tab presses landed behind it.
- **Evidence:** While "Open navigation menu (narrow window)" is open, 12 of 12 tab presses landed behind it. Measured by the audit on desktop. (S31, A055)
- **Reproduce:** Open / on desktop; Check: Do dialogs manage focus?
- **Likely cause (hypothesis):** Content behind the panel is still focusable.
- **Recommendation:** Keep focus inside the panel while it is open.
- **Alternative:** Set the inert attribute on the background.
- **Expected benefit:** Visitors do not operate controls they cannot see.
- **Implementation:** Use <dialog>.showModal(), or set inert on everything outside the panel.
- **Acceptance:** Tab cycles only through controls in the open panel
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: "Filters (narrow window)" opens an overlay that is not exposed as a dialog.

- **Who:** Visitor using a screen reader, trying to: Understand that a panel has opened
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** "Filters (narrow window)" opens an overlay that is not exposed as a dialog.
- **Evidence:** "Filters (narrow window)" opens an overlay that is not exposed as a dialog. Measured by the audit on desktop. (S32, A057)
- **Reproduce:** Open / on desktop; Check: Do dialogs manage focus?
- **Cause:** The overlay has no dialog role.
- **Recommendation:** Mark the panel as a named dialog.
- **Alternative:** Use the native dialog element.
- **Expected benefit:** Screen readers announce the panel and its name.
- **Implementation:** Add role="dialog", aria-modal="true" and aria-labelledby pointing to its heading.
- **Acceptance:** The accessibility tree shows a named dialog when it opens
- **Validate:** Check the accessibility tree in the agent, then test with VoiceOver or NVDA.

### P1: Opening "Filters (narrow window)" leaves focus outside the panel.

- **Who:** Keyboard-only visitor, trying to: Use a menu or filter panel
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** Opening "Filters (narrow window)" leaves focus outside the panel.
- **Evidence:** Opening "Filters (narrow window)" leaves focus outside the panel. Measured by the audit on desktop. (S32, A057)
- **Reproduce:** Open / on desktop; Check: Do dialogs manage focus?
- **Likely cause (hypothesis):** The panel is shown without moving focus into it.
- **Recommendation:** Move focus into the panel when it opens.
- **Alternative:** Use the native dialog element with showModal.
- **Expected benefit:** The visitor starts where the new content is.
- **Implementation:** Call focus() on the panel heading or first control after opening.
- **Acceptance:** Focus is inside the panel after it opens
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: While "Filters (narrow window)" is open, 2 of 12 tab presses landed behind it.

- **Who:** Keyboard-only visitor, trying to: Use a menu or filter panel
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** While "Filters (narrow window)" is open, 2 of 12 tab presses landed behind it.
- **Evidence:** While "Filters (narrow window)" is open, 2 of 12 tab presses landed behind it. Measured by the audit on desktop. (S32, A057)
- **Reproduce:** Open / on desktop; Check: Do dialogs manage focus?
- **Likely cause (hypothesis):** Content behind the panel is still focusable.
- **Recommendation:** Keep focus inside the panel while it is open.
- **Alternative:** Set the inert attribute on the background.
- **Expected benefit:** Visitors do not operate controls they cannot see.
- **Implementation:** Use <dialog>.showModal(), or set inert on everything outside the panel.
- **Acceptance:** Tab cycles only through controls in the open panel
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: After closing "Filters (narrow window)", focus does not return to the control that opened it.

- **Who:** Keyboard-only visitor, trying to: Return to the page after a menu
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** After closing "Filters (narrow window)", focus does not return to the control that opened it.
- **Evidence:** After closing "Filters (narrow window)", focus does not return to the control that opened it. Measured by the audit on desktop. (S32, A057)
- **Reproduce:** Open / on desktop; Check: Do dialogs manage focus?
- **Likely cause (hypothesis):** The opening control is not remembered when the panel closes.
- **Recommendation:** Return focus to the opening control.
- **Alternative:** Move focus to the updated content if the opener is gone.
- **Expected benefit:** The visitor continues from where they were.
- **Implementation:** Store document.activeElement on open and focus it on close.
- **Acceptance:** Focus returns to the opening control after closing
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: "English audio" changes appearance when active, but its state is not exposed to assistive technology.

- **Who:** Visitor using a screen reader, trying to: Know which filters are switched on
- **Principle:** WCAG: perceivable and robust semantics
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** "English audio" changes appearance when active, but its state is not exposed to assistive technology.
- **Evidence:** "English audio" changes appearance when active, but its state is not exposed to assistive technology. Measured by the audit on desktop. (S30, A049)
- **Reproduce:** Open / on desktop; Check: Are structure and control state exposed to assistive technology?
- **Cause:** The selected state exists only as styling.
- **Recommendation:** Expose the state with aria-pressed or an equivalent.
- **Alternative:** Use native checkboxes for filter choices.
- **Expected benefit:** Screen-reader visitors hear which options are on.
- **Implementation:** Add aria-pressed="true|false" to toggles and aria-expanded to disclosure buttons.
- **Acceptance:** The control exposes its current state in the accessibility tree
- **Validate:** Check the attribute in the agent, then test with a screen reader.

### P2: Find films with English audio: The successful path took 4 actions. The target is 2.

- **Who:** Tourist who needs films in English, trying to: Find films with English audio
- **Principle:** Flexibility and efficiency of use (Nielsen 7)
- **Severity, confidence, scope:** P2, low, core-page-type
- **Problem:** Find films with English audio: The successful path took 4 actions. The target is 2.
- **Evidence:** Find films with English audio: The successful path took 4 actions. The target is 2. Measured by the audit on mobile. (S07, S08, S09, S10, S11, A028)
- **Reproduce:** Open / on mobile as a new visitor; Activate "Try "English Sunday" or "OmU Mitte"…" (A028); Activate "Filters (1)" (A029); Activate "English" (A030); Activate "Done" (A031)
- **Likely cause (hypothesis):** Steps before the result may be redundant, or the shorter route may be hard to see.
- **Recommendation:** Remove the extra steps, or make the shortest route the obvious one.
- **Alternative:** Add a direct entry point for this task on the first screen.
- **Expected benefit:** Fewer actions are needed for a core task.
- **Implementation:** Compare the listed steps with the shorter route and promote it.
- **Acceptance:** The journey succeeds within its action target
- **Validate:** Re-run this journey and compare action counts. Run a task-based test to confirm the shorter route is found.

### P2: Main content starts at 1369px on a 1080px-tall screen, at 127% of the first screen height.

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: See what the page offers
- **Principle:** Visual hierarchy
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** Main content starts at 1369px on a 1080px-tall screen, at 127% of the first screen height.
- **Evidence:** Main content starts at 1369px on a 1080px-tall screen, at 127% of the first screen height. Measured by the audit on tablet, desktop. (S16, S20)
- **Reproduce:** Open / on tablet, desktop; Check: Does main content start in the first screen?
- **Likely cause (hypothesis):** Hero or promotional content likely precedes the main content.
- **Recommendation:** Shorten what comes before the content.
- **Alternative:** Move the promotional content below the first results.
- **Expected benefit:** Visitors see useful content sooner.
- **Implementation:** Reduce hero height at this viewport and limit stacked bars.
- **Acceptance:** Main content starts within the first screen on this device
- **Validate:** Re-run this check. Compare task success in an A/B test if traffic allows.

### P2: Most text on this page is 12px, below the 14px limit.

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: Read the content comfortably
- **Principle:** Visual craft: density, legibility, spacing and affordance
- **Severity, confidence, scope:** P2, high, multiple-page-types
- **Problem:** Most text on this page is 12px, below the 14px limit.
- **Evidence:** Most text on this page is 12px, below the 14px limit. Measured by the audit on mobile, tablet, desktop. (S02, S16, S17, S20, S21)
- **Reproduce:** Open /movies/:slug on mobile, tablet, desktop; Check: Are body size and line length readable?
- **Likely cause (hypothesis):** Typography values may have been set for a different viewport.
- **Recommendation:** Bring body size and line length within limits.
- **Alternative:** Add responsive typography steps.
- **Expected benefit:** Longer text is easier to read.
- **Implementation:** Use a body size of at least 14px, and set max-width near 70ch on text blocks.
- **Acceptance:** Body text is at least 14px; Median line length is at most 100 characters
- **Validate:** Re-run this check.

### P2: 3 button(s) have no fill, border, underline or icon, for example "More about this movie".

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: Tell what can be pressed
- **Principle:** Visual craft: density, legibility, spacing and affordance
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** 3 button(s) have no fill, border, underline or icon, for example "More about this movie".
- **Evidence:** 3 button(s) have no fill, border, underline or icon, for example "More about this movie". Measured by the audit on mobile, tablet, desktop. (S02, S17, S21)
- **Reproduce:** Open /movies/:slug on mobile, tablet, desktop; Check: Do buttons look operable?
- **Cause:** Styling resets may have removed the default button appearance.
- **Recommendation:** Give these buttons a visible boundary or marker.
- **Alternative:** Add an underline or chevron if a light look is required.
- **Expected benefit:** Actions are recognisable as actions.
- **Implementation:** Apply the design system button style or a text-button style with an underline.
- **Acceptance:** Each button has a fill, border, underline or icon
- **Validate:** Re-run this check. Use a first-click test if it remains a concern.

### P2: The first screen has 52 interactive controls. The limit for this device is 45.

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: Decide what to do first
- **Principle:** Cognitive load
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** The first screen has 52 interactive controls. The limit for this device is 45.
- **Evidence:** The first screen has 52 interactive controls. The limit for this device is 45. Measured by the audit on tablet, desktop. (S16, S20)
- **Reproduce:** Open / on tablet, desktop; Check: Is the first screen free of control overload?
- **Likely cause (hypothesis):** Secondary actions may compete with the main task.
- **Recommendation:** Reduce or group the controls in the first screen.
- **Alternative:** Use progressive disclosure for secondary controls.
- **Expected benefit:** Fewer competing choices on arrival.
- **Implementation:** Rank controls by use and move rarely used ones into a menu.
- **Acceptance:** The first screen is within the configured limit
- **Validate:** Re-run this check. Observe first-use behaviour to confirm the priority.

### P2: Main action links are under 44px tall on phones.

- **Who:** Visitor on a phone, trying to: Press the main action
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P2, high, multiple-page-types
- **Problem:** Main action links are under 44px tall on phones.
- **Evidence:** Main action links are under 44px tall on phones. Measured by the audit on mobile. (S33, A001, S01, S02)
- **Reproduce:** Open / on mobile; Check: Does the layout fit small screens and fingers?
- **Cause:** Hit areas match the text size.
- **Recommendation:** Make main actions at least 44px tall.
- **Alternative:** Make the whole card the target.
- **Expected benefit:** The main action is easy to press.
- **Implementation:** Add vertical padding and keep 8px between stacked links.
- **Acceptance:** Main actions are at least 44px tall
- **Validate:** Re-run the layout check on a phone profile.

### P2: Form fields under 16px make iPhones zoom in on focus.

- **Who:** Visitor on a phone, trying to: Use search without the page zooming
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P2, high, multiple-page-types
- **Problem:** Form fields under 16px make iPhones zoom in on focus.
- **Evidence:** Form fields under 16px make iPhones zoom in on focus. Measured by the audit on mobile. (S35, A001, S01, S02)
- **Reproduce:** Open / on mobile; Check: Does the layout fit small screens and fingers?
- **Cause:** The field font size is below 16px.
- **Recommendation:** Set field text to at least 16px.
- **Alternative:** Scale the visual size with a transform if smaller text is needed.
- **Expected benefit:** The page stays still when a field is focused.
- **Implementation:** Set font-size:16px on inputs for small viewports.
- **Acceptance:** All text inputs are at least 16px on phones
- **Validate:** Re-run the layout check on a phone profile.

### P2: axe-core rule "target-size": All touch targets must be 24px large, or leave sufficient space. 6 element(s) affected.

- **Who:** Visitor using a screen reader, trying to: Use the page with assistive technology
- **Principle:** WCAG: perceivable and robust semantics
- **Severity, confidence, scope:** P2, high, single-page-type
- **Problem:** axe-core rule "target-size": All touch targets must be 24px large, or leave sufficient space. 6 element(s) affected.
- **Evidence:** axe-core rule "target-size": All touch targets must be 24px large, or leave sufficient space. 6 element(s) affected. Measured by the audit on mobile, tablet, desktop. (A004, S04, S19, S23)
- **Reproduce:** Open /originalfassung-kino-berlin on mobile, tablet, desktop; Check: Did axe-core report violations?
- **Cause:** The cited elements fail this automated rule.
- **Recommendation:** Fix the listed elements according to the rule guidance.
- **Alternative:** Fix it once in the shared component, if these share one.
- **Expected benefit:** The page works better with assistive technology.
- **Implementation:** Rule guidance: https://dequeuniversity.com/rules/axe/4.14/target-size?application=playwright. Selectors: [[".py-2\\.5.border-zinc-800\\/60.last\\:border-0:nth-child(4) > .gap-3.items-center.flex > div > .hover\\:text-brand-400.font-medium[href$=\"other-mommy\"]"],[".py-2\\.5.border-zinc-800\\/60.last\\:b.
- **Acceptance:** axe-core no longer reports this rule on this page
- **Validate:** Re-run axe-core, then test by hand. Automated rules cover only part of WCAG.

### P2: axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 19 element(s) affected.

- **Who:** Visitor using a screen reader, trying to: Use the page with assistive technology
- **Principle:** WCAG: perceivable and robust semantics
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 19 element(s) affected.
- **Evidence:** axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 19 element(s) affected. Measured by the audit on tablet, desktop. (A034, S16, S20)
- **Reproduce:** Open / on tablet, desktop; Check: Did axe-core report violations?
- **Cause:** The cited elements fail this automated rule.
- **Recommendation:** Fix the listed elements according to the rule guidance.
- **Alternative:** Fix it once in the shared component, if these share one.
- **Expected benefit:** The page works better with assistive technology.
- **Implementation:** Rule guidance: https://dequeuniversity.com/rules/axe/4.14/label-content-name-mismatch?application=playwright. Selectors: [[".focus-visible\\:ring-2.focus-visible\\:ring-brand-400[href$=\"ein-talent-frs-morden\"]"],["a[aria-label=\"View details for Staatsschutz\"]"],[".focus-visible\\:ring-2.focus-visible\\:ring-brand-40.
- **Acceptance:** axe-core no longer reports this rule on this page
- **Validate:** Re-run axe-core, then test by hand. Automated rules cover only part of WCAG.

### P3: 17 different button styles appear on this page.

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: Recognise repeated actions
- **Principle:** Consistency and standards (Nielsen 4)
- **Severity, confidence, scope:** P3, high, multiple-page-types
- **Problem:** 17 different button styles appear on this page.
- **Evidence:** 17 different button styles appear on this page. Measured by the audit on mobile, tablet, desktop. (S02, S16, S17, S20, S21)
- **Reproduce:** Open /movies/:slug on mobile, tablet, desktop; Check: Is the button styling consistent?
- **Likely cause (hypothesis):** Styles may be defined per component.
- **Recommendation:** Consolidate buttons into a small set of variants.
- **Alternative:** Audit and remove the rarely used variants.
- **Expected benefit:** Actions look the same wherever they appear.
- **Implementation:** Define primary, secondary and text button variants as shared components.
- **Acceptance:** No page has more button styles than the configured limit
- **Validate:** Re-run this check.


## Expert judgement

A reviewer judged these from cited screenshots and actions, and a second reading checked each claim. Treat them as well-supported hypotheses.

### P2: Tablet and desktop movie pages put showtimes below a long details block

- **Who:** tourist seeking English audio, trying to: Find showtimes and the booking link for a film
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** On mobile a 'See 25 showtimes' button sits in the first view. On tablet and desktop there is no equivalent. Cast, links and tags come first, and the screening list begins at the bottom edge, with only a 'Next' row visible.
- **Evidence:** S02 shows a full-width CTA and a Next card. S17 and S21 show the description, tags, cast and details before 'Upcoming screenings (22)'. The mobile count is 25 and the tablet/desktop count is 22. (S02, S17, S21)
- **Reproduce:** Open a film page such as Ghost Song at tablet or desktop width; Look at the first view for showtimes; Compare with the mobile first view
- **Likely cause (hypothesis):** The desktop layout is a single column with the metadata block placed before the screenings, and it has no sticky CTA.
- **Recommendation:** Move the 'Upcoming screenings' list up on tablet and desktop. Put it in a right-hand column beside the description, or move cast and details below it. Add a 'Showtimes' anchor button near the title. Check why the counts differ, 25 on mobile and 22 on tablet/desktop.
- **Alternative:** Add a sticky showtimes bar on tablet.
- **Expected benefit:** Showtimes and booking links are reachable without scrolling past metadata.
- **Implementation:** Use a two-column grid from 768px. Place the screenings in the main column and the cast in the side column.
- **Acceptance:** At 810x1080 and 1440x900, at least the first 3 screening rows are visible without scrolling; The mobile and tablet/desktop showtime counts match for the same film and date
- **Validate:** Task-based usability test of finding a showtime on tablet, plus a viewport screenshot check.

### P2: English audio chip silently sets two filters

- **Who:** Tourist seeking English audio, trying to: Find films with English audio
- **Principle:** Interaction design
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** Clicking the single "English audio" chip activates both "Language (1)" and "Subtitles (1)". The chip does not say it sets a subtitle filter. The visitor cannot tell which values were applied without opening each dropdown.
- **Evidence:** S24 shows no active filters. After A042, S25 shows "English audio" highlighted, with "Language (1)" and "Subtitles (1)" both active. (S24, S25, A042)
- **Reproduce:** Open / on desktop; Click the "English audio" chip; Observe the Language (1) and Subtitles (1) pills
- **Likely cause (hypothesis):** The chip is a preset that maps to multiple filter values, and the UI does not show them.
- **Recommendation:** Show the applied values on the filter pills, for example "Language: English". If a subtitle value is not needed, do not set it. Otherwise name it in the chip label.
- **Alternative:** Add a summary line under the filters, "Showing: English audio, any subtitles".
- **Expected benefit:** Visitors can verify what is applied and adjust it.
- **Implementation:** Render the selected values in the pill label, or add a removable chip row under the filters.
- **Acceptance:** After a preset chip is selected, every filter it sets shows its value in the UI without opening a dropdown; A preset sets no filter that is not named in its label or summary
- **Validate:** Moderated usability test with English-audio tasks, plus a QA check of pill labels.

### P2: Wide-screen home stacks promotions and duplicate filters above the listing

- **Who:** Visitor seeking an original-language screening tonight, trying to: See tonight's OV screenings
- **Principle:** Aesthetic and minimalist design (Nielsen 8)
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** Before the first listing, tablet and desktop show a date strip, search, a chip row that repeats Tonight, Tomorrow and Weekend, dropdown filters, view toggles, a Tonight's Picks carousel, a 'Not sure what to watch?' row and a 'Make OV Berlin personal' card. First content measures at y=1343 on desktop and y=1369 on tablet.
- **Evidence:** The measured first content is more than 1300px down. The same date choices appear in the date strip and as chips. (S16, S20, S01)
- **Reproduce:** Open / on tablet or desktop; Scroll to the first screening list
- **Likely cause (hypothesis):** Discovery and personalisation modules were added above the core list.
- **Recommendation:** Remove the duplicate Tonight, Tomorrow and Weekend chips and move the personalisation card and 'Not sure what to watch?' row below the listing. Keep Tonight's Picks, but limit it to one compact row.
- **Alternative:** Make the picks carousel collapsible.
- **Expected benefit:** The screening list moves up in the viewport and there are fewer competing elements.
- **Implementation:** Reorder the home page modules, keep the dismissible personalisation card below the list, and drop the chips already covered by the date strip.
- **Acceptance:** The first listing row begins within the first viewport on 810x1080 and 1440x900; No date choice is offered twice in the filter area
- **Validate:** Compare the time it takes to select a screening, using a task test on old and new layouts.

### P2: Duplicate Documentary tags look like different controls

- **Who:** tourist seeking English audio, trying to: Understand a film's genre and format
- **Principle:** Visual craft: density, legibility, spacing and affordance
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** The film page shows two 'Documentary' pills, one grey and one red outline, above an 'OmeU' pill. The styling differs and nothing indicates whether they are links, filters or static labels.
- **Evidence:** Desktop and tablet film pages show grey 'Documentary' and red-outlined 'Documentary' stacked vertically, then 'OmeU'. (S21, S17)
- **Reproduce:** Open a film page such as Ghost Song on tablet or desktop; Look at the tags under the synopsis
- **Likely cause (hypothesis):** Genre and category tags come from two sources and are rendered with different styles without de-duplication.
- **Recommendation:** Merge duplicate tags into one. Style static labels differently from interactive chips, and show a hover and focus state only on the interactive ones. Place the tags in one wrapping row.
- **Alternative:** Keep one tag type and link it to the filtered list.
- **Expected benefit:** Shows clearly which tags can be pressed and removes the repeated label.
- **Implementation:** De-duplicate tags by label. Use one component with a 'static' and a 'link' variant.
- **Acceptance:** No label is repeated within the tag row; Pressable tags differ visibly from static ones; Tags wrap in one row at 810px and 1440px
- **Validate:** Visual regression test plus a usability test on tag recognition


## Needs user research

These are ideas worth testing with real visitors. Do not act on them without that research.

### P2: Booking badges "Book" and "↗" are not explained

- **Who:** Mobile user finding the right cinema booking link, trying to: Reach the correct booking destination for a screening
- **Principle:** Help and documentation (Nielsen 10)
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** Showtime badges end in either "· Book" or a bare "↗" icon. Nothing on screen says which one goes to an on-site booking and which one goes to the cinema's own site. A visitor may not be able to tell where a tap will lead.
- **Evidence:** The mobile list shows "20:15 OmeU · Book" for Ghost Song and "20:15 OmU ↗" for Geister and Minotaurus. No legend is visible. (S01, S07, S08)
- **Reproduce:** Open / on mobile; Compare the showtime badges on adjacent cards
- **Likely cause (hypothesis):** The badge variants encode the booking type, but only through an icon and a word.
- **Recommendation:** Replace the bare "↗" with a label such as "Cinema site" or "Tickets at cinema". Keep "Book" only for flows that complete on OV Berlin. Add a one-line legend or tooltip.
- **Alternative:** Add a short caption under the list header explaining the two badge types.
- **Expected benefit:** Visitors know the destination before they tap.
- **Implementation:** Change the badge component to use a text label for external links and add an aria-label that matches.
- **Acceptance:** No showtime badge relies on an icon alone; Each badge text names its destination type
- **Validate:** Run moderated tests with 5 tourists and ask them to predict where each badge leads.

### P3: Selecting the 'English' filter on mobile gives no visible change to the list

- **Who:** user switching filters on a small screen, trying to: Filter to English-audio screenings accurately on a phone
- **Principle:** Visibility of system status (Nielsen 1)
- **Severity, confidence, scope:** P3, low, core-page-type
- **Problem:** Choosing 'English' left the result count at 8 before and after. The visible list did not change until 'Done' was pressed, when it went to 5. The change is not shown, so the user may not know the filter applied.
- **Evidence:** A030 itemsBefore 8, itemsAfter 8. A031 itemsBefore 8, itemsAfter 5. (A030, A031)
- **Reproduce:** Open the mobile home page; Tap Filters; Select English; Compare the list before and after
- **Likely cause (hypothesis):** The filter sheet applies changes only on 'Done' and shows no live count.
- **Recommendation:** Show a live count on the Done button, for example 'Show 5 screenings'. Also show applied filter chips above the list after closing the sheet.
- **Alternative:** Apply the filters live behind the sheet.
- **Expected benefit:** The effect of each filter is visible and the result is clearer.
- **Implementation:** Update the button label whenever a filter option toggles. Render the active filters as removable chips under the search field.
- **Acceptance:** Toggling an option updates the Done label count within 300ms; Active filters appear as chips after the sheet closes
- **Validate:** Mobile usability test with a screenshot comparison of states before and after.

### P3: OV, OmU and OmeU are not explained in visible text

- **Who:** Tourist seeking English audio, trying to: Find an original-language screening with English audio
- **Principle:** Match between system and the real world (Nielsen 2)
- **Severity, confidence, scope:** P3, low, core-page-type
- **Problem:** The hero copy and the badges use "OV, OmU & OmeU" with no expansion on screen. The only explanation sits behind a small info icon. Mobile shows the icon alone on its own line.
- **Evidence:** The hero reads "OV, OmU & OmeU. No German dubbing." and the badges show "OmU" and "OmeU". The info icon is about 14px. (S01, S16, S20)
- **Reproduce:** Open / on mobile; Read the hero text and the first showtime badge
- **Likely cause (hypothesis):** The copy assumes visitors already know German cinema terms.
- **Recommendation:** Add plain wording in the hero, for example "OmeU = original audio with English subtitles; OmU = original audio with German subtitles". Use the same wording in the badge tooltip. Make the info link a visible text link with a larger tap target.
- **Alternative:** Replace badge text with "English subs" or "German subs".
- **Expected benefit:** Visitors can tell which screenings they can follow.
- **Implementation:** Put a one-line gloss beneath the H1. Make the "What does this mean?" control at least 44px high.
- **Acceptance:** Each abbreviation is defined in visible text on the first screen; The help control has a tap target of at least 44px
- **Validate:** Run a five-second comprehension test with non-German speakers.

### P3: Language and date shortcuts overlap with other controls

- **Who:** User switching dates and filters on a small screen, trying to: Filter screenings accurately by date and language
- **Principle:** Information architecture
- **Severity, confidence, scope:** P3, low, core-page-type
- **Problem:** Tonight/Tomorrow/Weekend chips repeat the date controls. "English audio" is a quick chip, while Language is a separate dropdown. A visitor may not know whether these controls combine or overwrite each other.
- **Evidence:** The tablet and desktop pages show the date strip, then the quick chips (Tonight, Tomorrow, Weekend, English audio), then the Language dropdown. On mobile all of this is behind "Filters". (S16, S20, S24, S07)
- **Reproduce:** Open / on desktop; Compare the date strip, the quick chips and the dropdown filters
- **Likely cause (hypothesis):** Shortcuts were added next to the full filters without being grouped.
- **Recommendation:** Group the controls under two labelled headings, "When" and "Language & subtitles". Show "English audio" as the selected state of the Language filter.
- **Alternative:** Drop the duplicate Tonight/Tomorrow/Weekend chips.
- **Expected benefit:** Each filter has one place and a clear state.
- **Implementation:** Link each chip's active state to its dropdown value.
- **Acceptance:** Each filter is available in only one control group; Selecting a chip updates the matching dropdown label
- **Validate:** Run a task test on switching date and language on a phone.

