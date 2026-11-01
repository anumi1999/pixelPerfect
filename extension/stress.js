// pixelPerfect "Break it": stress-tests a block of the live page with realistic bad data,
// measures what breaks, and puts everything back. Nothing is written to code.
// Loaded into the page before content.js. Exposes globalThis.ppStress and globalThis.ppStressShow.
//
// Attacks:
//   long_text    every text 2.5× longer (translations, real user content)
//   long_word    an unbroken 40-character word in each text (URLs, emails, IDs)
//   big_numbers  numbers become very large ($84,254.00 → $9,876,584,254.00)
//   empty        all text empty and images missing (no data yet)
//   many_items   the repeated items in a list or grid ×15
//   big_font     text 1.5× bigger (users who enlarge text)
//   narrow       the block squeezed to 320px wide (small screens, sidebars)
//   rtl          right-to-left layout (Arabic, Hebrew)
(() => {
  const ATTACKS = {
    long_text: 'Text 2.5× longer',
    long_word: 'Very long unbroken word',
    big_numbers: 'Very large numbers',
    empty: 'Empty text and missing images',
    many_items: '15× more items',
    big_font: 'Text 1.5× bigger',
    narrow: 'Squeezed to 320px wide',
    rtl: 'Right-to-left layout'
  };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG']);
  const isOurs = (el) => el?.id?.startsWith?.('__pp') || el?.closest?.('[id^="__pp"]');
  const r1 = (v) => Math.round(v);

  // ── Reversible changes ─────────────────────────────────────────────────────
  function recorder() {
    const texts = new Map();   // text node → original data
    const styles = new Map();  // element → original style attribute
    const attrs = [];          // [element, name, original value or null]
    const added = [];          // nodes we inserted
    return {
      text(node, value) { if (!texts.has(node)) texts.set(node, node.data); node.data = value; },
      style(el, prop, value) { if (!styles.has(el)) styles.set(el, el.getAttribute('style')); el.style.setProperty(prop, value, 'important'); },
      attr(el, name, value) { attrs.push([el, name, el.getAttribute(name)]); el.setAttribute(name, value); },
      add(node) { added.push(node); },
      count() { return texts.size + styles.size + attrs.length + added.length; },
      undo() {
        for (const n of added) n.remove();
        for (const [el, name, v] of attrs.reverse()) v === null ? el.removeAttribute(name) : el.setAttribute(name, v);
        for (const [el, v] of styles) v === null ? el.removeAttribute('style') : el.setAttribute('style', v);
        for (const [node, v] of texts) node.data = v;
      }
    };
  }

  function textNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || SKIP.has(p.tagName) || p.closest('svg') || isOurs(p)) return NodeFilter.FILTER_REJECT;
        return n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode() && out.length < 400) out.push(walker.currentNode);
    return out;
  }

  // The element whose children repeat (same tag and class), e.g. table body, list, card grid.
  function repeatingParent(root) {
    const sig = (e) => `${e.tagName}.${[...e.classList].sort().join('.')}`;
    const candidates = [root, ...root.querySelectorAll('*')].slice(0, 600);
    let best = null;
    for (const el of candidates) {
      const kids = [...el.children].filter((k) => !isOurs(k));
      if (kids.length < 2) continue;
      const counts = {};
      for (const k of kids) counts[sig(k)] = (counts[sig(k)] || 0) + 1;
      const top = Math.max(...Object.values(counts));
      if (top >= 2 && (!best || top > best.top)) best = { el, top, sig: Object.keys(counts).find((s) => counts[s] === top) };
    }
    return best;
  }

  const APPLY = {
    long_text(root, rec) {
      for (const n of textNodes(root)) {
        const t = n.data.trim();
        if (t.length < 4) continue;   // skip initials, badges and icons-as-text
        const words = t.split(/\s+/);
        const extra = Array.from({ length: Math.ceil(words.length * 1.5) }, (_, i) => words[i % words.length]).join(' ');
        rec.text(n, `${n.data} ${extra}`);
      }
    },
    long_word(root, rec) {
      // Words, not numbers: a price or a percentage never gets a 40-character word appended.
      for (const n of textNodes(root)) if (n.data.trim().length > 3 && !/^[\d\s$€£¥₹%.,:+\-–×x/()]+$/i.test(n.data.trim())) rec.text(n, `${n.data} verylongunbrokenidentifier_0123456789abcdef`);
    },
    big_numbers(root, rec) {
      for (const n of textNodes(root)) {
        if (!/\d/.test(n.data)) continue;
        rec.text(n, n.data.replace(/\d[\d,]*(\.\d+)?/g, (m) => (m.replace(/\D/g, '').length >= 3 ? `9,876,5${m}` : `${m}0000`)));
      }
    },
    empty(root, rec) {
      for (const n of textNodes(root)) rec.text(n, '');
      for (const img of root.querySelectorAll('img')) rec.attr(img, 'src', 'data:image/gif;base64,invalid');
    },
    many_items(root, rec) {
      const rep = repeatingParent(root);
      if (!rep) return;
      const items = [...rep.el.children].filter((k) => `${k.tagName}.${[...k.classList].sort().join('.')}` === rep.sig);
      const last = items[items.length - 1];
      for (let i = 0; i < 15; i++) {
        const clone = items[i % items.length].cloneNode(true);
        clone.setAttribute('data-pp-stress-clone', '');
        last.after(clone);
        rec.add(clone);
      }
    },
    big_font(root, rec) {
      const els = new Set(textNodes(root).map((n) => n.parentElement));
      // Measure all first, then set, so nested elements don't compound.
      const sizes = [...els].map((el) => [el, parseFloat(getComputedStyle(el).fontSize) || 14]);
      for (const [el, size] of sizes) rec.style(el, 'font-size', `${Math.round(size * 1.5 * 10) / 10}px`);
    },
    narrow(root, rec) {
      const w = root.getBoundingClientRect().width;
      if (w <= 330) return;
      rec.style(root, 'width', '320px');
      rec.style(root, 'max-width', '320px');
      rec.style(root, 'min-width', '0px');
    },
    rtl(root, rec) { rec.attr(root, 'dir', 'rtl'); }
  };

  // ── What counts as broken ──────────────────────────────────────────────────
  function name(el) {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `<${el.tagName.toLowerCase()}${cls}>${text ? ` "${text}${text.length >= 24 ? '…' : ''}"` : ''}`;
  }

  function visibleBox(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  // Leaves: elements that show text directly, images and icons.
  function leaves(root) {
    const out = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (out.length >= 120) break;
      if (isOurs(el) || el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const tag = el.tagName.toLowerCase();
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
      if (!(ownText || tag === 'img' || tag === 'svg' || tag === 'input')) continue;
      const box = visibleBox(el);
      if (!box) continue;
      // For text, measure the text itself: it can run past its element's box without changing the box.
      const ink = ownText ? textBox(el) : null;
      out.push({ el, box: ink || box, elBox: box, ink: !!ink });
    }
    return out;
  }

  function textBox(el) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        l = Math.min(l, rect.left); t = Math.min(t, rect.top); r = Math.max(r, rect.right); b = Math.max(b, rect.bottom);
      }
    }
    return l === Infinity ? null : { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }

  function scan(root) {
    const problems = new Map();   // key → description
    const rootBox = root.getBoundingClientRect();
    const all = [root, ...root.querySelectorAll('*')].slice(0, 800).filter((e) => !isOurs(e));

    // Text cut off by a container that hides overflow (and isn't meant to scroll or show "…").
    for (const el of all) {
      const cs = getComputedStyle(el);
      for (const [axis, size, client, ov] of [['x', el.scrollWidth, el.clientWidth, cs.overflowX], ['y', el.scrollHeight, el.clientHeight, cs.overflowY]]) {
        if (size <= client + 2 || !(ov === 'hidden' || ov === 'clip')) continue;
        if (axis === 'x' && cs.textOverflow === 'ellipsis') continue;
        if (!(el.innerText || '').trim()) continue;
        problems.set(`cut:${axis}:${name(el)}`, `${name(el)} cuts off its content ${axis === 'x' ? 'horizontally' : 'vertically'} (${size - client}px hidden)`);
      }
    }

    const ls = leaves(root);
    const rootScrolls = ['auto', 'scroll'].includes(getComputedStyle(root).overflowX) || ['auto', 'scroll'].includes(getComputedStyle(root).overflowY);

    // Text running out of its own element (no wrapping, no room).
    for (const { el, box, elBox, ink } of ls) {
      if (!ink || ['visible'].indexOf(getComputedStyle(el).overflowX) < 0) continue;
      const out = Math.max(box.right - elBox.right, elBox.left - box.left);
      if (out > 2) problems.set(`run:${name(el)}`, `the text of ${name(el)} runs ${r1(out)}px past its box`);
    }

    // Content spilling outside the block.
    if (!rootScrolls) {
      for (const { el, box } of ls) {
        if (el === root) continue;
        // Inside a scroll container (e.g. a table wrapper)? Then going past the edge is expected.
        if (el.parentElement?.closest && [...ancestorsUntil(el, root)].some((a) => /auto|scroll/.test(getComputedStyle(a).overflowX + getComputedStyle(a).overflowY))) continue;
        const out = Math.max(rootBox.left - box.left, box.right - rootBox.right, rootBox.top - box.top, box.bottom - rootBox.bottom);
        if (out > 2) problems.set(`spill:${name(el)}`, `${name(el)} spills ${r1(out)}px outside the block`);
      }
    }

    // Text or icons colliding.
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i], b = ls[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
        const h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
        if (w > 2 && h > 2) problems.set(`overlap:${name(a.el)}|${name(b.el)}`, `${name(a.el)} overlaps ${name(b.el)} (${r1(w)}×${r1(h)}px)`);
      }
    }

    // The whole page scrolling sideways.
    // Only blame this block if it (or something in it) actually sticks out past the screen's right edge;
    // otherwise the sideways scroll comes from another part of the page.
    const pageOver = document.documentElement.scrollWidth - innerWidth;
    const sticksOut = rootBox.right > innerWidth + 2 || ls.some(({ box }) => box.right > innerWidth + 2);
    if (pageOver > 2 && sticksOut) problems.set('page-x', `the page now scrolls sideways (${pageOver}px wider than the screen) because this block sticks out`);

    return problems;
  }

  function* ancestorsUntil(el, root) {
    let a = el.parentElement;
    while (a && a !== root) { yield a; a = a.parentElement; }
  }

  // ── Entry points ───────────────────────────────────────────────────────────
  // Runs each attack on the root, records the NEW problems it causes, and undoes it.
  globalThis.ppStress = function (root, attacks) {
    if (!root?.isConnected) return { error: 'The selected element is no longer on the page. Pick it again.' };
    hideShown();
    const list = (Array.isArray(attacks) && attacks.length ? attacks : Object.keys(ATTACKS)).filter((a) => APPLY[a]);
    const unknown = (attacks || []).filter((a) => !APPLY[a] && a !== 'small_screen');
    const before = scan(root);
    const results = [];
    for (const attack of list) {
      const rec = recorder();
      try {
        APPLY[attack](root, rec);
        const changed = rec.count();
        const after = changed ? scan(root) : new Map();
        const broke = [...after].filter(([k]) => !before.has(k)).map(([, v]) => v).slice(0, 8);
        results.push({ attack, label: ATTACKS[attack], applicable: changed > 0, held: broke.length === 0, problems: broke });
      } catch (err) {
        results.push({ attack, label: ATTACKS[attack], applicable: false, held: true, problems: [], error: err.message });
      } finally {
        rec.undo();
      }
    }
    const broken = results.filter((r) => !r.held);
    return {
      allPass: broken.length === 0,
      results,
      alreadyBroken: [...before.values()].slice(0, 5),
      unknown: unknown.length ? unknown : undefined,
      summary: `${broken.length} of ${results.filter((r) => r.applicable).length} attacks broke it`
    };
  };

  // Leaves one attack applied so the developer can see it ("Show"); call with null to put it back.
  let shown = null;
  function hideShown() { shown?.rec.undo(); shown = null; }
  globalThis.ppStressShow = function (root, attack) {
    hideShown();
    if (!attack) return { shown: null };
    if (!APPLY[attack]) return { error: `Unknown attack: ${attack}` };
    if (!root?.isConnected) return { error: 'The selected element is no longer on the page. Pick it again.' };
    const rec = recorder();
    APPLY[attack](root, rec);
    shown = { attack, rec };
    root.scrollIntoView({ block: 'nearest' });
    return { shown: attack };
  };
  globalThis.ppStressHide = hideShown;
  globalThis.ppStressScan = (root) => (root?.isConnected ? { problems: [...scan(root).values()] } : { error: 'The selected element is no longer on the page. Pick it again.' });
  globalThis.ppStressAttacks = ATTACKS;
})();