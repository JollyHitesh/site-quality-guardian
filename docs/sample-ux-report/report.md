# OV Berlin: expert UX report

2026-11-09T05:45:06.135Z. Devices: mobile, tablet, desktop.

> Measured results and expert judgements are labelled separately. Automated accessibility checks do not establish WCAG conformance.

## Scorecard

- **Discoverability:** 86. Expert view, not scored: 0 pass, 3 concern, 0 fail.
- **Task efficiency:** 89. Expert view, not scored: 2 pass, 0 concern, 0 fail.
- **Clarity:** 100. Expert view, not scored: 3 pass, 5 concern, 0 fail.
- **Visual design:** 47. Expert view, not scored: 0 pass, 9 concern, 0 fail.
- **Accessibility:** 40. Expert view, not scored: 0 pass, 0 concern, 0 fail.

## Visitor journeys

- **Reached** on mobile: Find films with English audio. 4 actions, 0 returns, 0 dead ends.
- **Reached** on mobile: Open a film and find where to get tickets. 1 actions, 0 returns, 0 dead ends.
- **Reached** on mobile: Open a cinema's page to see what it shows. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Find films with English audio. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Open a film and find where to get tickets. 1 actions, 0 returns, 0 dead ends.
- **Reached** on desktop: Open a cinema's page to see what it shows. 2 actions, 0 returns, 0 dead ends.

## Measured defects

A published rule measured these in a real browser. They are facts about this run and can be reproduced.

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
- **Evidence:** Some controls are below 24px and crowded by neighbours. Measured by the audit on mobile. (S36, A004, S01, S04)
- **Reproduce:** Open /guide/:slug on mobile; Check: Does the layout fit small screens and fingers?
- **Cause:** Hit areas match the visual size.
- **Recommendation:** Give these controls at least 24px, ideally 44px.
- **Alternative:** Add padding to enlarge the hit area without changing the visual size.
- **Expected benefit:** Fewer wrong taps.
- **Implementation:** Use padding or a pseudo-element to extend the hit area.
- **Acceptance:** No crowded target is under 24 by 24px
- **Validate:** Re-run the layout check on a phone profile.

### P1: Focused controls are covered by another element: View details for On the Sea, Add to watchlist, View details for Prime Time, Add to watchlist, View de

- **Who:** Keyboard-only visitor, trying to: Use every part of the site without a mouse
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** Focused controls are covered by another element: View details for On the Sea, Add to watchlist, View details for Prime Time, Add to watchlist, View details for Fatherland, Add to watchlist, View details for Lügen über meine Mutter, Add to watchlist.
- **Evidence:** Focused controls are covered by another element: View details for On the Sea, Add to watchlist, View details for Prime Time, Add to watchlist, View details for Fatherland, Add to watchlist, View details for Lügen über meine Mutter, Add to watchlist. Measured by the audit on desktop. (S28, A046)
- **Reproduce:** Open / on desktop; Check: Is keyboard focus visible and unobscured?
- **Likely cause (hypothesis):** A sticky bar likely overlaps content when the browser scrolls to the focused control.
- **Recommendation:** Keep focused controls clear of sticky bars.
- **Alternative:** Reduce or unstick the bar while the visitor moves through content.
- **Expected benefit:** The focused control stays visible.
- **Implementation:** Add scroll-padding-top equal to the sticky header height on the scrolling element.
- **Acceptance:** No focused control is hidden by a sticky element
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: "Switch to map view" works with a mouse but does nothing with Enter or Space.

- **Who:** Keyboard-only visitor, trying to: Use every part of the site without a mouse
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** "Switch to map view" works with a mouse but does nothing with Enter or Space.
- **Evidence:** "Switch to map view" works with a mouse but does nothing with Enter or Space. Measured by the audit on desktop. (A050)
- **Reproduce:** Open / on desktop; Check: Can every control be reached and used by keyboard?
- **Cause:** The element takes focus but only handles pointer events.
- **Recommendation:** Make this control respond to Enter and Space.
- **Alternative:** Replace it with a native button.
- **Expected benefit:** Filters and menus work without a mouse.
- **Implementation:** Prefer <button>. Otherwise add a keydown handler for Enter and Space that calls the click action.
- **Acceptance:** Enter or Space produces the same result as a click
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P1: Opening "Open navigation menu (narrow window)" leaves focus outside the panel.

