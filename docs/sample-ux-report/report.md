# OV Berlin: expert UX report

2026-11-09T05:52:17.854Z. Devices: mobile, tablet, desktop.

> Measured results and expert judgements are labelled separately. Automated accessibility checks do not establish WCAG conformance.

## Scorecard

- **Discoverability:** 100. Expert view, not scored: 0 pass, 3 concern, 0 fail.
- **Task efficiency:** 89. Expert view, not scored: 2 pass, 0 concern, 0 fail.
- **Clarity:** 100. Expert view, not scored: 3 pass, 4 concern, 0 fail.
- **Visual design:** 47. Expert view, not scored: 0 pass, 9 concern, 0 fail.
- **Accessibility:** 50. Expert view, not scored: 0 pass, 0 concern, 0 fail.

## Visitor journeys

- **Reached** on mobile: Find films with English audio. 4 actions, 0 returns, 0 dead ends.
- **Reached** on mobile: Open a film and find where to get tickets. 1 actions, 0 returns, 0 dead ends.
- **Reached** on mobile: Open a cinema's page to see what it shows. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Find films with English audio. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Open a film and find where to get tickets. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Open a cinema's page to see what it shows. 2 actions, 0 returns, 0 dead ends.

## Measured defects

A published rule measured these in a real browser. They are facts about this run and can be reproduced.

### P1: Some controls are below 24px and crowded by neighbours.

- **Who:** Visitor on a phone, trying to: Press the intended control
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P1, high, multiple-page-types
- **Problem:** Some controls are below 24px and crowded by neighbours.
- **Evidence:** Some controls are below 24px and crowded by neighbours. Measured by the audit on mobile. (S35, A005)
- **Reproduce:** Open /guide/:slug on mobile; Check: Does the layout fit small screens and fingers?
- **Cause:** Hit areas match the visual size.
- **Recommendation:** Give these controls at least 24px, ideally 44px.
- **Alternative:** Add padding to enlarge the hit area without changing the visual size.
- **Expected benefit:** Fewer wrong taps.
- **Implementation:** Use padding or a pseudo-element to extend the hit area.
- **Acceptance:** No crowded target is under 24 by 24px
- **Validate:** Re-run the layout check on a phone profile.

### P1: Focused controls are covered by another element: View details for On the Sea, rated 7.1, Add to watchlist, View details for Prime Time, Add to watchli

- **Who:** Keyboard-only visitor, trying to: Use every part of the site without a mouse
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** Focused controls are covered by another element: View details for On the Sea, rated 7.1, Add to watchlist, View details for Prime Time, Add to watchlist, View details for Fatherland, rated 6.6, Add to watchlist, View details for Lügen über meine Mutter, Add to watchlist.
- **Evidence:** Focused controls are covered by another element: View details for On the Sea, rated 7.1, Add to watchlist, View details for Prime Time, Add to watchlist, View details for Fatherland, rated 6.6, Add to watchlist, View details for Lügen über meine Mutter, Add to watchlist. Measured by the audit on desktop. (S28, A048)
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
- **Evidence:** Opening "Open navigation menu (narrow window)" leaves focus outside the panel. Measured by the audit on desktop. (S31, A056)
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
- **Evidence:** While "Open navigation menu (narrow window)" is open, 12 of 12 tab presses landed behind it. Measured by the audit on desktop. (S31, A056)
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
- **Evidence:** "English audio" changes appearance when active, but its state is not exposed to assistive technology. Measured by the audit on desktop. (S30, A052)
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
- **Evidence:** Find films with English audio: The successful path took 4 actions. The target is 2. Measured by the audit on mobile. (S07, S08, S09, S10, S11, A029)
- **Reproduce:** Open / on mobile as a new visitor; Activate "Try "English Sunday" or "OmU Mitte"…" (A029); Activate "Filters (1)" (A030); Activate "English" (A031); Activate "Done" (A032)
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
- **Evidence:** Most text on this page is 12px, below the 14px limit. Measured by the audit on mobile, tablet, desktop. (S02, S03, S04, S16, S17, S18)
- **Reproduce:** Open /movies/:slug on mobile, tablet, desktop; Check: Are body size and line length readable?
- **Likely cause (hypothesis):** Typography values may have been set for a different viewport.
- **Recommendation:** Bring body size and line length within limits.
- **Alternative:** Add responsive typography steps.
- **Expected benefit:** Longer text is easier to read.
- **Implementation:** Use a body size of at least 14px, and set max-width near 70ch on text blocks.
- **Acceptance:** Body text is at least 14px; Median line length is at most 100 characters
- **Validate:** Re-run this check.

