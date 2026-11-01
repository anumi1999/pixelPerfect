// The tools the agent can call. Each has:
//  1. a JSON description (so Muse Spark knows when and how to use it)
//  2. code that runs it (page tools go to content.js, code tools go to the local bridge)
import { bridgeRequest } from './bridge.js';
import { state } from './state.js';
import { figmaLoaded, matchElement, specFor } from './figma.js';

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['css', 'centered', 'size', 'spacing', 'aligned', 'visible', 'no_overflow', 'contrast', 'lines'],
      description: [
        'css: a computed style equals `expected` (needs property, expected).',
        'centered: equal gaps on both sides. `of`="self" centers the element in its parent; `of`="children" centers its children as one group inside it (they must also sit together, unless grouped=false). `axis` = horizontal | vertical | both.',
        'size: rendered width and/or height in px.',
        'spacing: gaps between the element\'s children are equal, or equal to expected_px.',
        'aligned: the element\'s children share an edge (top, bottom, left, right, center-x, center-y).',
        'visible: shown, non-zero size, in the viewport and not covered by another element.',
        'lines: the text wraps onto at most `expected` lines (e.g. a one-line heading). Optional min_viewport: skip on narrower screens.',
        'no_overflow: content is not cut off or spilling, and the element fits inside its parent.',
        'contrast: text contrast meets WCAG (default 4.5:1, or 3:1 for large text).'
      ].join(' ')
    },
    property: { type: 'string', description: 'css only: CSS property name, e.g. "font-weight"' },
    expected: { type: 'string', description: 'css: expected value, e.g. "600", "24px", "#4F46E5", "center". lines: the maximum number of lines, e.g. "1".' },
    min_viewport: { type: 'number', description: 'lines only: skip this check when the screen is narrower than this (px).' },
    axis: { type: 'string', enum: ['horizontal', 'vertical', 'both'] },
    of: { type: 'string', enum: ['self', 'children'] },
    grouped: { type: 'boolean', description: 'centered of=children only: require children to sit together (default true)' },
    width: { type: 'number' },
    height: { type: 'number' },
    expected_px: { type: 'number', description: 'spacing only: expected gap in px' },
    edge: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'center-x', 'center-y'] },
    min_ratio: { type: 'number' },
    tolerance_px: { type: 'number', description: 'allowed difference in px (default 2)' },
    element: { type: 'number', description: 'Which selected element to check (index, default 0)' },
    state: { type: 'string', enum: ['hover', 'focus', 'active'], description: 'Optional: check the element (or target) while it is hovered, focused (keyboard) or pressed. E.g. the hover background colour.' },
    target: {
      type: 'object',
      description: 'Optional: check a descendant of the selected element instead, found by its text or a CSS selector.',
      properties: { text: { type: 'string' }, selector: { type: 'string' } }
    }
  },
  required: ['type']
};

const ELEMENT = { element: { type: 'number', description: 'Index of the selected element (default 0). The developer may select several.' } };