- **Who:** Keyboard-only visitor, trying to: Use a menu or filter panel
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P1, high, core-page-type
- **Problem:** Opening "Open navigation menu (narrow window)" leaves focus outside the panel.
- **Evidence:** Opening "Open navigation menu (narrow window)" leaves focus outside the panel. Measured by the audit on desktop. (S31, A053)
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
- **Evidence:** While "Open navigation menu (narrow window)" is open, 12 of 12 tab presses landed behind it. Measured by the audit on desktop. (S31, A053)
- **Reproduce:** Open / on desktop; Check: Do dialogs manage focus?
- **Likely cause (hypothesis):** Content behind the panel is still focusable.
- **Recommendation:** Keep focus inside the panel while it is open.
- **Alternative:** Set the inert attribute on the background.
- **Expected benefit:** Visitors do not operate controls they cannot see.
- **Implementation:** Use <dialog>.showModal(), or set inert on everything outside the panel.
- **Acceptance:** Tab cycles only through controls in the open panel
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
- **Evidence:** Find films with English audio: The successful path took 4 actions. The target is 2. Measured by the audit on mobile. (S07, S08, S09, S10, S11, A027)
- **Reproduce:** Open / on mobile as a new visitor; Activate "Try "English Sunday" or "OmU Mitte"…" (A027); Activate "Filters (1)" (A028); Activate "English" (A029); Activate "Done" (A030)
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
- **Evidence:** Most text on this page is 12px, below the 14px limit. Measured by the audit on mobile, tablet, desktop. (S02, S03, S16, S17, S18, S20)
- **Reproduce:** Open /movies/:slug on mobile, tablet, desktop; Check: Are body size and line length readable?
- **Likely cause (hypothesis):** Typography values may have been set for a different viewport.
- **Recommendation:** Bring body size and line length within limits.
- **Alternative:** Add responsive typography steps.
- **Expected benefit:** Longer text is easier to read.
- **Implementation:** Use a body size of at least 14px, and set max-width near 70ch on text blocks.
- **Acceptance:** Body text is at least 14px; Median line length is at most 100 characters
- **Validate:** Re-run this check.

### P2: 1 button(s) have no fill, border, underline or icon, for example "View experience details for b-ware! ladenkino".

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: Tell what can be pressed
- **Principle:** Visual craft: density, legibility, spacing and affordance
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** 1 button(s) have no fill, border, underline or icon, for example "View experience details for b-ware! ladenkino".
- **Evidence:** 1 button(s) have no fill, border, underline or icon, for example "View experience details for b-ware! ladenkino". Measured by the audit on mobile, tablet, desktop. (S02, S17, S21)
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

### P2: The navigation label "omu kino berlin" points to different destinations: /guide/omu-kino-berlin, /omu-kino-berlin.

- **Who:** First-time visitor, trying to: Find the right section
- **Principle:** Information architecture
- **Severity, confidence, scope:** P2, high, single-page-type
- **Problem:** The navigation label "omu kino berlin" points to different destinations: /guide/omu-kino-berlin, /omu-kino-berlin.
- **Evidence:** The navigation label "omu kino berlin" points to different destinations: /guide/omu-kino-berlin, /omu-kino-berlin. Measured by the audit on mobile, tablet, desktop. (S04, S19, S23)
- **Reproduce:** Open /guide/:slug on mobile, tablet, desktop; Check: Do navigation labels identify one destination each?
- **Cause:** Two navigation items share a label.
- **Recommendation:** Give each destination its own specific label.
- **Alternative:** Group items under one parent with distinct child labels.
- **Expected benefit:** A label predicts where it leads.
- **Implementation:** Rename the items after the content they lead to.
- **Acceptance:** No two navigation items share a label but differ in destination
- **Validate:** Re-run this check. Use a tree test to confirm the new labels are understood.

### P2: Main action links are under 44px tall on phones.