### P2: 2 button(s) have no fill, border, underline or icon, for example "More about this movie".

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: Tell what can be pressed
- **Principle:** Visual craft: density, legibility, spacing and affordance
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** 2 button(s) have no fill, border, underline or icon, for example "More about this movie".
- **Evidence:** 2 button(s) have no fill, border, underline or icon, for example "More about this movie". Measured by the audit on mobile, tablet, desktop. (S02, S17, S21)
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

### P2: axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 2 element(s) affected.

- **Who:** Visitor using a screen reader, trying to: Use the page with assistive technology
- **Principle:** WCAG: perceivable and robust semantics
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 2 element(s) affected.
- **Evidence:** axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 2 element(s) affected. Measured by the audit on tablet, desktop. (A036, S17, S21)
- **Reproduce:** Open /movies/:slug on tablet, desktop; Check: Did axe-core report violations?
- **Cause:** The cited elements fail this automated rule.
- **Recommendation:** Fix the listed elements according to the rule guidance.
- **Alternative:** Fix it once in the shared component, if these share one.
- **Expected benefit:** The page works better with assistive technology.
- **Implementation:** Rule guidance: https://dequeuniversity.com/rules/axe/4.14/label-content-name-mismatch?application=playwright. Selectors: [[".px-5"],[".shadow-sm.py-2[aria-label=\"Watch On the Sea trailer\"]"]].
- **Acceptance:** axe-core no longer reports this rule on this page
- **Validate:** Re-run axe-core, then test by hand. Automated rules cover only part of WCAG.

### P2: Tab order jumps backwards up the page 1 time(s), for example from "Cinema details →" to "CAST & DETAILS".

- **Who:** Keyboard-only visitor, trying to: Use every part of the site without a mouse
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** Tab order jumps backwards up the page 1 time(s), for example from "Cinema details →" to "CAST & DETAILS".
- **Evidence:** Tab order jumps backwards up the page 1 time(s), for example from "Cinema details →" to "CAST & DETAILS". Measured by the audit on desktop. (S29, A049)
- **Reproduce:** Open /movies/:slug on desktop; Check: Is the tab order logical and free of traps?
- **Likely cause (hypothesis):** DOM order may differ from visual order because of CSS reordering.
- **Recommendation:** Match DOM order to visual order.
- **Alternative:** Reorder the layout visually to follow the existing DOM.
- **Expected benefit:** Focus moves in the order the page reads.
- **Implementation:** Check for flex order, grid placement and row-reverse on these regions.
- **Acceptance:** Tab moves top to bottom and in reading order within each region
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

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


## Expert design hypotheses

A reviewer judged these from cited screenshots and actions, and a second reading checked each claim. They are hypotheses, and they do not affect any score.

### P2: Tablet film page pushes screenings below trailer, cast and links

- **Who:** Tourist seeking English audio on a tablet, trying to: Find showtimes and the booking link for a film
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** On the tablet film page, the screenings and the booking path are below the hero, synopsis, tags, cast and details. The mobile layout puts a 'Next' card and a 'See 6 showtimes' button in the first view. Tablet gets neither, so the main task starts at the bottom of the screen.
- **Evidence:** S17 shows 'Upcoming screenings (6)' at about y=930 of 1080, with the next card and day tabs only just visible. The trailer button is repeated twice, and cast and IMDb/TMDb/Letterboxd links fill the space above. S02 shows the mobile layout with a full-width 'See 6 showtimes' button. (S17, S02, S21)
- **Reproduce:** Open /movies/on-the-sea at 810x1080; Observe the first view; Compare with the mobile first view
- **Likely cause (hypothesis):** The tablet uses the desktop content order, and the mobile-specific summary and call to action are only shown on narrow screens.
- **Recommendation:** At tablet widths, show the 'Next' card and a showtimes button or the screenings list before the cast and details block. Remove the duplicate Watch Trailer button. Place the poster beside the screenings.
- **Alternative:** Make the cast and details collapsible on tablet.
- **Expected benefit:** Showtimes and booking are reachable without scrolling past secondary content.
- **Implementation:** Reorder the sections with CSS grid at breakpoints from 600 to 1024px. Show the mobile 'Next' card there.
- **Acceptance:** At 810x1080 the first screening row or a showtimes button is fully visible in the first view; Only one Watch Trailer button appears above the screenings
- **Validate:** Compare screenshots at 390, 810 and 1440 widths; run a short moderated task test on tablet.

