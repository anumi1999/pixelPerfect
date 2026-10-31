import { runAgent, callMuseSpark } from './agent.js';
import { configureBridge, bridgeRequest } from './bridge.js';
import { state, resetRun } from './state.js';
import { loadFigma, figmaSummary } from './figma.js';

const $ = (id) => document.getElementById(id);
let tabId = null;
let elements = [];      // descriptions of the picked elements (index = position)
let running = false;

// ── Settings ──────────────────────────────────────────────────────────────────
const FIELDS = ['apiKey', 'model', 'baseUrl', 'localUrl', 'localModel', 'localKey', 'bridgeUrl', 'bridgeToken', 'figmaUrl', 'figmaToken'];

async function loadDesign() {
  const url = $('figmaUrl').value.trim();
  if (!url) return;
  $('figmaStatus').textContent = 'Loading Figma design…';
  try {
    const s = await loadFigma({ url, token: $('figmaToken').value.trim() });
    $('figmaStatus').textContent = `Figma: "${s.name}" loaded, ${s.components} components`;
  } catch (err) {
    $('figmaStatus').textContent = 'Figma design not loaded';
    addTrace('error', 'Could not load the Figma design', err.message);
  }
}

$('loadFigma').addEventListener('click', async () => {
  await chrome.storage.local.set({ figmaUrl: $('figmaUrl').value.trim(), figmaToken: $('figmaToken').value.trim() });
  await loadDesign();
});

function applyBridgeSettings() {
  configureBridge({ url: $('bridgeUrl').value.trim(), token: $('bridgeToken').value.trim() });
}

async function checkBridge() {
  if (!$('bridgeToken').value.trim()) return;
  try {
    const info = await bridgeRequest('hello', {}, 5000);
    addTrace('pass', `Bridge connected: ${info.project}`, `${info.sourceFiles} source files in ${info.root}`);
  } catch (err) {
    addTrace('error', 'Bridge not connected', err.message);
  }
}

async function loadSettings() {
  const s = await chrome.storage.local.get([...FIELDS, 'mode', 'allowEscalation']);
  for (const f of FIELDS) if (s[f]) $(f).value = s[f];
  $('allowEscalation').checked = !!s.allowEscalation;
  const mode = s.mode || 'cloud';
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  applyBridgeSettings();
  showReadiness();
  if (s.figmaUrl && s.figmaToken) loadDesign();
}

const mode = () => document.querySelector('input[name="mode"]:checked').value;

// Connection settings for one provider.
function provider(which) {
  return which === 'local'
    ? { name: 'Muse Glimmer (local)', apiKey: $('localKey').value.trim(), model: $('localModel').value.trim(), baseUrl: $('localUrl').value.trim() }
    : { name: 'Muse Spark (cloud)', apiKey: $('apiKey').value.trim(), model: $('model').value.trim(), baseUrl: $('baseUrl').value.trim() };
}

function ready() {
  return mode() === 'cloud' ? !!$('apiKey').value.trim() : !!$('localUrl').value.trim();
}

function showReadiness() {
  const m = mode();
  if (m === 'cloud' && !$('apiKey').value.trim()) { setStatus('Add your Meta API key in Settings', 'bad'); $('settings').open = true; }
  else setStatus(m === 'local' ? 'Local mode: nothing leaves this laptop' : m === 'auto' ? 'Auto: local first' : 'Cloud mode', 'ok');
  updateRunButton();
}

document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', async () => {
  await chrome.storage.local.set({ mode: mode() });
  showReadiness();
}));

$('save').addEventListener('click', async () => {
  const values = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  await chrome.storage.local.set({ ...values, mode: mode(), allowEscalation: $('allowEscalation').checked });
  setStatus('Saved', 'ok');
  applyBridgeSettings();
  updateRunButton();
  await checkBridge();
});

$('test').addEventListener('click', async () => {
  const p = provider(mode() === 'cloud' ? 'cloud' : 'local');
  setStatus(`Testing ${p.name}…`);
  try {
    const msg = await callMuseSpark([{ role: 'user', content: 'Reply with exactly: pixelPerfect connected' }], p, false);
    setStatus(`${p.name}: ${(msg.content || '').slice(0, 40)}`, 'ok');
  } catch (err) {
    setStatus('Connection failed', 'bad');
    addTrace('error', `Connection test: ${p.name}`, err.message);
  }
});

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