- **Who:** Visitor on a phone, trying to: Press the main action
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P2, high, multiple-page-types
- **Problem:** Main action links are under 44px tall on phones.
- **Evidence:** Main action links are under 44px tall on phones. Measured by the audit on mobile. (S32, A001, S01, S02)
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
- **Evidence:** Form fields under 16px make iPhones zoom in on focus. Measured by the audit on mobile. (S34, A001, S01, S02)
- **Reproduce:** Open / on mobile; Check: Does the layout fit small screens and fingers?
- **Cause:** The field font size is below 16px.
- **Recommendation:** Set field text to at least 16px.
- **Alternative:** Scale the visual size with a transform if smaller text is needed.
- **Expected benefit:** The page stays still when a field is focused.
- **Implementation:** Set font-size:16px on inputs for small viewports.
- **Acceptance:** All text inputs are at least 16px on phones
- **Validate:** Re-run the layout check on a phone profile.

### P2: axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 21 element(s) affected.

- **Who:** Visitor using a screen reader, trying to: Use the page with assistive technology
- **Principle:** WCAG: perceivable and robust semantics
- **Severity, confidence, scope:** P2, high, core-page-type
- **Problem:** axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 21 element(s) affected.
- **Evidence:** axe-core rule "label-content-name-mismatch": Elements must have their visible text as part of their accessible name. 21 element(s) affected. Measured by the audit on tablet, desktop. (A033, S16, S20)
- **Reproduce:** Open / on tablet, desktop; Check: Did axe-core report violations?
- **Cause:** The cited elements fail this automated rule.
- **Recommendation:** Fix the listed elements according to the rule guidance.
- **Alternative:** Fix it once in the shared component, if these share one.
- **Expected benefit:** The page works better with assistive technology.
- **Implementation:** Rule guidance: https://dequeuniversity.com/rules/axe/4.14/label-content-name-mismatch?application=playwright. Selectors: [["a[aria-label=\"View details for On the Sea\"]"],["a[aria-label=\"View details for Fatherland\"]"],[".focus-visible\\:ring-2.focus-visible\\:ring-brand-400[href$=\"forgotten-island\"]"],["a[aria-lab.
- **Acceptance:** axe-core no longer reports this rule on this page
- **Validate:** Re-run axe-core, then test by hand. Automated rules cover only part of WCAG.

### P2: Tab order jumps backwards up the page 1 time(s), for example from "Cinema details →" to "CAST & DETAILS".

- **Who:** Keyboard-only visitor, trying to: Use every part of the site without a mouse
- **Principle:** WCAG: operable by keyboard
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** Tab order jumps backwards up the page 1 time(s), for example from "Cinema details →" to "CAST & DETAILS".
- **Evidence:** Tab order jumps backwards up the page 1 time(s), for example from "Cinema details →" to "CAST & DETAILS". Measured by the audit on desktop. (S29, A047)
- **Reproduce:** Open /movies/:slug on desktop; Check: Is the tab order logical and free of traps?
- **Likely cause (hypothesis):** DOM order may differ from visual order because of CSS reordering.
- **Recommendation:** Match DOM order to visual order.
- **Alternative:** Reorder the layout visually to follow the existing DOM.
- **Expected benefit:** Focus moves in the order the page reads.
- **Implementation:** Check for flex order, grid placement and row-reverse on these regions.
- **Acceptance:** Tab moves top to bottom and in reading order within each region
- **Validate:** Repeat this keyboard test in the agent, then confirm by hand with a keyboard and a screen reader.

### P3: 14 different button styles appear on this page.

- **Who:** visitor on a phone seeking an original-language screening tonight, trying to: Recognise repeated actions
- **Principle:** Consistency and standards (Nielsen 4)
- **Severity, confidence, scope:** P3, high, multiple-page-types
- **Problem:** 14 different button styles appear on this page.
- **Evidence:** 14 different button styles appear on this page. Measured by the audit on mobile, tablet, desktop. (S02, S16, S17, S20, S21)
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

### P2: Empty 'CAST & DETAILS' section on film page