export const TOOLS = [
  fn('inspect_element',
    'Measure one selected element: its box (position and size), key computed styles, inline style, parent layout and HTML.',
    ELEMENT),
  fn('get_structure',
    'Outline everything inside a selected element (tags, classes, text, sizes, positions, flex/grid). Use this first when the request is about a whole block or a redesign.',
    { ...ELEMENT, depth: { type: 'number', description: 'How many levels deep (default 4, max 8)' } }),
  fn('get_matched_rules',
    'List the CSS rules that apply to one selected element, in source order, with the file each comes from and any @media condition. Use this to find WHY a style has its value.',
    ELEMENT),
  fn('get_component',
    'Get the React/Vue component that rendered a selected element, its props, and its source file and line if available.',
    ELEMENT),
  fn('preview_css',
    'Apply CSS declarations live to ONE selected element (inline, not saved to code). Use for small fixes to a single element.',
    { ...ELEMENT, css: { type: 'string', description: 'CSS declarations, e.g. "padding: 24px; font-weight: 600"' } },
    ['css']),
  fn('preview_stylesheet',
    'Apply a stylesheet live to the page (not saved to code), using real selectors seen in get_structure or get_matched_rules. Use for changes across many elements or a redesign of a block. Returns how many elements each selector matched.',
    { css: { type: 'string', description: 'Full CSS rules with selectors, e.g. ".card { padding: 24px } .card h3 { font-weight: 600 }"' } },
    ['css']),
  fn('undo_preview', 'Revert the most recent preview (preview_css or preview_stylesheet).'),
  fn('verify',
    'Measure the page and check whether the request is met. Returns pass/fail per check with real numbers, plus warnings if nearby elements moved since selection (possible regressions). Run after every preview.',
    { checks: { type: 'array', items: CHECK_SCHEMA, description: 'Checks that together prove the request is met.' } },
    ['checks']),
  fn('stress_test',
    'BREAK IT: stress-test a selected block with realistic bad data and small screens, and report what breaks (text cut off, content spilling out, elements overlapping, the page scrolling sideways). Every attack is undone right after it is measured; nothing is written. Attacks: long_text, long_word, big_numbers, empty, many_items, big_font, narrow, rtl, small_screen (320/375/768 px). Leave attacks empty to run them all. Also use it after a fix to prove the attack no longer breaks the block.',
    {
      ...ELEMENT,
      attacks: { type: 'array', items: { type: 'string', enum: ['long_text', 'long_word', 'big_numbers', 'empty', 'many_items', 'big_font', 'narrow', 'rtl', 'small_screen'] }, description: 'Which attacks to run (default: all).' }
    }),
  fn('check_states',
    'Test interaction states of the interactive elements (buttons, links, inputs) inside a selected block: forces :hover, keyboard :focus, :active and disabled, and reports what each state changes and what breaks (hover that moves other elements, focus with no visible indicator, contrast that drops, disabled that looks enabled). Also checks keyboard basics: clickable things a keyboard cannot reach, and icon buttons with no accessible name. Nothing is changed.',
    ELEMENT),
  fn('verify_responsive',
    'Run the same checks at several screen widths (default 375, 768, 1280 px) to make sure a fix works on mobile, tablet and desktop. Use after verify passes.',
    {
      checks: { type: 'array', items: CHECK_SCHEMA },
      widths: { type: 'array', items: { type: 'number' }, description: 'Viewport widths in px' }
    },
    ['checks']),

  // ── Design tools (Figma) ──
  fn('get_figma_match',
    'Find which component in the loaded Figma design matches a selected element (by its text, names and size). Returns the best match, a confidence flag and the top 3 candidates.',
    ELEMENT),
  fn('get_figma_spec',
    'Get the design values for a Figma component (padding, gaps, corner radius, colours, font sizes and weights) as ready-to-use verify checks. These checks are the acceptance criteria for "match the design".',
    { figma_id: { type: 'string', description: 'The Figma node id from get_figma_match' } },
    ['figma_id']),

  // ── Code tools (through the local bridge) ──
  fn('find_in_source',
    'Search the project\'s source files for text, e.g. a selector (".product-card.featured"), a class name or a CSS variable. Returns file, line and the matching line. Use when get_matched_rules shows a built file, or to find design tokens.',
    { query: { type: 'string' } },
    ['query']),
  fn('read_file',
    'Read a source file with line numbers. Always read a file before proposing an edit to it.',
    { file: { type: 'string', description: 'Path relative to the project, or the path shown by get_matched_rules / data-pp-src' },
      start_line: { type: 'number' }, end_line: { type: 'number' } },
    ['file']),
  fn('propose_source_edit',
    'Propose a change to a source file. Nothing is written: the developer reviews it and clicks "Apply to code". `find` must be text copied exactly from read_file (without the line numbers) and must appear exactly once in the file.',
    { file: { type: 'string' },
      find: { type: 'string', description: 'Exact existing text to replace' },
      replace: { type: 'string', description: 'New text ("" to delete)' },
      reason: { type: 'string', description: 'One line: why this change' } },
    ['file', 'find', 'replace', 'reason']),
  fn('withdraw_source_edit',
    'Remove a proposed source edit you no longer want, by its index.',
    { index: { type: 'number' } },
    ['index'])
];

