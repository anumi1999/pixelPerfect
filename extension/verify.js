// pixelPerfect verification: measures the live page and returns pass/fail with real numbers.
// Loaded into the page before content.js. Exposes globalThis.ppVerify and globalThis.ppBaseline.
//
// Check types (each check is an object with a `type`):
//   css       { property, expected, tolerance_px? }          a computed style equals a value
//   centered  { axis?: horizontal|vertical|both, of?: self|children, grouped?: true, tolerance_px? }
//             of=children also requires the children to sit together (set grouped:false to skip)
//   size      { width?, height?, tolerance_px? }              rendered size in px
//   spacing   { expected_px?, axis?, tolerance_px? }          gaps between children (equal, or equal to a value)
//   aligned   { edge: top|bottom|left|right|center-x|center-y, tolerance_px? }  children share an edge
//   visible   {}                                              shown, has size, in view, not covered
//   no_overflow {}                                            content not cut off, element fits its parent
//   lines     { expected, min_viewport? }                     text wraps onto at most `expected` lines (skipped below min_viewport px)
//   contrast  { min_ratio? }                                  text contrast (WCAG), default 4.5 / 3 for large text
// Any check may add `target: { text }` or `target: { selector }` to check a descendant of the selected element.
(() => {
  const DEFAULT_TOL = 2;
  const px = (v) => Math.round(v * 10) / 10;
  const num = (v) => parseFloat(v) || 0;

  // ── Target resolution ──────────────────────────────────────────────────────
  function resolveTarget(root, target) {
    if (!target) return { el: root, label: 'selected element' };
    if (target.selector) {
      let el = null;
      try { el = root.matches(target.selector) ? root : root.querySelector(target.selector); } catch { el = null; }
      return { el, label: target.selector };
    }
    if (target.text) {
      // Compared loosely: case, spacing, quotes, arrows and other symbols ignored (Figma often has "View ↗"
      // where the page draws the arrow as an icon).
      const loose = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}%$.,]+/gu, ' ').replace(/\s+/g, ' ').trim();
      const want = loose(target.text);
      if (!want) return { el: null, label: `"${target.text}"` };
      // Deepest element whose own text contains the wanted text.
      const all = [root, ...root.querySelectorAll('*')].filter((e) => loose(e.innerText || e.textContent || '').includes(want));
      const el = all.find((e) => ![...e.children].some((c) => loose(c.innerText || c.textContent || '').includes(want))) || all[0] || null;
      return { el, label: `"${target.text}"` };
    }
    return { el: root, label: 'selected element' };
  }

  // ── Value normalization ────────────────────────────────────────────────────
  const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, light: 300, normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };

  function normalizeColor(value) {
    const probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = value;
    if (!probe.style.color) return null;           // not a color
    probe.style.display = 'none';
    document.documentElement.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }

  const parseRgb = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };

  function compareValues(property, actual, expected, tol) {
    const a = String(actual).trim().toLowerCase();
    const e = String(expected).trim().toLowerCase();
    if (a === e) return true;

    if (property.includes('color')) {
      const ac = parseRgb(a), ec = parseRgb(normalizeColor(expected) || '');
      if (ac && ec) return Math.abs(ac.r - ec.r) <= 2 && Math.abs(ac.g - ec.g) <= 2 && Math.abs(ac.b - ec.b) <= 2 && Math.abs(ac.a - ec.a) <= 0.02;
    }
    if (property === 'font-weight') {
      const toW = (v) => WEIGHTS[v.replace(/[\s-]/g, '')] ?? Number(v);
      return toW(a) === toW(e);
    }
    // Numeric lists like "16px 24px" vs "16px 24px 16px 24px", or single numbers.
    const an = a.match(/-?\d*\.?\d+/g), en = e.match(/-?\d*\.?\d+/g);
    if (an && en && /^[\d.\s\-a-z%]+$/.test(a) && /^[\d.\s\-a-z%]+$/.test(e)) {
      const expand = (l) => (l.length === 1 ? [l[0], l[0], l[0], l[0]] : l.length === 2 ? [l[0], l[1], l[0], l[1]] : l.length === 3 ? [l[0], l[1], l[2], l[1]] : l);
      const A = expand(an.map(Number)), E = expand(en.map(Number));
      if (A.length === E.length) return A.every((v, i) => Math.abs(v - E[i]) <= tol);
    }
    return false;
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────
  function contentBox(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left + num(cs.borderLeftWidth) + num(cs.paddingLeft),
      right: r.right - num(cs.borderRightWidth) - num(cs.paddingRight),
      top: r.top + num(cs.borderTopWidth) + num(cs.paddingTop),
      bottom: r.bottom - num(cs.borderBottomWidth) - num(cs.paddingBottom)
    };
  }

  function visibleChildren(el) {
    return [...el.children].filter((c) => {
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'absolute' && cs.position !== 'fixed' && r.width > 0 && r.height > 0;
    });
  }

  function union(rects) {
    return rects.reduce((u, r) => ({
      left: Math.min(u.left, r.left), right: Math.max(u.right, r.right),
      top: Math.min(u.top, r.top), bottom: Math.max(u.bottom, r.bottom)
    }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  }

  // ── Individual checks ──────────────────────────────────────────────────────
  const checks = {
    css(el, c) {
      if (!c.property) return fail('css check needs a property');
      const tol = c.tolerance_px ?? 1;
      const actual = getComputedStyle(el).getPropertyValue(c.property).trim();
      const pass = compareValues(c.property, actual, c.expected, tol);
      return { pass, expected: c.expected, actual, summary: `${c.property}: expected ${c.expected}, actual ${actual || '(empty)'}` };
    },

    centered(el, c) {
      const tol = c.tolerance_px ?? DEFAULT_TOL;
      const axis = c.axis || 'horizontal';
      const of = c.of || 'self';
      let inner, outer;
      const parts = [];
      let pass = true;
      if (of === 'children') {
        const kids = visibleChildren(el);
        if (!kids.length) return fail('no visible children to center');
        const rects = kids.map((k) => k.getBoundingClientRect());
        inner = union(rects);
        outer = contentBox(el);
        // The group must sit together: gaps between children may not exceed the CSS gap.
        // Otherwise `justify-content: space-between` would look "centered" (0px gap on both ends).
        if (c.grouped !== false && rects.length > 1) {
          const cs = getComputedStyle(el);
          const horizontal = axis !== 'vertical';
          const sorted = [...rects].sort((a, b) => (horizontal ? a.left - b.left : a.top - b.top));
          const sameLine = sorted.slice(1).every((r, i) => (horizontal ? r.left >= sorted[i].right - 1 : r.top >= sorted[i].bottom - 1));
          if (sameLine) {
            const cssGap = num(horizontal ? cs.columnGap : cs.rowGap);
            const gaps = sorted.slice(1).map((r, i) => (horizontal ? r.left - sorted[i].right : r.top - sorted[i].bottom));
            const widest = Math.max(...gaps);
            if (widest > cssGap + tol + 1) {
              pass = false;
              parts.push(`children are spread apart (widest gap ${px(widest)}px, CSS gap ${px(cssGap)}px), not grouped`);
            }
          }
        }
      } else {
        if (!el.parentElement) return fail('element has no parent');
        inner = el.getBoundingClientRect();
        outer = contentBox(el.parentElement);
      }
      if (axis === 'horizontal' || axis === 'both') {
        const l = inner.left - outer.left, r = outer.right - inner.right;
        if (Math.abs(l - r) > tol) pass = false;
        parts.push(`left gap ${px(l)}px, right gap ${px(r)}px`);
      }
      if (axis === 'vertical' || axis === 'both') {
        const t = inner.top - outer.top, b = outer.bottom - inner.bottom;
        if (Math.abs(t - b) > tol) pass = false;
        parts.push(`top gap ${px(t)}px, bottom gap ${px(b)}px`);
      }
      return { pass, expected: `equal gaps (±${tol}px)`, actual: parts.join('; '), summary: `centered ${axis} (${of}): ${parts.join('; ')}` };
    },

    size(el, c) {
      const tol = c.tolerance_px ?? DEFAULT_TOL;
      const r = el.getBoundingClientRect();
      const parts = [];
      let pass = true;
      if (c.width != null) { if (Math.abs(r.width - c.width) > tol) pass = false; parts.push(`width ${px(r.width)}px (expected ${c.width})`); }
      if (c.height != null) { if (Math.abs(r.height - c.height) > tol) pass = false; parts.push(`height ${px(r.height)}px (expected ${c.height})`); }
      if (!parts.length) return fail('size check needs width and/or height');
      return { pass, expected: { width: c.width, height: c.height }, actual: { width: px(r.width), height: px(r.height) }, summary: `size: ${parts.join(', ')}` };
    },

    spacing(el, c) {
      const tol = c.tolerance_px ?? DEFAULT_TOL;
      const kids = visibleChildren(el);
      if (kids.length < 2) return fail('spacing needs at least 2 visible children');
      const cs = getComputedStyle(el);
      const axis = c.axis || (cs.display.includes('flex') && cs.flexDirection.startsWith('column') ? 'vertical' : (cs.display.includes('flex') || cs.display.includes('grid') ? 'horizontal' : 'vertical'));
      const rects = kids.map((k) => k.getBoundingClientRect())
        .sort((a, b) => (axis === 'horizontal' ? a.left - b.left : a.top - b.top));
      const gaps = rects.slice(1).map((r, i) => px(axis === 'horizontal' ? r.left - rects[i].right : r.top - rects[i].bottom));
      const pass = c.expected_px != null
        ? gaps.every((g) => Math.abs(g - c.expected_px) <= tol)
        : Math.max(...gaps) - Math.min(...gaps) <= tol;
      const expected = c.expected_px != null ? `${c.expected_px}px` : 'equal gaps';
      return { pass, expected, actual: gaps, summary: `spacing ${axis}: gaps [${gaps.join(', ')}]px, expected ${expected}` };
    },

    aligned(el, c) {
      const tol = c.tolerance_px ?? DEFAULT_TOL;
      const kids = visibleChildren(el);
      if (kids.length < 2) return fail('aligned needs at least 2 visible children');
      const edge = c.edge || 'center-y';
      const val = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, 'center-x': (r.left + r.right) / 2, 'center-y': (r.top + r.bottom) / 2 })[edge];
      const vals = kids.map((k) => px(val(k.getBoundingClientRect())));
      const spread = px(Math.max(...vals) - Math.min(...vals));
      return { pass: spread <= tol, expected: `same ${edge} (±${tol}px)`, actual: vals, summary: `aligned ${edge}: spread ${spread}px across ${vals.length} children` };
    },

    visible(el) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const problems = [];
      if (cs.display === 'none') problems.push('display: none');
      if (cs.visibility === 'hidden') problems.push('visibility: hidden');
      if (num(cs.opacity) === 0) problems.push('opacity: 0');
      if (r.width === 0 || r.height === 0) problems.push(`zero size (${px(r.width)}×${px(r.height)})`);
      const inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      if (!inView) problems.push('outside the viewport');
      if (!problems.length) {
        // Test the centre of the part that is on screen (a tall block's own centre may be off screen).
        const cx = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2;
        const cy = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
        const hit = document.elementFromPoint(cx, cy);
        // <html>/<body> can't cover a descendant; they show up when the point isn't hit-testable (e.g. pointer-events: none).
        const root = hit === document.documentElement || hit === document.body;
        if (hit && !root && hit !== el && !el.contains(hit) && !hit.id?.startsWith('__pp')) {
          problems.push(`covered by <${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? '.' + hit.className.trim().split(/\s+/).join('.') : ''}>`);
        }
      }
      return { pass: problems.length === 0, expected: 'visible and clickable', actual: problems.length ? problems : 'visible', summary: problems.length ? `visible: ${problems.join(', ')}` : 'visible: shown, in view, not covered' };
    },

    lines(el, c) {
      const want = Math.max(1, Math.round(num(c.expected) || 1));
      if (c.min_viewport && innerWidth < c.min_viewport) {
        return { pass: true, expected: `≤ ${want} line(s)`, actual: 'skipped', summary: `lines: not checked below ${c.min_viewport}px (screen is ${innerWidth}px)` };
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = [];
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        if (!tops.some((t) => Math.abs(t - r.top) < Math.max(3, r.height / 2))) tops.push(r.top);
      }
      const n = tops.length || 1;
      return { pass: n <= want, expected: `≤ ${want} line(s)`, actual: n, summary: `lines: expected ≤ ${want}, actual ${n}` };
    },

    no_overflow(el) {
      const problems = [];
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') problems.push(`content cut off horizontally (${el.scrollWidth}px in ${el.clientWidth}px)`);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') problems.push(`content spills out horizontally (${el.scrollWidth}px in ${el.clientWidth}px)`);
      if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible') problems.push(`content cut off vertically (${el.scrollHeight}px in ${el.clientHeight}px)`);
      const p = el.parentElement;
      if (p) {
        const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1) problems.push(`sticks out of its parent horizontally (${px(r.left - pr.left)}px left, ${px(pr.right - r.right)}px right)`);
      }
      return { pass: problems.length === 0, expected: 'fits without overflow', actual: problems.length ? problems : 'fits', summary: problems.length ? `overflow: ${problems.join('; ')}` : 'no overflow' };
    },

    contrast(el, c) {
      const cs = getComputedStyle(el);
      const fg = parseRgb(cs.color);
      let bg = null;
      for (let n = el; n; n = n.parentElement) {
        const b = parseRgb(getComputedStyle(n).backgroundColor);
        if (b && b.a > 0.5) { bg = b; break; }
      }
      bg = bg || { r: 255, g: 255, b: 255, a: 1 };
      const lum = ({ r, g, b }) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
      const large = num(cs.fontSize) >= 24 || (num(cs.fontSize) >= 18.66 && num(cs.fontWeight) >= 700);
      const min = c.min_ratio ?? (large ? 3 : 4.5);
      return { pass: ratio >= min, expected: `≥ ${min}:1`, actual: `${ratio}:1`, summary: `contrast ${ratio}:1 (needs ${min}:1${large ? ', large text' : ''})` };
    }
  };

  function fail(reason) { return { pass: false, expected: null, actual: null, summary: reason, error: true }; }

  // ── Regression baseline: where nearby elements were when the developer picked ─
  function neighbors(selectedList) {
    const out = new Set();
    const inside = (e) => selectedList.some((s) => s === e || s.contains(e) || e.contains(s));
    for (const selected of selectedList) {
      let node = selected;
      for (let level = 0; level < 3 && node?.parentElement; level++) {
        for (const sib of node.parentElement.children) {
          if (!inside(sib) && !sib.id?.startsWith('__pp') && out.size < 60) out.add(sib);
        }
        node = node.parentElement;
      }
    }
    return [...out];
  }

  const describeEl = (e) => `<${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}>`;

  globalThis.ppBaseline = function (selected) {
    const list = Array.isArray(selected) ? selected : [selected];
    return neighbors(list).map((e) => ({ el: e, rect: e.getBoundingClientRect() }));
  };

  // ── Entry point ────────────────────────────────────────────────────────────
  // `selected` is the list of picked elements; each check may name one with `element` (index, default 0).
  globalThis.ppVerify = function (selected, list, baseline) {
    const roots = Array.isArray(selected) ? selected : [selected];
    if (!Array.isArray(list) || !list.length) return { error: 'verify needs a non-empty "checks" array.' };
    const results = list.map((c) => {
      const root = roots[c.element ?? 0];
      if (!root) return { type: c.type, target: `element ${c.element}`, pass: false, summary: `no selected element with index ${c.element}` };
      const picked = resolveTarget(root, c.target);
      const el = picked.el;
      const label = roots.length > 1 ? `#${c.element ?? 0} ${picked.label}` : picked.label;
      if (!el) return { type: c.type, target: label, pass: false, summary: `target ${label} not found inside the selected element` };
      const fn = checks[c.type];
      if (!fn) return { type: c.type, target: label, pass: false, summary: `unknown check type "${c.type}"` };
      try { return { type: c.type, target: label, ...fn(el, c) }; }
      catch (err) { return { type: c.type, target: label, pass: false, summary: `check failed to run: ${err.message}` }; }
    });

    // Regression warnings: nearby elements that moved or resized since selection.
    const warnings = [];
    for (const { el, rect } of baseline || []) {
      if (!el.isConnected) continue;
      const now = el.getBoundingClientRect();
      const dx = px(now.left - rect.left), dy = px(now.top - rect.top);
      const dw = px(now.width - rect.width), dh = px(now.height - rect.height);
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)) > DEFAULT_TOL) {
        warnings.push(`${describeEl(el)} changed: moved ${dx},${dy}px, size ${dw >= 0 ? '+' : ''}${dw}×${dh >= 0 ? '+' : ''}${dh}px`);
      }
      if (warnings.length >= 8) break;
    }

    const allPass = results.every((r) => r.pass);
    return {
      allPass,
      viewport: `${innerWidth}×${innerHeight}`,
      results: results.map((r) => ({ ...r, line: `${r.pass ? '✓' : '✗'} [${r.target}] ${r.summary}` })),
      warnings,
      note: warnings.length ? 'Nearby elements changed since selection. Confirm these changes are intended (e.g. a size change pushing siblings) and not a regression.' : undefined
    };
  };
})();