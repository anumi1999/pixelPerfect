# pixelPerfect verification report

- **Request:** Break it: stress-test the selected block and report what breaks. Do not fix anything yet.
- **Date:** 04/11/2026, 00:37:34
- **Element:** `div.metrics-grid`
- **Result:** 4 of 10 tests found problems: see Break test

## Agent answer

**Stress test on `div.metrics-grid` — 4 of 9 attacks broke**

BROKE:
- **long_word (Very long unbroken word):** `<span> "Active customers verylon…"` spills 15px outside block, `<span> "vs. last month…"` spills 37px, `<svg>` spills 32px, and `vs. last month` overlaps `<svg>` 7×14px. Cause: `.metric-top {display:flex; justify-content:space-between}` and `.metric-bottom {display:flex}` have no `min-width:0` / `overflow-wrap` on their text children. `src/styles.css` ~ `.metric-top` / `.metric-bottom`. Long unbroken tokens have no break rule.
- **big_numbers:** `<div.metric-value> "$9,876,584,254.00"` runs 25px past its box. Cause: `.metric-value {font:800 21px Manrope}` overridden by `.metric-value{font-size:25px;letter-spacing:-1.1px}` at `src/styles.css:5` — large single-token number with no `overflow-wrap:break-word`, `word-break`, or `overflow:hidden`.
- **big_font (1.5× bigger):** `$84,254.00` runs 12px past its box. Same cause: fixed large font on `.metric-value` in `src/styles.css:5` and `:2` — no wrapping/clamping, scales out of 188px container.
- **narrow (squeezed to 320px):** `$84,254.00` runs 94px past, `2,420` 29px, `3.62%` 35px, `18,492` 38px; `<svg>` spills 14px, `vs. last month` 19px, and `$84,254.00` overlaps `2,420` 46×34px. Cause: `.metrics-grid` at `max-width:760px` -> `repeat(2,minmax(0,1fr))` + `gap:9px` in `src/styles.css:10`, `.metric-card{padding:12px}` at same breakpoint, but inner `.metric-value` still 19-21px+ at `src/styles.css:10-11`. No clipping/containment, so overflow from one card paints over next.

HELD:
- long_text 2.5× longer, empty, many_items 15×, rtl, small_screen (320/375/768), keyboard & screen-reader basics — no spill/overlap.

NOT TESTED:
- Data states: API error / loading / empty metrics, skeleton, failed icon fetch.
- Interaction states: hover/focus/active/disabled — `check_states` found 0 buttons/links/inputs in this block, so no hover/focus contrast check.
- A11y reading order, resize to 200%+ beyond big_font, slow network, other pages, print.

## Break test

- ✓ Text 2.5× longer
- ✗ Very long unbroken word: <span> "Active customers verylon…" spills 15px outside the block; <svg> spills 32px outside the block
- ✗ Very large numbers: the text of <div.metric-value> "$9,876,584,254.00" runs 25px past its box
- ✓ Empty text and missing images
- ✓ 15× more items
- ✗ Text 1.5× bigger: the text of <div.metric-value> "$84,254.00" runs 12px past its box
- ✗ Squeezed to 320px wide: the text of <div.metric-value> "$84,254.00" runs 94px past its box; the text of <div.metric-value> "2,420" runs 29px past its box
- ✓ Right-to-left layout
- ✓ Small screens (320 / 375 / 768 px)
- ✓ Keyboard & screen reader basics

---

"Verified" means the checks listed above passed, at the widths and states listed, on the page state tested. It does not cover other pages, other states or other browsers.