// ── Picking elements ──────────────────────────────────────────────────────────
$('pick').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  tabId = tab.id;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-main.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['verify.js', 'content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'PP_PICK' });
    $('pick').textContent = 'Picking… (click the page, Esc to stop)';
  } catch (err) {
    addTrace('error', 'Could not open the picker', `${err.message}\nTip: this works on normal web pages and localhost, not on chrome:// pages.`);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'PP_SELECTED') return;
  if (sender.tab?.id) tabId = sender.tab.id;
  elements = msg.elements;
  if (!msg.picking) $('pick').textContent = 'Pick again';
  renderSelection();
  $('review').hidden = true;
  updateRunButton();
  if (!msg.picking) $('goal').focus();
});

function renderSelection() {
  const list = $('selection');
  list.start = 0;
  list.replaceChildren(...elements.map((e) => {
    const li = document.createElement('li');
    const cls = e.classes.length ? '.' + e.classes.slice(0, 2).join('.') : '';
    const lines = [`<${e.tag}${e.id ? '#' + e.id : ''}${cls}>  ${e.size}${e.children ? `  · ${e.children} children` : ''}`];
    if (e.text) lines.push(`"${e.text.slice(0, 60)}"`);
    if (e.source) lines.push(e.source);
    li.textContent = lines.join('\n');
    li.style.whiteSpace = 'pre-wrap';
    return li;
  }));
  list.hidden = elements.length === 0;
}

// ── Running the agent ─────────────────────────────────────────────────────────
function updateRunButton() {
  $('run').disabled = running || !elements.length || !ready();
}

$('goal').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('run').click();
});

$('run').addEventListener('click', async () => {
  const goal = $('goal').value.trim();
  if (!goal || running) return;
  running = true;
  updateRunButton();
  $('review').hidden = true;
  $('applied').hidden = true;
  $('trace').replaceChildren();
  resetRun();
  try {
    const m = mode();
    const first = m === 'cloud' ? 'cloud' : 'local';
    let outcome = await runWith(first, goal);

    // Auto: if the local model couldn't produce a verified fix, escalate to Muse Spark (with permission).
    if (m === 'auto' && !outcome?.verified) {
      if ($('allowEscalation').checked && $('apiKey').value.trim()) {
        addTrace('fail', 'Local model could not verify a fix', 'Discarding its previews and escalating to Muse Spark (cloud). Page details for the selected elements will be sent to the Meta Model API.');
        await sendToPage({ type: 'PP_DISCARD' });
        resetRun();
        outcome = await runWith('cloud', goal);
      } else {
        addTrace('fail', 'Local model could not verify a fix', 'Cloud escalation is off. Turn on "allow sending page details to Muse Spark" in Settings, or switch to Cloud mode.');
      }
    }
    setStatus(outcome?.verified ? 'Done: verified' : 'Done: not verified', outcome?.verified ? 'ok' : 'bad');
  } catch (err) {
    addTrace('error', 'Agent stopped', err.message);
    setStatus('Error', 'bad');
  }
  running = false;
  updateRunButton();
  await refreshReview();
});

async function runWith(which, goal) {
  const p = provider(which);
  addTrace('', `Using ${p.name}`, which === 'local' ? 'Everything stays on this laptop.' : 'Page details for the selected elements are sent to the Meta Model API.');
  setStatus(`${p.name} working…`);
  try {
    const fig = figmaSummary();
    const context = fig ? `Figma design loaded: "${fig.name}" (${fig.components} components). Use get_figma_match when the request is about matching the design.` : 'No Figma design loaded.';
    return await runAgent({ goal, element: elements, tabId, settings: p, onStep, context });
  } catch (err) {
    addTrace('error', `${p.name} stopped`, err.message);
    return { verified: false, error: err.message };
  }
}

// ── Review: see the page with and without the agent's changes ────────────────
async function sendToPage(message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return null; }
}

async function refreshReview() {
  const page = await sendToPage({ type: 'PP_PREVIEW_MODE', mode: 'changes' });
  const edits = state.pendingEdits;
  $('review').hidden = !page?.hasChanges && !edits.length;
  setToggle(false);
  renderEdits(edits);
  $('applyCode').disabled = !edits.length;
  $('applyCode').textContent = edits.length ? `Apply ${edits.length} change${edits.length === 1 ? '' : 's'} to code` : 'Apply to code';
  $('applyNote').textContent = edits.length
    ? 'Writes these changes to your files, removes the preview, and re-checks the page on the real code.'
    : page?.hasChanges ? 'No source change proposed. Start the bridge (see Settings) so pixelPerfect can find and edit your files.' : '';
}