- **Who:** Tourist seeking English audio, trying to: Learn about a film and decide whether to see it
- **Principle:** Help users recognise, diagnose and recover from errors (Nielsen 9)
- **Severity, confidence, scope:** P2, high, multiple-page-types
- **Problem:** The 'CAST & DETAILS' heading appears with no content under it, and the poster is missing. This leaves a blank band and no explanation or next step.
- **Evidence:** On desktop and tablet, a 'CAST & DETAILS' label is followed by an empty area and a divider. The list card on mobile shows a placeholder clapper icon instead of a poster. (S21, S17, S01)
- **Reproduce:** Open /movies/fr-immer-sechzehn on desktop or tablet; Look below the OmeU badge
- **Likely cause (hypothesis):** The section renders its heading even when there is no metadata.
- **Recommendation:** Hide the section when it has no data. Or show a message such as 'No cast details available yet', with a link to the cinema's film page.
- **Alternative:** Fill the gap with the synopsis or a placeholder poster that shows the film title.
- **Expected benefit:** Removes the dead space and moves the screenings higher up the page.
- **Implementation:** Render the heading only if cast, synopsis or runtime exists. Otherwise show the fallback message.
- **Acceptance:** No heading is shown without content beneath it; If a fallback is shown, it contains a next-step link
- **Validate:** Check the film pages that have no metadata on all three breakpoints.

### P2: Desktop film page leaves large margins and pushes showtimes low

- **Who:** Mobile user finding the right cinema booking link, trying to: Find the showtime and get to the booking link
- **Principle:** Responsive behaviour
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** The single narrow column on desktop sits in a wide empty frame, with a large vertical gap before the screenings. The Tickets buttons sit far from the times they belong to. On mobile the primary 'See 2 showtimes' button is surfaced, but desktop and tablet have no equivalent.
- **Evidence:** On desktop the first Tickets button is at about y=812 of 900. The Tickets button is at the far right edge, about 600px from the time. The tablet layout repeats this pattern. (S21, S17, S02)
- **Reproduce:** Open the film page at 1440px width; Look at the position of the showtimes and Tickets buttons
- **Likely cause (hypothesis):** The mobile layout is stretched across larger screens without being redesigned for them.
- **Recommendation:** Use a two-column desktop layout, with film details on the left and the screenings list on the right. Place Tickets next to the time and cinema name.
- **Alternative:** Keep one column but reduce the empty gap above the screenings and narrow the rows.
- **Expected benefit:** Showtimes and booking links become visible without scrolling.
- **Implementation:** Use a grid from 1024px up, with the screenings in a sticky right column.
- **Acceptance:** At 1440x900 the first Tickets button is visible above the fold; The time and Tickets button sit within about 300px of each other
- **Validate:** Compare screenshots at 810 and 1440px widths before and after the change.

### P2: English audio chip also changes Subtitles filter without explanation

- **Who:** Tourist seeking English audio, trying to: Find films with English audio
- **Principle:** Interaction design
- **Severity, confidence, scope:** P2, medium, core-page-type
- **Problem:** After the English audio quick chip is selected, the Language (1) and Subtitles (1) dropdown buttons both turn active. The visitor selected one chip but two filters changed, and the Subtitles value is not visible, so the filter state may be hard to verify.
- **Evidence:** S24 shows Language and Subtitles with no count. S25 shows Language (1) and Subtitles (1) after one click on 'English audio'. (S24, S25)
- **Reproduce:** Open the home page on desktop; Click the 'English audio' chip; Compare the Language and Subtitles buttons
- **Likely cause (hypothesis):** The quick chip maps to a combined filter preset, but the UI does not show what the preset includes.
- **Recommendation:** Show the applied values as removable chips below the filter row, for example 'Language: English' and 'Subtitles: Any'. If the preset really sets subtitles, add a label to the chip or a tooltip that says so.
- **Alternative:** Make the chip set only the Language filter.
- **Expected benefit:** The visitor can check exactly which filters are narrowing results and remove the wrong one.
- **Implementation:** Render an active-filter summary row from the filter state. Each item gets its own remove button with an accessible name.
- **Acceptance:** After clicking 'English audio', every changed filter is listed by name and value; Each listed filter can be removed individually; Dropdown counts match the number of listed filters
- **Validate:** Moderated usability test with tourists, plus a manual check of filter state after each chip click.

### P3: Two adjacent clear icons in the mobile search field

