// pixelPerfect content script: the agent's EYES and live-preview HANDS in the page.
// Runs in the isolated world. Framework data comes from page-main.js via DOM events.
if (!window.__ppContentLoaded) {
  window.__ppContentLoaded = true;

  let selected = null;          // the element the developer picked
  const previewStack = [];      // inline-style snapshots for undo
  let overlay = null;

  // ── Messages from the side panel ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'PP_PICK') { startPicking(); reply({ ok: true }); return; }
    if (msg.type === 'PP_TOOL') {
      try { reply(runTool(msg.name, msg.args || {})); }
      catch (err) { reply({ error: String(err.message || err) }); }
    }
  });

  function runTool(name, args) {
    if (name === 'get_selection') return describe(selected);
    if (!selected || !selected.isConnected) return { error: 'No element selected. Ask the developer to pick one.' };
    switch (name) {
      case 'inspect_element': return inspect(selected);
      case 'get_matched_rules': return matchedRules(selected);
      case 'get_component': return component(selected);
      case 'preview_css': return previewCss(args.css);
      case 'undo_preview': return undoPreview();
      default: return { error: `Unknown tool: ${name}` };
    }
  }

  // ── Element picker ──────────────────────────────────────────────────────────
  function startPicking() {
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.id = '__pp_overlay';
    Object.assign(overlay.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: 2147483647,
      border: '2px solid #6d5efc', background: 'rgba(109,94,252,0.12)', borderRadius: '3px'
    });
    document.documentElement.appendChild(overlay);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function stopPicking() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay?.remove();
    overlay = null;
  }

  function onMove(e) {
    if (!overlay || e.target === overlay) return;
    const r = e.target.getBoundingClientRect();
    Object.assign(overlay.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    selected = e.target;
    previewStack.length = 0;
    stopPicking();
    chrome.runtime.sendMessage({ type: 'PP_SELECTED', element: describe(selected) });
  }

  function onKey(e) { if (e.key === 'Escape') stopPicking(); }

  // ── Tools ───────────────────────────────────────────────────────────────────
  function describe(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList].slice(0, 6),
      text: (el.innerText || '').trim().slice(0, 80),
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      source: el.closest('[data-pp-src]')?.getAttribute('data-pp-src') || null
    };
  }

  const KEY_PROPS = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap',
    'grid-template-columns', 'top', 'right', 'bottom', 'left', 'z-index', 'overflow',
    'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'color',
    'background-color', 'border-top-width', 'border-top-color', 'border-radius',
    'opacity', 'visibility', 'transform'];
  const DEFAULTS = new Set(['none', 'auto', 'normal', '0px', 'visible', 'static', 'rgba(0, 0, 0, 0)', 'nowrap', 'row', 'stretch', '1']);

  function inspect(el) {
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of KEY_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && !DEFAULTS.has(v.trim())) styles[p] = v;
    }
    const r = el.getBoundingClientRect();
    const parent = el.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    const pr = parent?.getBoundingClientRect();
    return {
      element: describe(el),
      box: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      styles,
      inlineStyle: el.getAttribute('style') || null,
      parent: parent ? {
        tag: parent.tagName.toLowerCase(),
        classes: [...parent.classList].slice(0, 4),
        display: pcs.display, flexDirection: pcs.flexDirection,
        justifyContent: pcs.justifyContent, alignItems: pcs.alignItems, gap: pcs.gap,
        box: { x: Math.round(pr.left), y: Math.round(pr.top), width: Math.round(pr.width), height: Math.round(pr.height) }
      } : null,
      viewport: { width: innerWidth, height: innerHeight },
      html: el.outerHTML.slice(0, 600)
    };
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
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }        // cross-origin sheet: unreadable
      const owner = sheet.ownerNode;
      if (owner?.id?.startsWith('__pp')) continue;
      const source = owner?.dataset?.viteDevId                     // Vite dev: real file path
        || (sheet.href ? sheet.href.split('?')[0] : '<style> tag');
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

  // Apply CSS declarations live, e.g. "padding: 24px; font-weight: 600".
  function previewCss(css) {
    if (!css || typeof css !== 'string') return { error: 'preview_css needs a "css" string of declarations.' };
    previewStack.push(selected.getAttribute('style'));
    const tmp = document.createElement('div');
    tmp.style.cssText = css;
    const applied = [];
    for (let i = 0; i < tmp.style.length; i++) {
      const prop = tmp.style[i];
      const val = tmp.style.getPropertyValue(prop);
      selected.style.setProperty(prop, val, 'important');
      applied.push(`${prop}: ${val}`);
    }
    if (applied.length === 0) { previewStack.pop(); return { error: `Could not parse any CSS from: ${css}` }; }
    return { applied, previewDepth: previewStack.length, after: inspect(selected).styles };
  }

  function undoPreview() {
    if (previewStack.length === 0) return { message: 'Nothing to undo.' };
    const prev = previewStack.pop();
    if (prev === null) selected.removeAttribute('style'); else selected.setAttribute('style', prev);
    return { message: 'Reverted the last preview.', previewDepth: previewStack.length };
  }
}
