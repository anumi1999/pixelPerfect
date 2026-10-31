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
      enum: ['css', 'centered', 'size', 'spacing', 'aligned', 'visible', 'no_overflow', 'contrast'],
      description: [
        'css: a computed style equals `expected` (needs property, expected).',
        'centered: equal gaps on both sides. `of`="self" centers the element in its parent; `of`="children" centers its children as one group inside it (they must also sit together, unless grouped=false). `axis` = horizontal | vertical | both.',
        'size: rendered width and/or height in px.',
        'spacing: gaps between the element\'s children are equal, or equal to expected_px.',
        'aligned: the element\'s children share an edge (top, bottom, left, right, center-x, center-y).',
        'visible: shown, non-zero size, in the viewport and not covered by another element.',
        'no_overflow: content is not cut off or spilling, and the element fits inside its parent.',
        'contrast: text contrast meets WCAG (default 4.5:1, or 3:1 for large text).'
      ].join(' ')
    },
    property: { type: 'string', description: 'css only: CSS property name, e.g. "font-weight"' },
    expected: { type: 'string', description: 'css only: expected value, e.g. "600", "24px", "#4F46E5", "center"' },
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

async function viaBridge(action, args) {
  try { return await bridgeRequest(action, args); }
  catch (err) { return { error: err.message, hint: 'If the bridge is not running, give the source fix in your final answer instead.' }; }
}

async function proposeEdit({ file, find, replace, reason }) {
  let check;
  try { check = await bridgeRequest('check_edit', { file, find, replace }); }
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
