// pixelPerfect interaction states: the in-page half. The side panel forces :hover, :focus and
// :active with the Chrome debugger; this file finds the interactive elements, measures them in each
// state, and checks keyboard basics. Loaded into the page before content.js.
(() => {
  const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]';
  const NATIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
  const STYLE_PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'border-top-width', 'outline-style', 'outline-width', 'outline-color',
    'box-shadow', 'text-decoration-line', 'opacity', 'transform', 'cursor', 'font-weight'];
  const isOurs = (el) => el?.closest?.('[id^="__pp"]');
  let freeze = null;

  function label(el) {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 22);
    return `<${tag}${cls}>${text ? ` "${text}"` : ''}`;
  }

  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };

  // Elements that look clickable (pointer cursor) but a keyboard can't reach.
  function clickableNotFocusable(root) {
    const out = [];
    for (const el of [root, ...root.querySelectorAll('*')].slice(0, 600)) {
      if (isOurs(el) || !visible(el)) continue;
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      if (el.matches(FOCUSABLE) && el.tabIndex >= 0) continue;
      // The pointer cursor is inherited from an interactive parent (e.g. an icon inside a button).
      if (el.parentElement?.closest(FOCUSABLE) && root.contains(el.parentElement.closest(FOCUSABLE))) continue;
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer' && !el.matches(FOCUSABLE)) continue;
      out.push(`${label(el)} looks clickable (pointer cursor) but can't be reached with the keyboard: use a <button> or <a>, or add tabindex="0" and key handling`);
      if (out.length >= 5) break;
    }
    return out;
  }

  // Interactive elements without a name a screen reader can announce.
  function unnamed(targets) {
    const out = [];
    for (const el of targets) {
      const name = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.innerText || el.value || el.getAttribute('alt') || '').trim();
      const labelled = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const imgAlt = [...el.querySelectorAll('img[alt]')].some((i) => i.alt.trim());
      if (!name && !labelled && !imgAlt) out.push(`${label(el)} has no accessible name (icon-only?): add aria-label`);
    }
    return out.slice(0, 5);
  }

  globalThis.ppStatesPrepare = function (root) {
    if (!root?.isConnected) return { error: 'The selected element is no longer on the page. Pick it again.' };
    globalThis.ppStatesCleanup();
    const found = [];
    if (root.matches(FOCUSABLE)) found.push(root);
    for (const el of root.querySelectorAll(FOCUSABLE)) if (found.length < 8 && !isOurs(el)) found.push(el);
    const targets = found.filter(visible).filter((el) => el.tabIndex >= 0 || NATIVE.has(el.tagName));
    targets.forEach((el, i) => el.setAttribute('data-pp-state', String(i)));
    return {
      targets: targets.map((el, i) => ({
        key: String(i), label: label(el),
        canDisable: ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !el.disabled
      })),
      keyboard: [...clickableNotFocusable(root), ...unnamed(targets)]
    };
  };

  // Marks one element for a verify check that runs in a forced state (e.g. hover color).
  globalThis.ppStatesMark = function (root, target) {
    const el = target ? globalThis.ppResolveTarget?.(root, target) : root;
    if (!el) return { error: 'The check target was not found inside the selected element.' };
    el.setAttribute('data-pp-state', 'check');
    return { key: 'check' };
  };

  globalThis.ppStatesCleanup = function (keepFrozen = false) {
    for (const el of document.querySelectorAll('[data-pp-state]')) el.removeAttribute('data-pp-state');
    if (!keepFrozen) globalThis.ppStatesFreeze(false);
    return { ok: true };
  };

  // Turns off transitions and animations while measuring, so we read the final state, not a frame of a fade.
  globalThis.ppStatesFreeze = function (on) {
    if (on && !freeze) {
      freeze = document.createElement('style');
      freeze.id = '__pp_freeze';
      freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      document.head.appendChild(freeze);
    } else if (!on && freeze) { freeze.remove(); freeze = null; }
    return { frozen: !!freeze };
  };

  globalThis.ppStatesDisabled = function (key, on) {
    const el = document.querySelector(`[data-pp-state="${key}"]`);
    if (!el) return { error: 'Element not found.' };
    el.disabled = !!on;
    return { disabled: el.disabled };
  };

  // Everything we compare between states.
  globalThis.ppStatesSnapshot = function (root, key) {
    const el = document.querySelector(`[data-pp-state="${key}"]`);
    if (!el) return { error: 'Element not found.' };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const styles = Object.fromEntries(STYLE_PROPS.map((p) => [p, cs.getPropertyValue(p)]));
    // Positions of the other things in the block, to catch hover "jumps".
    const others = [...root.querySelectorAll('*')].slice(0, 300).filter((e) => e !== el && !el.contains(e) && !e.contains(el) && !isOurs(e))
      .map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(','); });
    const hasText = (el.innerText || el.value || '').trim().length > 0;
    return {
      styles,
      box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      others,
      contrast: hasText && globalThis.ppContrast ? globalThis.ppContrast(el) : null
    };
  };
})();