const BRIDGE_TOOLS = new Set(['find_in_source', 'read_file']);

// Runs a tool by name.
export async function runTool(tabId, name, args) {
  if (name === 'verify_responsive') return verifyResponsive(tabId, args);
  if (name === 'stress_test') return stressTest(tabId, args);
  if (name === 'check_states') return checkStates(tabId, args);
  if (name === 'verify' && (args.checks || []).some((c) => c.state)) return verifyWithStates(tabId, args);
  if (BRIDGE_TOOLS.has(name) || name === 'propose_source_edit') {
    const off = await notLocalProject(tabId);
    if (off) return off;
  }
  if (BRIDGE_TOOLS.has(name)) return viaBridge(name, args);
  if (name === 'propose_source_edit') return proposeEdit(args);
  if (name === 'withdraw_source_edit') return withdrawEdit(args);
  if (name === 'get_figma_match') return figmaMatch(tabId, args);
  if (name === 'get_figma_spec') return figmaSpec(args);
  return sendToPage(tabId, name, args);
}

async function figmaMatch(tabId, { element }) {
  if (!figmaLoaded()) return { error: 'No Figma design is loaded. Ask the developer to add a Figma link in Settings, or work from their description.' };
  const f = await sendToPage(tabId, 'get_features', { element });
  if (f.error) return f;
  try { return matchElement(f); } catch (err) { return { error: err.message }; }
}

function figmaSpec({ figma_id }) {
  try { return specFor(figma_id); } catch (err) { return { error: err.message }; }
}

// The bridge serves the developer's local project. Source tools only make sense when the page
// in the tab IS that project (a local dev server), not a live site like netflix.com.
const LOCAL_HOST = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|.+\.(local|localhost|test))$/;
async function notLocalProject(tabId) {
  let url;
  try { url = new URL((await chrome.tabs.get(tabId)).url); } catch { return null; }
  if (url.protocol === 'file:' || LOCAL_HOST.test(url.hostname)) return null;
  return { error: `Source tools are off: this page (${url.hostname}) is not served from the developer's local project, so the files the bridge sees are not this page's code. Do not search or edit files. Give the CSS fix in your final answer instead.` };
}