function renderEdits(edits) {
  $('edits').replaceChildren(...edits.map((e) => {
    const box = document.createElement('div');
    box.className = 'edit';
    const head = document.createElement('div');
    head.className = 'edit-head';
    head.textContent = `${e.file}:${e.line} `;
    const why = document.createElement('span');
    why.textContent = e.reason;
    head.appendChild(why);
    const pre = document.createElement('pre');
    for (const line of (e.diff || '').split('\n')) {
      const span = document.createElement('span');
      span.textContent = line + '\n';
      if (line.startsWith('+')) span.className = 'add';
      if (line.startsWith('-')) span.className = 'del';
      pre.appendChild(span);
    }
    box.append(head, pre);
    return box;
  }));
}

let lastApplied = null;

$('applyCode').addEventListener('click', async () => {
  const edits = state.pendingEdits.map(({ file, find, replace }) => ({ file, find, replace }));
  if (!edits.length) return;
  $('applyCode').disabled = true;
  setStatus('Writing to your files…');
  try {
    const result = await bridgeRequest('apply_edits', { edits, label: $('goal').value.trim().slice(0, 80) });
    lastApplied = { file: state.pendingEdits[0].file, line: state.pendingEdits[0].line, files: result.files };
    addTrace('pass', `Applied to code: ${result.files.join(', ')}`, state.pendingEdits.map((e) => `${e.file}:${e.line}  ${e.reason}`).join('\n'));
  } catch (err) {
    addTrace('error', 'Could not apply to code', err.message);
    setStatus('Apply failed', 'bad');
    $('applyCode').disabled = false;
    return;
  }

  // Remove the preview so the page shows only the real code, wait for hot reload, then re-check.
  await sendToPage({ type: 'PP_DISCARD' });
  state.pendingEdits = [];
  $('review').hidden = true;
  setStatus('Waiting for the page to reload…');
  await new Promise((r) => setTimeout(r, 1500));
  await reverify('Re-checked on the real code');

  $('appliedSummary').textContent = `Changed ${lastApplied.files.join(', ')}. You can open it in your editor or undo the change.`;
  $('applied').hidden = false;
});

async function reverify(label) {
  const checks = state.lastPassingChecks;
  if (!checks) { addTrace('', label, 'No passing checks from this run to re-run. Look at the page to confirm.'); setStatus('Applied', 'ok'); return; }
  const v = await sendToPage({ type: 'PP_TOOL', name: 'verify', args: { checks } });
  if (!v || v.error) {
    addTrace('fail', `${label}: could not run`, `${v?.error || 'The page did not answer.'}\nIf the page fully reloaded, pick the element again and ask pixelPerfect to verify.`);
    setStatus('Applied, not re-checked', 'bad');
    return;
  }
  onStep({ kind: 'result', name: 'verify', result: v });
  addTrace(v.allPass ? 'pass' : 'fail', v.allPass ? `${label}: all checks pass ✓` : `${label}: some checks fail`, v.allPass ? '' : 'The real code does not behave like the preview. Undo the change, or ask pixelPerfect to look again.');
  setStatus(v.allPass ? 'Applied and verified' : 'Applied, checks fail', v.allPass ? 'ok' : 'bad');
}

$('undoCode').addEventListener('click', async () => {
  try {
    const r = await bridgeRequest('undo');
    addTrace('', 'Code change undone', (r.restored || []).join('\n') || r.message);
    $('applied').hidden = true;
    setStatus('Undone', 'ok');
  } catch (err) {
    addTrace('error', 'Could not undo', err.message);
  }
});

$('openEditor').addEventListener('click', async () => {
  if (!lastApplied) return;
  try { await bridgeRequest('open_in_editor', { file: lastApplied.file, line: lastApplied.line }); }
  catch (err) { addTrace('error', 'Could not open the editor', err.message); }
});

function setToggle(showingOriginal) {
  $('toggleView').setAttribute('aria-pressed', String(showingOriginal));
  $('toggleView').textContent = showingOriginal ? 'Show changes' : 'Show original';
}

$('toggleView').addEventListener('click', async () => {
  const showOriginal = $('toggleView').getAttribute('aria-pressed') !== 'true';
  const state = await sendToPage({ type: 'PP_PREVIEW_MODE', mode: showOriginal ? 'original' : 'changes' });
  if (state) setToggle(state.mode === 'original');
});

