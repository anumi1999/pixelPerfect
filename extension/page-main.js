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

  // ── Console and network log (for "the button does nothing") ─────────────────
  // Records errors, warnings and requests from the moment pixelPerfect is opened on the page.
  const log = [];
  const push = (entry) => { log.push({ t: performance.now(), ...entry }); if (log.length > 200) log.shift(); };
  const short = (v) => {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === 'string') return v.slice(0, 300);
    try { return JSON.stringify(v).slice(0, 300); } catch { return String(v).slice(0, 300); }
  };
  // The first stack frame from this site's own code: that's where to look.
  const where = (stack) => {
    const lines = String(stack || '').split('\n');
    for (const l of lines) {
      const m = l.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
      if (m && m[1].startsWith(location.origin) && !/node_modules|\.vite\/deps|chrome-extension/.test(m[1])) {
        return `${m[1].slice(location.origin.length).replace(/\?.*$/, '')}:${m[2]}`;
      }
    }
    return null;
  };

  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      push({ kind: 'resource', level: 'error', message: `failed to load ${e.target.tagName.toLowerCase()} ${(e.target.src || e.target.href).slice(0, 200)}` });
    } else {
      push({ kind: 'exception', level: 'error', message: short(e.error || e.message), at: where(e.error?.stack) || (e.filename ? `${e.filename.replace(location.origin, '').replace(/\?.*$/, '')}:${e.lineno}` : null) });
    }
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    push({ kind: 'exception', level: 'error', message: `Unhandled promise rejection: ${short(e.reason)}`, at: where(e.reason?.stack) });
  });
  for (const level of ['error', 'warn']) {
    const orig = console[level];
    console[level] = function (...args) {
      try { push({ kind: 'console', level, message: args.map(short).join(' ').slice(0, 400), at: where(new Error().stack.split('\n').slice(2).join('\n')) }); } catch {}
      return orig.apply(this, args);
    };
  }
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (input, init) {
      const url = String(input?.url || input).slice(0, 200);
      const method = (init?.method || input?.method || 'GET').toUpperCase();
      const t0 = performance.now();
      try {
        const res = await origFetch.apply(this, arguments);
        push({ kind: 'request', level: res.ok ? 'info' : 'error', message: `${method} ${url} → ${res.status}`, status: res.status, ms: Math.round(performance.now() - t0) });
        return res;
      } catch (err) {
        push({ kind: 'request', level: 'error', message: `${method} ${url} → failed (${short(err)})`, ms: Math.round(performance.now() - t0) });
        throw err;
      }
    };
  }
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__pp = { method: String(method).toUpperCase(), url: String(url).slice(0, 200) }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    const t0 = performance.now();
    this.addEventListener('loadend', () => {
      const ok = this.status >= 200 && this.status < 400;
      push({ kind: 'request', level: ok ? 'info' : 'error', message: `${this.__pp?.method} ${this.__pp?.url} → ${this.status || 'failed'}`, status: this.status, ms: Math.round(performance.now() - t0) });
    });
    return XS.apply(this, arguments);
  };

  window.addEventListener('pp:log', (e) => {
    const since = Number(e.detail) || 0;
    window.dispatchEvent(new CustomEvent('pp:log-result', { detail: JSON.stringify({ now: performance.now(), entries: log.filter((x) => x.t >= since) }) }));
  });

  window.addEventListener('pp:inspect', () => {
    const el = document.querySelector('[data-pp-inspect]');
    let result = null;
    try { if (el) result = react(el) || vue(el); } catch { result = null; }
    window.dispatchEvent(new CustomEvent('pp:inspect-result', { detail: JSON.stringify(result) }));
  });
})();