### P2: Tablet landing page clips date strip and chips, and puts picks above listings

- **Who:** User switching dates and filters on a small screen, trying to: Switch dates and filters, then reach the film list
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** The tablet landing page uses the desktop layout. The date strip has a faded eighth slot and arrows, the quick-chip row clips 'Outdoor' at the edge, and the Tonight's Picks carousel, category chips and a promo card fill the first view. The film listing begins far down the page.
- **Evidence:** S16 shows a clipped 'Outdoor' chip and a cut-off picks card. The measured firstContentY is 1369 on a 1080px viewport. The listing is not in the first view. The 'Make OV Berlin personal' card also sits above the results. (S16, S20, S01)
- **Reproduce:** Open / at 810x1080; Scroll to the first listing
- **Likely cause (hypothesis):** Desktop components are shrunk to tablet width without a distinct arrangement.
- **Recommendation:** At tablet widths, wrap the chips instead of clipping them. Move the promo card below the first listing rows. Reduce the height of the picks carousel.
- **Alternative:** Use the mobile pattern with a Filters sheet on tablet.
- **Expected benefit:** The first listing is reachable sooner and no controls are partly hidden.
- **Implementation:** Set flex-wrap on the chip row at 600 to 1024px, and make the personalisation card dismissible and placed lower.
- **Acceptance:** At 810px no chip is cut off at the edge; At least one listing row is visible in the first 1080px viewport
- **Validate:** Check screenshots at 810 and 1024 widths.

### P2: "English audio" chip silently sets two filters

- **Who:** Tourist seeking English audio, trying to: Find films with English audio
- **Principle:** Interaction design
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** Selecting the single "English audio" chip activates both Language (1) and Subtitles (1) dropdown filters. The screen does not say which values were applied. The result may be narrower than the visitor expects, and the dropdowns look like independent controls.
- **Evidence:** Before: Language and Subtitles show no count. After clicking the chip, the chip is red and both dropdowns show (1). The item count falls from 42 to 8. (S24, S25, A043)
- **Reproduce:** Open / on desktop; Click the "English audio" chip; Compare the Language and Subtitles buttons
- **Likely cause (hypothesis):** The preset chip maps to a combined filter but the UI shows only counts, not values.
- **Recommendation:** Show applied values as removable chips, or in the dropdown labels, e.g. "Language: English" and "Subtitles: none". Add a tooltip or caption on the preset chip describing what it sets.
- **Alternative:** Make the preset chip set only Language and leave Subtitles untouched.
- **Expected benefit:** Visitors can verify and adjust what the preset applied, which may reduce unexpected result sets.
- **Implementation:** Render an applied-filters row beneath the chip rows. Each applied filter is a button labelled with its value that removes it when clicked.
- **Acceptance:** After the chip is selected, each active filter's value is visible as text on the page; Each value can be removed individually; The preset chip description names every filter it sets
- **Validate:** Moderated usability test asking participants to state which filters are active after using the chip.

### P2: OV/OmU/OmeU abbreviations unexplained in main copy and badges