$('discard').addEventListener('click', async () => {
  await sendToPage({ type: 'PP_DISCARD' });
  state.pendingEdits = [];
  $('review').hidden = true;
  addTrace('', 'Changes discarded', 'The page is back to its original state and no source change was written.');
});

// ── Trace timeline (every step the agent takes) ───────────────────────────────
let thinkingItem = null;
const lastArgs = {};

function onStep(s) {
  thinkingItem?.remove();
  thinkingItem = null;
  if (s.kind === 'tool') lastArgs[s.name] = s.args;
  if (s.kind === 'result' && s.name === 'verify' && s.result?.allPass && lastArgs.verify?.checks) state.lastPassingChecks = lastArgs.verify.checks;
  if (s.kind === 'result' && s.name === 'propose_source_edit' && s.result?.proposed) {
    addTrace('pass', `← proposed change: ${s.result.file}:${s.result.line}`, s.result.diff);
    return;
  }
  if (s.kind === 'thinking') thinkingItem = addTrace('', `Step ${s.step}: thinking…`);
  if (s.kind === 'tool') addTrace('tool', `→ ${s.name}`, Object.keys(s.args).length ? JSON.stringify(s.args, null, 2) : '');
  if (s.kind === 'result' && s.name === 'verify' && s.result?.results) {
    const lines = s.result.results.map((r) => r.line);
    if (s.result.warnings?.length) lines.push('', 'Nearby changes:', ...s.result.warnings.map((w) => `⚠ ${w}`));
    addTrace(s.result.allPass ? 'pass' : 'fail', `← verify: ${s.result.allPass ? 'all checks pass' : 'some checks fail'}`, lines.join('\n'));
  } else if (s.kind === 'result' && s.name === 'verify_responsive' && s.result?.byWidth) {
    const lines = s.result.byWidth.flatMap((w) => [`${w.allPass ? '✓' : '✗'} ${w.width}px`, ...w.lines.map((l) => `   ${l}`)]);
    addTrace(s.result.allPass ? 'pass' : 'fail', `← verify at ${s.result.byWidth.map((w) => w.width).join(' / ')}px`, lines.join('\n'));
  } else if (s.kind === 'result' && s.name === 'get_figma_match' && s.result?.candidates) {
    const lines = s.result.candidates.map((c) => `${c === s.result.candidates[0] ? '★' : ' '} ${c.name}  score ${c.score}  (${c.why.text}, name ${c.why.name}, size ${c.why.size})`);
    addTrace(s.result.confident ? 'pass' : 'fail', `← Figma match: ${s.result.best?.name ?? 'none'}${s.result.confident ? '' : ' (not sure)'}`, lines.join('\n'));
  } else if (s.kind === 'result' && s.name === 'get_figma_spec' && s.result?.checks) {
    addTrace('', `← Figma spec: ${s.result.figma.name} (${s.result.checks.length} checks)`, s.result.checks.map((c) => `${c.target ? `[${c.target.text}] ` : ''}${c.property}: ${c.expected}`).join('\n'), true);
  } else if (s.kind === 'result' && s.name === 'get_structure' && s.result?.lines) {
    addTrace('', '← get_structure', s.result.lines.join('\n'), true);
  } else if (s.kind === 'result') {
    addTrace(s.result?.error ? 'error' : '', `← ${s.name}`, JSON.stringify(s.result, null, 2), true);
  }
  if (s.kind === 'note') addTrace('', 'pixelPerfect', s.text);
  if (s.kind === 'final') addTrace('final', 'Answer', s.text);
}

// All text goes in via textContent: page data and model output are never treated as HTML.
function addTrace(kind, label, body = '', collapsed = false) {
  const li = document.createElement('li');
  if (kind) li.className = kind;
  const head = document.createElement('div');
  head.className = 'label';
  head.textContent = label;
  li.appendChild(head);
  if (body) {
    const pre = document.createElement('pre');
    pre.textContent = body;
    if (collapsed) {
      const d = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = 'details';
      d.append(sum, pre);
      li.appendChild(d);
    } else if (kind === 'final') {
      const p = document.createElement('div');
      p.textContent = body;
      li.appendChild(p);
    } else {
      li.appendChild(pre);
    }
  }
  $('trace').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

['apiKey', 'localUrl'].forEach((f) => $(f).addEventListener('input', updateRunButton));
loadSettings();