// pixelPerfect content script: the agent's EYES and live-preview HANDS in the page.
// Runs in the isolated world. Framework data comes from page-main.js via DOM events.
if (!window.__ppContentLoaded) {
  window.__ppContentLoaded = true;

  let selection = [];           // elements the developer picked (index 0 = first)
  let baseline = [];            // nearby element positions at selection time (regression warnings)
  const undoStack = [];         // preview actions: { kind: 'inline', el, prev } | { kind: 'sheet', prev }
  const originals = new Map();  // element → its style attribute before any preview
  let sheet = null;             // <style> for stylesheet previews
  let showingOriginal = false;
  let savedPreview = null;      // state stashed while showing the original

  // ── Messages from the side panel ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'PP_PICK') { sendBridgeHint(); startPicking(); reply({ ok: true }); return; }
    if (msg.type === 'PP_PREVIEW_MODE') { reply(setPreviewMode(msg.mode)); return; }
    if (msg.type === 'PP_DISCARD') { reply(discardAll()); return; }
    if (msg.type === 'PP_CLEAR_SELECTION') { reply(clearSelection()); return; }
    if (msg.type === 'PP_MARKERS') { markersHidden = !msg.visible; placeMarkers(); reply({ ok: true }); return; }
    if (msg.type === 'PP_ELEMENT_BOX') {
      const el = selection[0];
      if (!el?.isConnected) { reply(null); return; }
      const r = el.getBoundingClientRect();
      reply({ x: r.left, y: r.top, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight });
      return;
    }
    if (msg.type === 'PP_TOOL') {
      try { reply(runTool(msg.name, msg.args || {})); }
      catch (err) { reply({ error: String(err.message || err) }); }
    }
  });

  function runTool(name, args) {
    if (name === 'get_selection') return { elements: selection.map(describe) };
    if (!selection.length || !selection.every((e) => e.isConnected)) return { error: 'No element selected (or the page changed). Ask the developer to pick again.' };
    if (showingOriginal) setPreviewMode('changes');
    const el = pick(args.element);
    if (!el && name !== 'preview_stylesheet' && name !== 'undo_preview' && name !== 'verify') {
      return { error: `No selected element with index ${args.element}. Valid: 0–${selection.length - 1}.` };
    }
    switch (name) {
      case 'inspect_element': return inspect(el);
      case 'get_structure': return structure(el, args.depth);
      case 'get_matched_rules': return matchedRules(el);
      case 'get_features': return features(el);
      case 'get_component': return component(el);
      case 'preview_css': return previewCss(el, args.css);
      case 'preview_stylesheet': return previewStylesheet(args.css);
      case 'undo_preview': return undoPreview();
      case 'verify': return globalThis.ppVerify
        ? globalThis.ppVerify(selection, args.checks, baseline)
        : { error: 'verify.js is not loaded. Pick the element again.' };
      default: return { error: `Unknown tool: ${name}` };
    }
  }

  const pick = (i) => selection[i ?? 0] || null;

  // The pixelPerfect Vite plugin puts the bridge address and token in a meta tag (dev only).
  // The side panel decides whether to trust it (only for pages served from this machine).
  function sendBridgeHint() {
    const meta = document.querySelector('meta[name="pixelperfect-bridge"]');
    if (meta?.content) chrome.runtime.sendMessage({ type: 'PP_BRIDGE_HINT', value: meta.content });
  }

  // ── Element picker ──────────────────────────────────────────────────────────
  // Click: select. Shift+click: add to selection and keep picking.
  // ↑ / ↓ while hovering: grow to the parent / shrink back. Enter: select the highlighted one. Esc: stop.
  let overlay = null, label = null, hoverStack = [];
  const hovered = () => hoverStack[hoverStack.length - 1];

  function startPicking() {
    stopPicking();
    overlay = box('#6d5efc', 'rgba(109,94,252,0.12)');
    label = document.createElement('div');
    label.id = '__pp_label';
    Object.assign(label.style, {
      position: 'fixed', zIndex: 2147483647, pointerEvents: 'none', font: '12px/1.4 system-ui, sans-serif',
      background: '#1d1d22', color: '#fff', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap'
    });
    document.documentElement.append(overlay, label);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function stopPicking() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay?.remove(); label?.remove();
    overlay = label = null;
    hoverStack = [];
  }

  function box(border, fill) {
    const d = document.createElement('div');
    d.id = '__pp_box';
    Object.assign(d.style, { position: 'fixed', pointerEvents: 'none', zIndex: 2147483646, border: `2px solid ${border}`, background: fill, borderRadius: '3px' });
    return d;
  }

  function drawHover() {
    const el = hovered();
    if (!el || !overlay) return;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
    const d = describe(el);
    label.textContent = `${d.tag}${d.classes.length ? '.' + d.classes.slice(0, 2).join('.') : ''}  ${d.size}   ↑ parent · Shift+click add`;
    Object.assign(label.style, { top: `${Math.max(0, r.top - 24)}px`, left: `${Math.max(0, r.left)}px` });
  }

  const isOurs = (el) => el?.id?.startsWith('__pp');

  function onMove(e) {
    if (isOurs(e.target)) return;
    if (hoverStack[0] !== e.target) hoverStack = [e.target];
    drawHover();
  }

  function onKey(e) {
    if (e.key === 'Escape') { stopPicking(); return; }
    if (e.key === 'ArrowUp' && hovered()?.parentElement && hovered().parentElement !== document.documentElement) {
      e.preventDefault(); hoverStack.push(hovered().parentElement); drawHover();
    }
    if (e.key === 'ArrowDown' && hoverStack.length > 1) { e.preventDefault(); hoverStack.pop(); drawHover(); }
    if (e.key === 'Enter' && hovered()) { e.preventDefault(); choose(hovered(), false); }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = hoverStack.length > 1 ? hovered() : e.target;
    if (isOurs(el)) return;
    choose(el, e.shiftKey);
  }

  function choose(el, add) {
    if (add) {
      if (!selection.includes(el)) selection.push(el);
    } else {
      discardAll();
      selection = [el];
    }
    baseline = globalThis.ppBaseline ? globalThis.ppBaseline(selection) : [];
    drawMarkers();
    if (!add) stopPicking();
    chrome.runtime.sendMessage({ type: 'PP_SELECTED', elements: selection.map(describe), picking: add });
  }

  // Numbered outlines on selected elements, kept in place while scrolling.
  let markers = [];
  let markersHidden = false;   // hidden while the side panel takes before/after screenshots
  function drawMarkers() {
    markers.forEach((m) => m.remove());
    markers = selection.map((el, i) => {
      const m = box('#1f9d55', 'transparent');
      m.id = '__pp_marker';
      const tag = document.createElement('span');
      tag.textContent = String(i);
      Object.assign(tag.style, { position: 'absolute', top: '-10px', left: '-10px', background: '#1f9d55', color: '#fff', font: '11px/18px system-ui', width: '18px', textAlign: 'center', borderRadius: '9px' });
      m.appendChild(tag);
      document.documentElement.appendChild(m);
      return m;
    });
    placeMarkers();
  }
  function placeMarkers() {
    selection.forEach((el, i) => {
      const m = markers[i];
      if (!m) return;
      const r = el.getBoundingClientRect();
      Object.assign(m.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, display: showingOriginal || markersHidden ? 'none' : 'block' });
    });
  }
  // Removes the numbered outlines and forgets the selection. Live previews are left as they are.
  function clearSelection() {
    stopPicking();
    markers.forEach((m) => m.remove());
    markers = [];
    selection = [];
    baseline = [];
    return { cleared: true };
  }

  addEventListener('scroll', () => requestAnimationFrame(placeMarkers), true);
  addEventListener('resize', () => requestAnimationFrame(placeMarkers));

  // ── Tools ───────────────────────────────────────────────────────────────────
  function describe(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      index: selection.indexOf(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList].slice(0, 6),
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      children: el.children.length,
      source: el.closest('[data-pp-src]')?.getAttribute('data-pp-src') || null
    };
  }

  const KEY_PROPS = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap',
    'grid-template-columns', 'top', 'right', 'bottom', 'left', 'z-index', 'overflow',
    'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'color',
    'background-color', 'border-top-width', 'border-top-color', 'border-radius', 'box-shadow',
    'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'visibility', 'transform'];
  const DEFAULTS = new Set(['none', 'auto', 'normal', '0px', 'visible', 'static', 'rgba(0, 0, 0, 0)', 'nowrap', 'row', 'stretch', '1']);

  function keyStyles(el) {
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of KEY_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && !DEFAULTS.has(v.trim())) styles[p] = v;
    }
    return styles;
  }

  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; };

  function inspect(el) {
    const parent = el.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    return {
      element: describe(el),
      box: rectOf(el),
      styles: keyStyles(el),
      inlineStyle: el.getAttribute('style') || null,
      parent: parent ? {
        tag: parent.tagName.toLowerCase(), classes: [...parent.classList].slice(0, 4),
        display: pcs.display, flexDirection: pcs.flexDirection, justifyContent: pcs.justifyContent,
        alignItems: pcs.alignItems, gap: pcs.gap, box: rectOf(parent)
      } : null,
      viewport: { width: innerWidth, height: innerHeight },
      html: el.outerHTML.slice(0, 600)
    };
  }

  // Outline of everything inside an element: what a redesign needs to understand a block.
  function structure(root, depth = 4) {
    const lines = [];
    const maxDepth = Math.min(Math.max(depth, 1), 8);
    const walk = (el, d) => {
      if (lines.length >= 120 || isOurs(el)) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      const cls = [...el.classList].slice(0, 2).join('.');
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 40);
      lines.push(`${'  '.repeat(d)}${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${own ? ` "${own}"` : ''}  ${Math.round(r.width)}×${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}${cs.display.includes('flex') ? ` flex-${cs.flexDirection}` : ''}${cs.display === 'grid' ? ' grid' : ''}`);
      if (d < maxDepth) for (const c of el.children) walk(c, d + 1);
    };
    walk(root, 0);
    return { lines, truncated: lines.length >= 120 };
  }

  // What a design match needs: visible texts, class names, component name and size.
  function features(el) {
    const texts = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && texts.size < 40) {
      const t = walker.currentNode.textContent.replace(/\s+/g, ' ').trim();
      const parent = walker.currentNode.parentElement;
      if (t && parent && getComputedStyle(parent).display !== 'none') texts.add(t.slice(0, 80));
    }
    // Whole text of small inline groups too (e.g. "1–3 of 3" split across nodes).
    for (const e of [el, ...el.querySelectorAll('*')].slice(0, 200)) {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 40 && e.children.length && texts.size < 60) texts.add(t);
    }
    const classes = new Set();
    for (const e of [el, ...el.querySelectorAll('[class]')].slice(0, 60)) e.classList.forEach((c) => classes.add(c));
    const r = el.getBoundingClientRect();
    return { texts: [...texts], classes: [...classes].slice(0, 40), component: component(el).component || null, width: Math.round(r.width), height: Math.round(r.height) };
  }

  // Which stylesheet rules apply to the element, and which file each came from.
  function matchedRules(el, limit = 12) {
    const found = [];
    const visit = (rules, source, condition) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          let ok = false;
          try { ok = el.matches(rule.selectorText); } catch { ok = false; }
          if (ok && !rule.selectorText.trim().startsWith('*')) {
            found.push({ selector: rule.selectorText.slice(0, 150), source, condition, declarations: rule.style.cssText.slice(0, 300) });
          }
        } else if (rule instanceof CSSMediaRule) {
          const text = rule.conditionText || rule.media.mediaText;
          if (matchMedia(text).matches) visit(rule.cssRules, source, `@media ${text}`);
        } else if (rule.cssRules) {
          visit(rule.cssRules, source, rule.conditionText ? `${rule.constructor.name} ${rule.conditionText}` : condition);
        }
      }
    };
    for (const s of document.styleSheets) {
      let rules;
      try { rules = s.cssRules; } catch { continue; }
      const owner = s.ownerNode;
      if (owner?.id?.startsWith('__pp')) continue;
      const source = owner?.dataset?.viteDevId || (s.href ? s.href.split('?')[0] : '<style> tag');
      visit(rules, source, null);
    }
    return {
      note: 'Source order: later rules win when specificity is equal. Inline style beats all non-!important rules.',
      inlineStyle: el.getAttribute('style') || null,
      rules: found.slice(-limit)
    };
  }

  function component(el) {
    let result = null;
    const onResult = (e) => { try { result = JSON.parse(e.detail); } catch { result = null; } };
    window.addEventListener('pp:inspect-result', onResult, { once: true });
    el.setAttribute('data-pp-inspect', '');
    try { window.dispatchEvent(new CustomEvent('pp:inspect')); }
    finally {
      el.removeAttribute('data-pp-inspect');
      window.removeEventListener('pp:inspect-result', onResult);
    }
    const srcAttr = el.closest('[data-pp-src]')?.getAttribute('data-pp-src') || null;
    return result
      ? { ...result, source: srcAttr || result.source }
      : { framework: null, component: null, source: srcAttr, note: 'No React/Vue data found on this element.' };
  }

  // ── Previews ────────────────────────────────────────────────────────────────
  // Inline declarations on one selected element, e.g. "padding: 24px; font-weight: 600".
  function previewCss(el, css) {
    if (!css || typeof css !== 'string') return { error: 'preview_css needs a "css" string of declarations.' };
    if (!originals.has(el)) originals.set(el, el.getAttribute('style'));
    const prev = el.getAttribute('style');
    const tmp = document.createElement('div');
    tmp.style.cssText = css;
    const applied = [];
    for (let i = 0; i < tmp.style.length; i++) {
      const prop = tmp.style[i];
      const val = tmp.style.getPropertyValue(prop);
      el.style.setProperty(prop, val, 'important');
      applied.push(`${prop}: ${val}`);
    }
    if (!applied.length) return { error: `Could not parse any CSS declarations from: ${css}` };
    undoStack.push({ kind: 'inline', el, prev });
    return { applied, previewSteps: undoStack.length, after: keyStyles(el) };
  }

  // A whole stylesheet with real selectors: for redesigning a block of many elements.
  function previewStylesheet(css) {
    if (!css || typeof css !== 'string') return { error: 'preview_stylesheet needs a "css" string with selectors and rules.' };
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = '__pp_preview_sheet';
      document.head.appendChild(sheet);
    }
    const prev = sheet.textContent;
    sheet.textContent = prev ? `${prev}\n${css}` : css;
    const rules = sheet.sheet ? sheet.sheet.cssRules.length : 0;
    // Report which selectors actually match something, so typos are caught.
    const report = [];
    const inner = sheet.sheet ? [...sheet.sheet.cssRules].slice(-50) : [];
    for (const r of inner) {
      if (r.selectorText) {
        let n = 0;
        try { n = document.querySelectorAll(r.selectorText).length; } catch { n = -1; }
        report.push(`${r.selectorText} → ${n < 0 ? 'invalid selector' : `${n} element${n === 1 ? '' : 's'}`}`);
      }
    }
    undoStack.push({ kind: 'sheet', prev });
    return { applied: true, rulesInPreviewSheet: rules, matches: report.slice(-20), previewSteps: undoStack.length };
  }

  function undoPreview() {
    const last = undoStack.pop();
    if (!last) return { message: 'Nothing to undo.' };
    if (last.kind === 'inline') restoreStyle(last.el, last.prev);
    else if (sheet) sheet.textContent = last.prev;
    return { message: `Reverted the last ${last.kind === 'sheet' ? 'stylesheet' : 'inline'} preview.`, previewSteps: undoStack.length };
  }

  function restoreStyle(el, value) {
    if (value === null || value === undefined) el.removeAttribute('style'); else el.setAttribute('style', value);
  }

  // Side panel buttons: flip between the original page and the agent's changes.
  function setPreviewMode(mode) {
    if (mode === 'original' && !showingOriginal) {
      savedPreview = { inline: new Map([...originals.keys()].map((el) => [el, el.getAttribute('style')])) };
      originals.forEach((orig, el) => restoreStyle(el, orig));
      if (sheet) sheet.disabled = true;
      showingOriginal = true;
    } else if (mode === 'changes' && showingOriginal) {
      savedPreview?.inline.forEach((val, el) => restoreStyle(el, val));
      if (sheet) sheet.disabled = false;
      showingOriginal = false;
    }
    placeMarkers();
    return { mode: showingOriginal ? 'original' : 'changes', hasChanges: undoStack.length > 0 };
  }

  function discardAll() {
    if (showingOriginal) setPreviewMode('changes');
    originals.forEach((orig, el) => restoreStyle(el, orig));
    originals.clear();
    sheet?.remove();
    sheet = null;
    undoStack.length = 0;
    return { message: 'All preview changes discarded.' };
  }
}