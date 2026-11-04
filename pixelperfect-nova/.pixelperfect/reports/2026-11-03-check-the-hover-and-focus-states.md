# pixelPerfect verification report

- **Request:** check the hover and focus states
- **Date:** 04/11/2026, 00:42:23
- **Element:** `div.insight-banner`
- **Result:** 3 of 9 tests found problems: see Break test

## Agent answer

**Hover & Focus audit on `div.insight-banner` (2 buttons inside)**

`check_states` results:

- **View insights button:**
  - hover: **no visual feedback** — same color/bg, no underline, no opacity change. Pass but poor UX.
  - focus: outline `auto 1px rgb(0,95,204)` — browser default, not design token. `src/styles.css` has no `:focus-visible` rule.
  - active: no change.
  - disabled: **looks identical when disabled** — no dimming.

- **banner-close (X) button:**
  - hover: **no visual feedback** either.
  - focus: same browser default outline `auto 1px rgb(0,95,204)`.
  - active: no change.
  - disabled: identical when disabled.
  - **A11y:** icon-only button with no accessible name — `<button.banner-close> has no accessible name (icon-only?): add aria-label`. Needs `aria-label="Dismiss"` etc.

**What’s missing**

- No explicit `:hover`, `:focus-visible`, `:active` styles in `src/styles.css` for `.insight-banner button` or `.banner-close` (only `button{font:inherit; cursor:pointer; border:0; background:none; color:inherit}` at line 2).
- Base banner padding overridden twice (`padding:12px` -> `padding:8px 16px` at line 3) but no state styles added.
- Focus relies on user-agent outline, which is good for visibility but mismatched with design (`#7162e8` purple).

Not yet fixed — awaiting instruction to fix.

## Break test

- ✗ Keyboard & screen reader basics: <button.banner-close> has no accessible name (icon-only?): add aria-label
- ✓ <button> "View insights" · hover
- ✓ <button> "View insights" · focus
- ✓ <button> "View insights" · active
- ✗ <button> "View insights" · disabled: <button> "View insights" looks exactly the same when disabled
- ✓ <button.banner-close> · hover
- ✓ <button.banner-close> · focus
- ✓ <button.banner-close> · active
- ✗ <button.banner-close> · disabled: <button.banner-close> looks exactly the same when disabled

---

"Verified" means the checks listed above passed, at the widths and states listed, on the page state tested. It does not cover other pages, other states or other browsers.