// Rejects source changes a teammate would not accept.
function lintEdit(find, replace) {
  const count = (s, re) => (s.match(re) || []).length;
  const problems = [];
  if (count(replace, /!important/g) > count(find, /!important/g)) problems.push('adds !important');
  if (/\[class[*^$|~]?=/.test(replace) && !/\[class[*^$|~]?=/.test(find)) problems.push('uses [class*=…] attribute matching on class names');
  const hashed = [...new Set((replace.match(/\.[a-z][\w-]*/gi) || []).filter((c) =>
    !find.includes(c) && c.slice(1).split(/[-_]/).some((part) => part.length >= 5 && /\d/.test(part) && /[a-z]/i.test(part))))];
  const hashedAttr = [...new Set((replace.match(/(?:css|cache|sc|jsx|emotion)-[a-z0-9]{5,}/gi) || []).filter((c) => !find.includes(c)))];
  if (hashed.length || hashedAttr.length) problems.push(`uses generated class names (${[...hashed, ...hashedAttr].slice(0, 4).join(', ')}) that change on every build`);
  return problems;
}

// Can the agent change code for this tab? Local page + bridge answering.
export async function sourceStatus(tabId) {
  const off = await notLocalProject(tabId);
  if (off) return { ok: false, reason: 'live-site' };
  try { await bridgeRequest('hello', {}, 3000); return { ok: true }; }
  catch { return { ok: false, reason: 'no-bridge' }; }
}

async function viaBridge(action, args) {
  try { return await bridgeRequest(action, args); }
  catch (err) { return { error: err.message, hint: 'If the bridge is not running, give the source fix in your final answer instead.' }; }
}

async function proposeEdit({ file, find, replace, reason }) {
  const problems = lintEdit(find || '', replace || '');
  if (problems.length) return { error: `Not proposed: the change ${problems.join(' and ')}. Rewrite it: change the rule that causes the problem, use stable selectors from the source, and no !important.` };
  let check;
  const prior = state.pendingEdits
    .filter((e) => (e.file === file || file.endsWith('/' + e.file)) && e.find !== find)
    .map(({ find: f, replace: r }) => ({ find: f, replace: r }));
  try { check = await bridgeRequest('check_edit', { file, find, replace, prior }); }
  catch (err) { return { error: err.message }; }
  if (!check.ok) return { error: check.error, file: check.file };
  const edit = { file: check.file, find, replace, reason: reason || '', line: check.line, diff: check.diff };
  const existing = state.pendingEdits.findIndex((e) => e.file === edit.file && e.find === edit.find);
  if (existing >= 0) state.pendingEdits[existing] = edit; else state.pendingEdits.push(edit);
  return { proposed: true, index: existing >= 0 ? existing : state.pendingEdits.length - 1, file: edit.file, line: edit.line, diff: edit.diff, totalProposed: state.pendingEdits.length };
}

function withdrawEdit({ index }) {
  if (!state.pendingEdits[index]) return { error: `No proposed edit with index ${index}.` };
  const [removed] = state.pendingEdits.splice(index, 1);
  return { withdrawn: `${removed.file}:${removed.line}`, totalProposed: state.pendingEdits.length };
}

async function sendToPage(tabId, name, args) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'PP_TOOL', name, args });
    return result ?? { error: 'No response from the page. Reload the page and pick the element again.' };
  } catch (err) {
    return { error: `Could not reach the page: ${err.message}` };
  }
}

// ── Interaction states ───────────────────────────────────────────────────────
// :hover, :focus and :active are forced with the Chrome debugger (CSS.forcePseudoState), so the
// page looks exactly as if the mouse or keyboard were there, without moving anything.
const STATES = { hover: ['hover'], focus: ['focus', 'focus-visible'], active: ['active', 'hover'] };

async function withDebugger(tabId, fn) {
  const target = { tabId };
  try { await chrome.debugger.attach(target, '1.3'); }
  catch (err) { return { error: `Could not attach the debugger to test states: ${err.message}` }; }
  const send = (cmd, params) => chrome.debugger.sendCommand(target, cmd, params);
  try {
    await send('DOM.enable');
    await send('CSS.enable');
    const { root } = await send('DOM.getDocument', { depth: 0 });
    const force = async (selector, classes) => {
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`Element ${selector} not found.`);
      await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
    };
    return await fn(force);
  } finally {
    try { await chrome.debugger.detach(target); } catch {}
  }
}

const settle = () => new Promise((r) => setTimeout(r, 60));

function compareState(state, base, now, target) {
  const changes = Object.keys(base.styles).filter((p) => base.styles[p] !== now.styles[p]).map((p) => `${p}: ${base.styles[p]} → ${now.styles[p]}`);
  const problems = [];
  const moved = base.others.filter((b, i) => b !== now.others[i]).length;
  if (moved && state !== 'focus') problems.push(`${state === 'hover' ? 'hovering' : 'pressing'} ${target.label} moves ${moved} other element${moved === 1 ? '' : 's'} (layout jump)${base.box.w !== now.box.w || base.box.h !== now.box.h ? `: it changes size ${base.box.w}×${base.box.h} → ${now.box.w}×${now.box.h}` : ''}`);
  if (now.contrast && !now.contrast.pass) problems.push(`text contrast in the ${state} state is ${now.contrast.actual} (needs ${now.contrast.expected})${base.contrast?.pass ? '; it was fine before' : ''}`);
  if (state === 'focus') {
    const s = now.styles, b = base.styles;
    const outline = s['outline-style'] !== 'none' && parseFloat(s['outline-width']) > 0;
    const other = ['box-shadow', 'border-top-color', 'border-top-width', 'background-color', 'text-decoration-line', 'color'].some((p) => s[p] !== b[p]);
    if (!outline && !other) problems.push(`${target.label} shows no visible focus indicator: keyboard users can't see where they are (add a :focus-visible outline)`);
  }
  if (state === 'disabled' && !changes.length) problems.push(`${target.label} looks exactly the same when disabled`);
  const notes = state === 'hover' && !changes.length ? ['no visual hover feedback'] : [];
  return { attack: state, label: `${target.label} · ${state}`, applicable: true, held: problems.length === 0, problems, changes: changes.slice(0, 6), notes };
}

