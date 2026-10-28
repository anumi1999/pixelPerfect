// Runs in the PAGE's main world (not the isolated content-script world),
// so it can read framework data React/Vue attach to DOM nodes.
// content.js asks for data via a DOM event and gets a synchronous reply.
(() => {
  if (window.__ppMainLoaded) return;
  window.__ppMainLoaded = true;

  const HTML_TAGS = new Set(['div', 'span', 'p', 'a', 'button', 'input', 'form', 'ul', 'li', 'img',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'main', 'nav',
    'label', 'select', 'textarea', 'svg']);

  const safe = (v) => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return v.slice(0, 120);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    try { return JSON.stringify(v).slice(0, 80); } catch { return '[object]'; }
  };

  const props = (p) => {
    const out = {};
    if (!p || typeof p !== 'object') return out;
    for (const [k, v] of Object.entries(p)) {
      if (k === 'children' || typeof v === 'function') continue;
      out[k] = safe(v);
      if (Object.keys(out).length >= 15) break;
    }
    return out;
  };

  const nameOf = (t) => {
    if (!t) return null;
    if (typeof t === 'function') return t.displayName || t.name || null;
    if (typeof t === 'object') {
      return t.displayName || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name || null;
    }
    return null;
  };

  function react(el) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (!key) return null;
    const comps = [];
    let source = null;
    let fiber = el[key];
    for (let d = 0; fiber && d < 25 && comps.length < 8; d++) {
      if (!source && fiber._debugSource) {
        const s = fiber._debugSource;
        source = `${s.fileName}:${s.lineNumber}`;
      }
      const n = nameOf(fiber.type);
      if (n && !HTML_TAGS.has(n.toLowerCase())) comps.push({ name: n, props: props(fiber.memoizedProps) });
      fiber = fiber.return;
    }
    return {
      framework: 'react',
      component: comps[0]?.name || null,
      props: comps[0]?.props || null,
      tree: comps.map((c) => c.name).join(' → '),
      source
    };
  }

  function vue(el) {
    for (let n = el; n; n = n.parentElement) {
      if (n.__vueParentComponent) {
        const t = n.__vueParentComponent.type || {};
        return { framework: 'vue', component: t.name || t.__name || null, props: props(n.__vueParentComponent.props), source: t.__file || null };
      }
      if (n.__vue__) {
        const vm = n.__vue__;
        return { framework: 'vue', component: vm.$options?.name || null, props: props(vm.$props), source: vm.$options?.__file || null };
      }
    }
    return null;
  }

  window.addEventListener('pp:inspect', () => {
    const el = document.querySelector('[data-pp-inspect]');
    let result = null;
    try { if (el) result = react(el) || vue(el); } catch { result = null; }
    window.dispatchEvent(new CustomEvent('pp:inspect-result', { detail: JSON.stringify(result) }));
  });
})();