- **Who:** User switching filters on a small screen, trying to: Correct or clear a search on a phone
- **Principle:** Interaction design
- **Severity, confidence, scope:** P3, medium, core-page-type
- **Problem:** The search field shows a bold X and a lighter X side by side. Both look like clear controls, so their different roles are unclear and one may be a duplicate.
- **Evidence:** S05 shows two X icons at the right of the search input containing 'zzqxjv qqwxy'. (S05)
- **Reproduce:** Open the home page on a 390px viewport; Type a query that matches nothing; Look at the right end of the search field
- **Likely cause (hypothesis):** The browser's native search-clear icon is displayed alongside a custom clear button.
- **Recommendation:** Hide the native clear icon with appearance:none on the search input's cancel button, and keep one 44px clear button.
- **Alternative:** Keep the native control and remove the custom button.
- **Expected benefit:** One clear, predictable control in the search field.
- **Implementation:** Use input[type=search]::-webkit-search-cancel-button {display:none} and keep the custom button.
- **Acceptance:** Only one clear icon is visible when the field has text; The icon's touch target is at least 44x44 px; Tapping it clears the text and restores results
- **Validate:** Check in Safari, Chrome and Firefox on mobile.


## Ideas needing user research

These are ideas worth testing with real visitors. Do not act on them without that research.

### P2: OV, OmU and OmeU shown without explanation on listings

- **Who:** Tourist seeking English audio, trying to: Find an English-audio screening tonight
- **Principle:** Match between system and the real world (Nielsen 2)
- **Severity, confidence, scope:** P2, low, core-page-type
- **Problem:** Showtime chips and the headline use OmU and OmeU without a visible definition. The mobile help control is an unlabeled info icon. A visitor from abroad may not know which format has English audio.
- **Evidence:** On mobile the chips read "11:00 OmeU · Book" and "OmU". The subtitle reads "OV, OmU & OmeU. No German dubbing." with only a small ⓘ icon. (S01, S07, S16)
- **Reproduce:** Open the home page on a 390px viewport; Read the chips on the first listing
- **Likely cause (hypothesis):** The copy assumes the visitor already knows German cinema format terms.
- **Recommendation:** Replace the chip text with plain wording, for example "English audio, German subtitles" for OmU or OmeU, or add a short caption. Make the ⓘ control a labelled link, "What do OV / OmU / OmeU mean?".
- **Alternative:** Add a one-line legend under the filter row.
- **Expected benefit:** Visitors can tell which screenings have English audio without having to leave the page.
- **Implementation:** Map each format code to a plain-language label and show the code in a tooltip. Add a visible text label to the ⓘ button.
- **Acceptance:** Every chip shows a plain-language audio and subtitle description; The help control has a visible text label on a 390px viewport
- **Validate:** Moderated test with non-German-speaking participants, asking them to pick an English-audio screening.

### P3: Overlapping quick filters, date strip and picks add up to a crowded first screen

- **Who:** Visitor on a phone seeking an original-language screening tonight, trying to: Find the right screening
- **Principle:** Information architecture
- **Severity, confidence, scope:** P3, low, core-page-type
- **Problem:** Tonight, Tomorrow and Weekend are repeated across the date strip and the chip row. A dozen filter and discovery controls plus "Tonight's picks" and "Not sure what to watch?" categories push the main listing below the fold on tablet, where the first content sits at y=1369.
- **Evidence:** S16 shows the date strip, search, quick chips, filter dropdowns, view toggles, picks and categories before the listing begins. (S16, S20, S24)
- **Reproduce:** Open the home page on a tablet or desktop viewport; Scroll to the first listing
- **Likely cause (hypothesis):** Several discovery models, namely date, filter, curated and personalisation, were added side by side.
- **Recommendation:** Remove the duplicate Tonight, Tomorrow and Weekend chips, or merge them into the date strip. Group the language chips with the Language filter.
- **Alternative:** Collapse "Not sure what to watch?" and the personalisation prompt below the listing.
- **Expected benefit:** A clearer path from the date to the listing.
- **Implementation:** Keep one date control and one row of filters, and place curated sections after the first results.
- **Acceptance:** No time or date option appears in two places; The first listing starts higher on a 810x1080 viewport
- **Validate:** A/B test the simplified layout against the current one, measuring how quickly participants reach the first listing.


## Limitations
- The site returned an intermittent error during this run that did not recur on re-test (2 record(s), for example: Uncaught JavaScript error: Loading chunk 8974 failed. (error: https://www.ov-ber). Check the server logs around 2026-11-09T05:39:03.001Z.