async function checkStates(tabId, { element = 0 } = {}) {
  const prep = await sendToPage(tabId, 'states_prepare', { element });
  if (prep.error) return prep;
  const results = [];
  if (prep.keyboard) results.push({ attack: 'keyboard', label: 'Keyboard & screen reader basics', applicable: true, held: prep.keyboard.length === 0, problems: prep.keyboard });
  if (prep.targets.length) {
    await sendToPage(tabId, 'states_freeze', { element, on: true });
    try {
      const out = await withDebugger(tabId, async (force) => {
        for (const t of prep.targets) {
          const sel = `[data-pp-state="${t.key}"]`;
          const base = await sendToPage(tabId, 'states_snapshot', { element, key: t.key });
          if (base.error) continue;
          for (const [state, classes] of Object.entries(STATES)) {
            await force(sel, classes);
            await settle();
            const now = await sendToPage(tabId, 'states_snapshot', { element, key: t.key });
            await force(sel, []);
            if (now.error) continue;
            const r = compareState(state, base, now, t);
            // :active is forced together with :hover; don't report the hover problem twice.
            if (state === 'active') {
              const hover = results.find((x) => x.attack === 'hover' && x.label.startsWith(t.label));
              r.problems = r.problems.filter((p) => !hover?.problems.includes(p.replace(/^pressing/, 'hovering')));
              r.held = r.problems.length === 0;
            }
            results.push(r);
          }
          if (t.canDisable) {
            await sendToPage(tabId, 'states_disabled', { element, key: t.key, on: true });
            const now = await sendToPage(tabId, 'states_snapshot', { element, key: t.key });
            await sendToPage(tabId, 'states_disabled', { element, key: t.key, on: false });
            if (!now.error) results.push(compareState('disabled', base, now, t));
          }
        }
      });
      if (out?.error) return out;
    } finally {
      await sendToPage(tabId, 'states_cleanup', { element });
    }
  }
  const broken = results.filter((r) => !r.held).length;
  return {
    allPass: broken === 0,
    results,
    targets: prep.targets.length,
    summary: prep.targets.length
      ? `${broken} problem${broken === 1 ? '' : 's'} in ${results.length} state checks on ${prep.targets.length} interactive element${prep.targets.length === 1 ? '' : 's'}`
      : 'No buttons, links or inputs in this block'
  };
}

// verify with checks like { type: 'css', property: 'background-color', expected: '#5b4bd5', state: 'hover' }.
async function verifyWithStates(tabId, args) {
  const plain = args.checks.filter((c) => !c.state);
  const base = plain.length ? await sendToPage(tabId, 'verify', { ...args, checks: plain }) : { allPass: true, results: [] };
  if (base.error) return base;
  const results = [...base.results];
  await sendToPage(tabId, 'states_freeze', { on: true });
  try {
    const out = await withDebugger(tabId, async (force) => {
      for (const c of args.checks.filter((x) => x.state)) {
        const classes = STATES[c.state];
        if (!classes) { results.push({ type: c.type, target: c.state, pass: false, summary: `unknown state "${c.state}"`, line: `✗ unknown state "${c.state}"` }); continue; }
        const mark = await sendToPage(tabId, 'states_mark', { element: c.element ?? 0, target: c.target });
        if (mark.error) { results.push({ type: c.type, target: c.state, pass: false, summary: mark.error, line: `✗ [${c.state}] ${mark.error}` }); continue; }
        await force('[data-pp-state="check"]', classes);
        await settle();
        const { state, ...check } = c;
        const v = await sendToPage(tabId, 'verify', { checks: [check] });
        await force('[data-pp-state="check"]', []);
        await sendToPage(tabId, 'states_cleanup', { keep: true });
        for (const r of v.results || []) results.push({ ...r, state, line: r.line.replace(/^([✓✗]) /, `$1 [${state}] `) });
        if (v.error) results.push({ type: c.type, pass: false, summary: v.error, line: `✗ [${state}] ${v.error}` });
      }
    });
    if (out?.error) return out;
  } finally {
    await sendToPage(tabId, 'states_cleanup', {});
  }
  return { ...base, allPass: results.every((r) => r.pass), results };
}