- **Who:** tourist seeking English audio, trying to: Find an English-audio or English-subtitled screening
- **Principle:** Match between system and the real world (Nielsen 2)
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** The tagline and screening badges use OV, OmU and OmeU without defining them. Only a small info icon hints at an explanation. A first-time visitor may not know which badge means English audio.
- **Evidence:** The tagline reads "OV, OmU & OmeU. No German dubbing." Screening badges show "11:00 OmeU · Book" and "OmU". The only help is an info icon with no visible text. (S01, S20)
- **Reproduce:** Open the home page on mobile; Read the tagline and the first screening badges
- **Likely cause (hypothesis):** The copy was written for local users who already know the terms.
- **Recommendation:** Add a visible plain-language gloss near the tagline, for example "OV = original audio, OmU = German subtitles, OmeU = English subtitles". Use "English subtitles" as the tooltip on the badges.
- **Alternative:** Replace the badge text with "English subtitles" or "Original audio" and keep the abbreviation in small print.
- **Expected benefit:** Tourists can identify matching screenings without leaving the page.
- **Implementation:** Add a one-line legend under the tagline. Give each badge a title or aria-label containing its expansion. Make the info icon open a popover with the three definitions.
- **Acceptance:** The three abbreviations are defined on screen without a tap, or by one tap on a labelled control; Each badge has an accessible expansion
- **Validate:** Task test with non-German-speaking participants: ask them to find an English-subtitled screening and observe whether they use the legend.


## Ideas needing user research

These are ideas worth testing with real visitors. Do not act on them without that research.

### P3: Mobile filter state is hidden behind a count

- **Who:** user switching dates and filters on a small screen, trying to: Switch filters and dates and keep track of what is applied
- **Principle:** Recognition rather than recall (Nielsen 6)
- **Severity, confidence, scope:** P3, low, core-page-type
- **Problem:** After a search, the Filters button shows only "(1)" and the listing cannot be tied to the filter. Users must reopen the panel to learn which filter is active. The desktop dropdowns are visible instead.
- **Evidence:** The mobile bar shows a "Filters (1)" button next to removable chips for "OmU" and "Mitte". The count of 1 does not match the two chips, and no other filter value is named. (S07, S08)
- **Reproduce:** Open the mobile home page; Type a search query such as "OmU Mitte" or apply English audio; Look at the bar below the search field
- **Likely cause (hypothesis):** Filters are collapsed into one button to save space, and only a count is kept as state.
- **Recommendation:** Show each active filter as a removable chip row below the Filters button, with a "Clear all" control. Keep the date visible.
- **Alternative:** Label the button with the active value when there is only one, for example "Filters: English".
- **Expected benefit:** Visitors can verify the filter state at a glance and remove one filter without reopening the panel.
- **Implementation:** Render the applied filters from the filter state as chips. Make the count equal the number of chips.
- **Acceptance:** Every applied filter is shown as a labelled, removable chip outside the panel; The Filters count equals the number of chips
- **Validate:** Usability test on a phone: apply two filters, then ask which are active without opening the panel.

### P3: Overlapping quick chips, dropdowns and date strip

- **Who:** user switching dates and filters on a small screen, trying to: Filter screenings accurately
- **Principle:** Information architecture
- **Severity, confidence, scope:** P3, low, core-page-type
- **Problem:** Several controls cover the same decision: Tonight/Tomorrow/Weekend duplicate the date strip, and "English audio" and "English subtitles" chips duplicate the Language and Subtitles dropdowns. Many controls sit above the first results, and the chip row is cut off on the right.
- **Evidence:** Tablet and desktop show a date strip, a chip row (Tonight … Outdoor), a dropdown row (Language, Subtitles, Time, Genre, Area, Near me) and a view toggle before any listing. The mobile version shows only Today/Tomorrow/Weekend and Filters. (S16, S20, S24)
- **Reproduce:** Open the home page on tablet or desktop; Look at the area above the listing
- **Likely cause (hypothesis):** Features were added over time as shortcuts without merging them into one filter model.
- **Recommendation:** Group the controls into two labelled blocks, "When" (dates and time) and "What" (language, subtitles, genre, area), and show chip shortcuts only as a visible state of the dropdowns.
- **Alternative:** Remove the Tonight/Tomorrow/Weekend chips on wide screens where the date strip is already visible.
- **Expected benefit:** Fewer overlapping controls and a clearer mapping from control to result.
- **Implementation:** Make chips and dropdowns write to the same state, so selecting "English audio" updates the Language dropdown label.
- **Acceptance:** Selecting a chip updates the matching dropdown label; No two controls with the same effect are shown side by side
- **Validate:** Card sort and first-click test on the filter area.