// Break it: DOM attacks run in the page (stress.js); small screens use the debugger to resize.
async function stressTest(tabId, { element = 0, attacks } = {}) {
  const all = !Array.isArray(attacks) || !attacks.length;
  const dom = all ? undefined : attacks.filter((a) => a !== 'small_screen');
  const result = all || dom.length ? await sendToPage(tabId, 'stress_test', { element, attacks: dom }) : { allPass: true, results: [] };
  if (result.error) return result;
  if (all || attacks.includes('small_screen')) {
    const screens = await smallScreens(tabId, element);
    result.results.push(screens);
    if (!screens.held) result.allPass = false;
    const broken = result.results.filter((r) => !r.held).length;
    result.summary = `${broken} of ${result.results.filter((r) => r.applicable).length} attacks broke it`;
  }
  return result;
}

async function smallScreens(tabId, element) {
  const base = await sendToPage(tabId, 'stress_scan', { element });
  if (base.error) return { attack: 'small_screen', label: 'Small screens (320 / 375 / 768 px)', applicable: false, held: true, problems: [], error: base.error };
  const known = new Set(base.problems);
  const target = { tabId };
  const problems = [];
  try { await chrome.debugger.attach(target, '1.3'); }
  catch (err) { return { attack: 'small_screen', label: 'Small screens (320 / 375 / 768 px)', applicable: false, held: true, problems: [], error: `Could not resize the viewport: ${err.message}` }; }
  try {
    for (const width of [320, 375, 768]) {
      await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 0, mobile: width < 768 });
      await new Promise((r) => setTimeout(r, 400));
      const s = await sendToPage(tabId, 'stress_scan', { element });
      for (const p of s.problems || []) if (!known.has(p) && problems.length < 8) problems.push(`at ${width}px: ${p}`);
    }
  } finally {
    try { await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride'); } catch {}
    try { await chrome.debugger.detach(target); } catch {}
  }
  return { attack: 'small_screen', label: 'Small screens (320 / 375 / 768 px)', applicable: true, held: problems.length === 0, problems };
}

// Resizes the page's viewport with the Chrome DevTools Protocol, runs verify at each width,
// then restores the original size. Chrome shows a "started debugging" bar while this runs.
async function verifyResponsive(tabId, { checks, widths }) {
  const list = Array.isArray(widths) && widths.length ? widths.slice(0, 5) : [375, 768, 1280];
  const target = { tabId };
  const byWidth = [];
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (err) {
    return { error: `Could not resize the viewport: ${err.message}` };
  }
  try {
    for (const width of list) {
      await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 0, mobile: width < 768
      });
      await new Promise((r) => setTimeout(r, 400));   // let layout and media queries settle
      const result = await sendToPage(tabId, 'verify', { checks });
      byWidth.push({ width, allPass: result.allPass, lines: result.results?.map((r) => r.line) ?? [result.error], warnings: result.warnings });
    }
  } finally {
    try { await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride'); } catch {}
    try { await chrome.debugger.detach(target); } catch {}
  }
  return { allPass: byWidth.every((w) => w.allPass), byWidth };
}

function fn(name, description, properties = {}, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}