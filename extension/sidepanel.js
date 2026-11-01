import { runAgent, callMuseSpark } from './agent.js';
import { configureBridge, bridgeRequest } from './bridge.js';
import { state, resetRun } from './state.js';
import { loadFigma, figmaSummary, useDesign, parseFigmaUrl } from './figma.js';
import { sourceStatus, runTool } from './tools.js';

const $ = (id) => document.getElementById(id);
let tabId = null;
let shownAttack = null;   // the break-test attack shown on the page right now
let elements = [];        // descriptions of the picked elements (index = position)
let running = false;

// What this run has shown so far (everything on screen comes from here).
const run = {
  previewed: false,       // a preview was applied at least once
  firstFailing: null,     // the first verify that failed (the "before" numbers)
  lastVerify: null,       // the most recent verify result
  responsive: null,       // the most recent verify_responsive result
  answer: '',             // the agent's final text
  verified: false
};
// A session keeps the conversation with the agent across requests, so follow-ups like
// "only on the featured card" build on the previous change.
let session = { messages: null, notes: [], turns: [] };

function newSession() {
  session = { messages: null, notes: [], turns: [] };
  renderThread();
}
$('newSession').addEventListener('click', () => { newSession(); resetRunView(); setStatus('New session', ''); $('goal').focus(); });

function renderThread() {
  const turns = session.turns;
  $('sessionHead').hidden = turns.length === 0;
  $('thread').hidden = turns.length === 0;
  $('turnCount').textContent = turns.length ? `· ${turns.length} request${turns.length === 1 ? '' : 's'}` : '';
  $('thread').replaceChildren(...turns.map((t) => {
    const li = document.createElement('li');
    const ask = document.createElement('span');
    ask.className = 'ask';
    ask.textContent = t.goal;
    const out = document.createElement('span');
    out.className = `outcome ${t.kind || ''}`;
    out.textContent = t.outcome;
    li.append(ask, out);
    return li;
  }));
  $('thread').scrollTop = $('thread').scrollHeight;
  $('goal').placeholder = turns.length
    ? 'Follow up… e.g. "only on the featured card" or "a bit darker"'
    : 'What\'s wrong? e.g. "padding should be 24px like the other cards"';
  $('run').textContent = turns.length ? 'Send' : 'Fix it';
}

function updateLastTurn(outcome, kind) {
  const last = session.turns.at(-1);
  if (!last) return;
  last.outcome = outcome;
  last.kind = kind;
  renderThread();
}

function resetRunView() {
  Object.assign(run, { previewed: false, firstFailing: null, lastVerify: null, responsive: null, answer: '', verified: false, previews: [], stress: null, firstStress: null, states: null });
  $('stressCard').hidden = true;
  shownAttack = null;
  for (const id of ['causeBlock', 'previewCard', 'checksCard', 'diffCard', 'actionBar', 'applied']) $(id).hidden = true;
  $('shotBefore').removeAttribute('src');
  $('shotAfter').removeAttribute('src');
  $('trace').replaceChildren();
  setStepper(null);
  setFooter('idle');
}

// ── Settings view ─────────────────────────────────────────────────────────────
const FIELDS = ['apiKey', 'model', 'baseUrl', 'localUrl', 'localModel', 'localKey', 'bridgeUrl', 'bridgeToken', 'figmaUrl', 'figmaToken'];
const mode = () => document.querySelector('input[name="mode"]:checked').value;

function showSettings(open) {
  $('settingsView').hidden = !open;
  $('mainView').hidden = open;
}
$('openSettings').addEventListener('click', () => showSettings($('settingsView').hidden));
$('closeSettings').addEventListener('click', () => showSettings(false));
$('closePanel').addEventListener('click', () => window.close());

function settingsStatus(text, kind = '') {
  $('settingsStatus').textContent = text;
  $('settingsStatus').style.color = kind === 'bad' ? 'var(--bad)' : kind === 'ok' ? 'var(--ok)' : '';
}

// Figma's API allows only a few calls per month on some plans, so the design is cached and
// only fetched again when you click "Load Figma".
const cacheKey = (url) => { try { const { fileKey, nodeId } = parseFigmaUrl(url); return `figmaCache:${fileKey}:${nodeId || 'file'}`; } catch { return null; } };

async function loadDesign({ fresh = false } = {}) {
  const url = $('figmaUrl').value.trim();
  if (!url) return;
  const key = cacheKey(url);
  if (!fresh && key) {
    const cached = (await chrome.storage.local.get(key))[key];
    if (cached?.root) {
      const s = useDesign(cached);
      $('figmaStatus').textContent = `Figma: "${s.name}", ${s.components} components (saved ${new Date(cached.savedAt).toLocaleString()}). Click Load Figma to fetch changes.`;
      return;
    }
  }
  $('figmaStatus').textContent = 'Loading Figma design…';
  try {
    const s = await loadFigma({ url, token: $('figmaToken').value.trim() });
    $('figmaStatus').textContent = `Figma: "${s.name}" loaded, ${s.components} components`;
    if (key) {
      try { await chrome.storage.local.set({ [key]: { ...s.raw, savedAt: Date.now() } }); }
      catch (err) { addTrace('fail', 'Could not cache the Figma design', err.message); }
    }
  } catch (err) {
    const cached = key && (await chrome.storage.local.get(key))[key];
    if (cached?.root) {
      const s = useDesign(cached);
      $('figmaStatus').textContent = `${err.message} Using the copy saved ${new Date(cached.savedAt).toLocaleString()} ("${s.name}", ${s.components} components).`;
    } else {
      $('figmaStatus').textContent = `Figma design not loaded: ${err.message}`;
    }
  }
}
$('loadFigma').addEventListener('click', async () => {
  await chrome.storage.local.set({ figmaUrl: $('figmaUrl').value.trim(), figmaToken: $('figmaToken').value.trim() });
  await loadDesign({ fresh: true });
});

function applyBridgeSettings() {
  configureBridge({ url: $('bridgeUrl').value.trim(), token: $('bridgeToken').value.trim() });
}

async function checkBridge() {
  if (!$('bridgeToken').value.trim()) return false;
  try {
    const info = await bridgeRequest('hello', {}, 5000);
    settingsStatus(`Bridge connected: ${info.project} (${info.sourceFiles} source files)`, 'ok');
    addTrace('pass', `Bridge connected: ${info.project}`, `${info.sourceFiles} source files in ${info.root}`);
    return true;
  } catch (err) {
    settingsStatus(`Bridge not connected: ${err.message}`, 'bad');
    addTrace('error', 'Bridge not connected', err.message);
    return false;
  }
}

async function loadSettings() {
  const s = await chrome.storage.local.get([...FIELDS, 'mode', 'allowEscalation']);
  for (const f of FIELDS) if (s[f]) $(f).value = s[f];
  $('allowEscalation').checked = !!s.allowEscalation;
  document.querySelector(`input[name="mode"][value="${s.mode || 'cloud'}"]`).checked = true;
  applyBridgeSettings();
  showReadiness();
  if (s.figmaUrl && s.figmaToken) loadDesign();
}

function provider(which) {
  return which === 'local'
    ? { name: 'Muse Glimmer (local)', apiKey: $('localKey').value.trim(), model: $('localModel').value.trim(), baseUrl: $('localUrl').value.trim() }
    : { name: 'Muse Spark (cloud)', apiKey: $('apiKey').value.trim(), model: $('model').value.trim(), baseUrl: $('baseUrl').value.trim() };
}

const ready = () => (mode() === 'cloud' ? !!$('apiKey').value.trim() : !!$('localUrl').value.trim());

function showReadiness() {
  const m = mode();
  if (m === 'cloud' && !$('apiKey').value.trim()) setStatus('Add your Meta API key in Settings (gear icon)', 'bad');
  else setStatus(m === 'local' ? 'Local mode: nothing leaves this laptop' : m === 'auto' ? 'Auto: local first, cloud if needed' : 'Ready · Muse Spark', '');
  updateRunButton();
}

document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', async () => {
  await chrome.storage.local.set({ mode: mode() });
  showReadiness();
}));

$('save').addEventListener('click', async () => {
  const values = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  await chrome.storage.local.set({ ...values, mode: mode(), allowEscalation: $('allowEscalation').checked });
  settingsStatus('Saved', 'ok');
  applyBridgeSettings();
  showReadiness();
  await checkBridge();
});

$('test').addEventListener('click', async () => {
  const p = provider(mode() === 'cloud' ? 'cloud' : 'local');
  settingsStatus(`Testing ${p.name}…`);
  try {
    const msg = await callMuseSpark([{ role: 'user', content: 'Reply with exactly: pixelPerfect connected' }], p, false);
    settingsStatus(`${p.name}: ${(msg.content || '').slice(0, 40)}`, 'ok');
  } catch (err) {
    settingsStatus(`Connection failed: ${err.message}`, 'bad');
  }
});

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

// ── Stepper: Inspect → Explain → Fix → Verify ────────────────────────────────
const STEPS = ['inspect', 'explain', 'fix', 'verify'];
const STAGE_OF = {
  inspect_element: 'inspect', get_structure: 'inspect', get_component: 'inspect', get_figma_match: 'inspect',
  get_matched_rules: 'explain', find_in_source: 'explain', read_file: 'explain', get_figma_spec: 'explain',
  preview_css: 'fix', preview_stylesheet: 'fix', undo_preview: 'fix', propose_source_edit: 'fix', withdraw_source_edit: 'fix',
  verify: 'verify', verify_responsive: 'verify', stress_test: 'verify', check_states: 'verify'
};

// stage: one of STEPS, 'finished', 'failed' or null (reset)
function setStepper(stage) {
  const items = [...$('stepper').children];
  const at = stage === 'finished' || stage === 'failed' ? 3 : STEPS.indexOf(stage);
  items.forEach((li, i) => {
    li.classList.toggle('done', stage === 'finished' ? true : at >= 0 && i < at);
    li.classList.toggle('active', at >= 0 && i === at && stage !== 'finished');
    li.classList.toggle('finished', stage === 'finished');
    li.classList.toggle('failed', stage === 'failed' && i === 3);
  });
}

// ── Picking elements ──────────────────────────────────────────────────────────
$('pick').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  tabId = tab.id;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-main.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['verify.js', 'stress.js', 'states.js', 'content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'PP_PICK' });
    $('pick').textContent = 'Picking… (Esc to stop)';
  } catch (err) {
    setStatus('Could not open the picker on this page', 'bad');
    addTrace('error', 'Could not open the picker', `${err.message}\nThis works on normal web pages and localhost, not on chrome:// pages.`);
  }
});

// Automatic pairing (only used with the optional Vite plugin): trust only local pages and a local bridge.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type !== 'PP_BRIDGE_HINT') return;
  try {
    const page = new URL(sender.tab?.url || '');
    const [wsUrl, token] = String(msg.value).split('#');
    const bridge = new URL(wsUrl);
    if (!LOCAL_HOSTS.has(page.hostname) || !LOCAL_HOSTS.has(bridge.hostname) || bridge.protocol !== 'ws:' || !/^[a-f0-9]{8,64}$/i.test(token || '')) return;
    if ($('bridgeToken').value.trim() === token && $('bridgeUrl').value.trim() === wsUrl) return;
    $('bridgeUrl').value = wsUrl;
    $('bridgeToken').value = token;
    await chrome.storage.local.set({ bridgeUrl: wsUrl, bridgeToken: token });
    applyBridgeSettings();
    await checkBridge();
  } catch { /* ignore malformed hints */ }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'PP_SELECTED') return;
  if (sender.tab?.id) tabId = sender.tab.id;
  elements = msg.elements;
  if (!msg.picking) $('pick').textContent = 'Pick again';
  renderSelection();
  resetRunView();
  updateRunButton();
  if (!msg.picking) $('goal').focus();
});

const humanize = (s) => s.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
const fileAndLine = (src) => {
  const m = String(src || '').match(/([^/\\]+?):(\d+)(?::\d+)?$/);
  return m ? { file: m[1], line: Number(m[2]) } : src ? { file: String(src).split(/[/\\]/).pop(), line: null } : null;
};

function renderSelection(where) {
  const has = elements.length > 0;
  $('emptySelection').hidden = has;
  $('elementRow').hidden = !has;
  $('clearSelection').hidden = !has;
  $('countBtn').hidden = !has;
  if (!has) { $('selection').hidden = true; return; }

  const e = elements[0];
  const main = e.classes.find((c) => !c.startsWith('fixel')) || e.tag;
  $('elName').textContent = humanize(main.replace(/__/g, ' ')).slice(0, 40);
  $('elClass').textContent = e.classes.length ? '.' + e.classes.slice(0, 2).join('.') : `<${e.tag}>`;
  const loc = where || fileAndLine(e.source);
  $('elWhere').textContent = loc ? `in ${loc.file}${loc.line ? ` · line ${loc.line}` : ''}` : `${e.size}${e.children ? ` · ${e.children} children` : ''}`;
  $('countText').textContent = `${elements.length} element${elements.length === 1 ? '' : 's'}`;

  const list = $('selection');
  list.start = 0;
  list.replaceChildren(...elements.map((el) => {
    const li = document.createElement('li');
    const cls = el.classes.length ? '.' + el.classes.slice(0, 2).join('.') : '';
    li.textContent = [`<${el.tag}${el.id ? '#' + el.id : ''}${cls}>  ${el.size}`, el.text ? `"${el.text.slice(0, 60)}"` : '', el.source || ''].filter(Boolean).join('\n');
    return li;
  }));
}

$('countBtn').addEventListener('click', () => {
  const open = $('selection').hidden;
  $('selection').hidden = !open;
  $('countBtn').setAttribute('aria-expanded', String(open));
});

// Removes the green outlines from the page and empties the selection.
async function clearSelection() {
  await sendToPage({ type: 'PP_CLEAR_SELECTION' });
  elements = [];
  renderSelection();
  $('pick').textContent = 'Pick elements';
  updateRunButton();
}
$('clearSelection').addEventListener('click', clearSelection);

// ── Running the agent ─────────────────────────────────────────────────────────
function updateRunButton() {
  $('run').disabled = running || !elements.length || !ready();
  $('breakIt').disabled = $('run').disabled;
}

// "Break it": the same agent, asked to stress-test instead of fix.
$('breakIt').addEventListener('click', () => {
  const extra = $('goal').value.trim();
  $('goal').value = `Break it: stress-test the selected block and report what breaks. Do not fix anything yet.${extra ? ` Focus: ${extra}` : ''}`;
  $('run').click();
});

$('goal').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('run').click();
});

$('run').addEventListener('click', async () => {
  const goal = $('goal').value.trim();
  if (!goal || running) return;
  running = true;
  updateRunButton();
  if (session.turns.length && state.pendingEdits.length) {
    session.notes.push('Your previous proposal was NOT applied to the code; its preview is still on the page. Build on it or replace it, and propose the complete change again.');
  }
  resetRunView();
  resetRun();
  setStepper('inspect');
  setFooter('working');
  let outcome = null;
  try {
    const m = mode();
    outcome = await runWith(m === 'cloud' ? 'cloud' : 'local', goal);
    if (m === 'auto' && !outcome?.verified) {
      if ($('allowEscalation').checked && $('apiKey').value.trim()) {
        addTrace('fail', 'Local model could not verify a fix', 'Discarding its previews and escalating to Muse Spark (cloud). Details of the selected elements will be sent to the Meta Model API.');
        await sendToPage({ type: 'PP_DISCARD' });
        resetRun();
        Object.assign(run, { previewed: false, firstFailing: null, lastVerify: null, responsive: null, previews: [] });
        outcome = await runWith('cloud', goal);
      } else {
        addTrace('fail', 'Local model could not verify a fix', 'Cloud escalation is off. Allow it in Settings, or switch to Cloud mode.');
      }
    }
  } catch (err) {
    addTrace('error', 'Agent stopped', err.message);
    $('traceCard').hidden = false;
  }
  running = false;
  run.verified = !!outcome?.verified;
  if (outcome?.messages) { session.messages = outcome.messages; session.notes = []; }
  updateRunButton();
  const summary = await showResult();
  if (outcome) {
    session.turns.push({ goal, ...summary });
    renderThread();
    $('goal').value = '';
  }
});

async function runWith(which, goal) {
  const p = provider(which);
  addTrace('', `Using ${p.name}`, which === 'local' ? 'Everything stays on this laptop.' : 'Details of the selected elements are sent to the Meta Model API.');
  setStatus(`${p.name} is working…`);
  try {
    const fig = figmaSummary();
    const context = fig ? `Figma design loaded: "${fig.name}" (${fig.components} components). Use get_figma_match when the request is about matching the design.` : 'No Figma design loaded.';
    return await runAgent({ goal, element: elements, tabId, settings: p, onStep, context, history: session.messages, notes: session.notes });
  } catch (err) {
    addTrace('error', `${p.name} stopped`, err.message);
    $('traceCard').hidden = false;
    setStatus(err.message.slice(0, 90), 'bad');
    return { verified: false, error: err.message };
  }
}

async function sendToPage(message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return null; }
}

// ── Result: root cause, live preview, checks, actions, footer ────────────────
async function showResult() {
  const page = await sendToPage({ type: 'PP_PREVIEW_MODE', mode: 'changes' });
  const edits = state.pendingEdits;
  const hasChanges = !!page?.hasChanges || edits.length > 0;
  const alreadyMet = run.verified && !run.firstFailing && !hasChanges;

  // Root cause, and where it lives in the code.
  const cause = extractSection(run.answer, 'CAUSE') || (alreadyMet ? extractSection(run.answer, 'ANSWER') || firstSentence(run.answer) : '');
  if (cause || run.answer) {
    $('causeBlock').hidden = false;
    $('causeBlock').querySelector('h3').textContent = alreadyMet ? 'Already matches' : 'Root Cause';
    $('causeText').textContent = cause || firstSentence(run.answer);
  }
  const loc = edits[0] ? { file: edits[0].file.split('/').pop(), line: firstChangedLine(edits[0]) } : null;
  if (loc) renderSelection(loc);

  // Code change (diff) and action bar.
  renderEdits(edits);
  $('copyCss').hidden = !(hasChanges && previewCssText());
  const source = hasChanges && !edits.length ? await sourceStatus(tabId) : null;
  $('applyCode').disabled = !edits.length;
  $('applyNote').textContent = edits.length
    ? 'Apply Fix writes this to your files, removes the preview, and re-checks the page on the real code.'
    : !hasChanges ? ''
    : source?.reason === 'live-site' ? 'Live site: preview only. pixelPerfect does not change code for sites that are not your local project. The CSS is in the answer.'
    : source?.reason === 'no-bridge' ? 'No source change: the bridge is not reachable. Start it with node bridge/index.js <your project> and check the token in Settings.'
    : 'The agent did not propose a code change. Send a follow-up: "propose the code change".';
  $('actionBar').hidden = !hasChanges;
  $('toggleDiff').setAttribute('aria-pressed', 'false');
  $('diffCard').hidden = !(hasChanges && !edits.length);   // explain why Apply is off

  renderChecks();
  setPreviewButtons(false);

  // Stepper, status and footer.
  if (run.verified) setStepper('finished'); else if (run.lastVerify || run.responsive || run.stress) setStepper('failed');
  const responsiveOk = run.responsive?.allPass === true;
  let summary;
  const breakOnly = (run.stress || run.states) && !run.previewed && !edits.length;
  if (breakOnly) {
    const all = breakResults();
    const broke = all.filter((r) => !r.held);
    const tried = all.filter((r) => r.applicable).length;
    if (broke.length) { setStatus(`${broke.length} of ${tried} tests found problems: see Break test`, 'bad'); setFooter('broken'); }
    else { setStatus(`Held up in all ${tried} tests`, 'ok'); setFooter('held'); }
    setStepper(broke.length ? 'failed' : 'finished');
    summary = { outcome: broke.length ? `Break test: ${broke.length} problem${broke.length === 1 ? '' : 's'} (${broke.slice(0, 2).map((r) => r.label.replace(/<[^>]*>\s*/, '')).join(', ')}${broke.length > 2 ? '…' : ''})` : `Break test: held up in all ${tried} tests`, kind: broke.length ? 'bad' : 'ok' };
  }
  else if (alreadyMet) { setStatus('Already matches. Nothing to change', 'ok'); setFooter('already'); summary = { outcome: 'Already matches, nothing changed', kind: 'ok' }; }
  else if (run.verified && responsiveOk) { setStatus('Fix ready to apply', 'ok'); setFooter('verified-all'); summary = { outcome: `Verified fix${edits.length ? ` ready: ${edits[0].file.split('/').pop()}` : ''}`, kind: 'ok' }; }
  else if (run.verified) { setStatus('Fix ready to apply', 'ok'); setFooter('verified-one'); summary = { outcome: `Verified fix${edits.length ? ` ready: ${edits[0].file.split('/').pop()}` : ''}`, kind: 'ok' }; }
  else if (run.lastVerify) { setStatus('Not verified: see Checks', 'bad'); setFooter('failed'); summary = { outcome: 'Not verified', kind: 'bad' }; }
  else { setStatus(run.answer ? 'Done' : 'Stopped', run.answer ? '' : 'bad'); setFooter('idle'); summary = { outcome: firstSentence(run.answer) || 'Stopped', kind: run.answer ? '' : 'bad' }; }

  if (hasChanges && elements.length) await captureShots();
  return summary;
}

const clean = (s) => String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim();
function extractSection(text, name) {
  const m = String(text || '').match(new RegExp(`\\**${name}\\**\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\**(?:CAUSE|FIX|VERIFIED|NOT TESTED|My interpretation)\\b|$)`, 'i'));
  return m ? clean(m[1]).replace(/\s+/g, ' ').slice(0, 320) : '';
}
const firstSentence = (t) => clean(t).split(/(?<=[.!?])\s/)[0]?.slice(0, 240) || '';
function firstChangedLine(edit) {
  const m = (edit.diff || '').match(/^- (\d+)/m) || (edit.diff || '').match(/^\s+(\d+) /m);
  return m ? Number(m[1]) + (/^- /m.test(edit.diff) ? 0 : 1) : edit.line;
}

$('viewCode').addEventListener('click', async () => {
  const edit = state.pendingEdits[0] || lastApplied;
  const target = edit ? { file: edit.file, line: edit.line } : fileAndLine(elements[0]?.source) && { file: elements[0].source, line: 1 };
  if (!target) { $('diffCard').hidden = false; return; }
  try { await openInEditor(target); }
  catch (err) { $('diffCard').hidden = false; addTrace('error', 'Could not open the editor', err.message); }
});

// Opens a file in VS Code through the bridge; falls back to a vscode:// link if the "code" command isn't installed.
async function openInEditor(target) {
  const r = await bridgeRequest('open_in_editor', target);
  if (r?.opened === false && r.fallbackUrl?.startsWith('vscode://file/')) {
    await chrome.tabs.update(tabId, { url: r.fallbackUrl }).catch(() => window.open(r.fallbackUrl));
    setStatus('Opening in VS Code…', '');
  }
  return r;
}

// Checks grid: only the checks the agent actually ran.
const PRETTY = { 'font-weight': 'Weight', 'font-size': 'Font size', 'background-color': 'Background', 'border-top-left-radius': 'Corners', 'border-radius': 'Corners', 'row-gap': 'Gap', 'column-gap': 'Gap', 'justify-content': 'Justify', 'align-items': 'Align' };
const TYPE_LABEL = { centered: 'Centered', aligned: 'Aligned', visible: 'Visible', no_overflow: 'No overflow' };
function checkItems(result) {
  const items = [];
  const rs = result?.results || [];
  const pad = rs.filter((r) => r.type === 'css' && /^padding-(top|right|bottom|left)$/.test(r.property || r.summary?.split(':')[0]) && r.target === 'selected element');
  const padNames = new Set(pad.map((r) => r.summary.split(':')[0]));
  const padSame = pad.length === 4 && padNames.size === 4 && new Set(pad.map((r) => String(r.expected))).size === 1;
  if (padSame) items.push({ label: `Padding: ${pad[0].expected}`, pass: pad.every((r) => r.pass) });
  for (const r of rs) {
    if (padSame && pad.includes(r)) continue;
    const prop = r.summary?.split(':')[0];
    const who = r.target && r.target !== 'selected element' && !/^#\d+ selected element$/.test(r.target) ? `${r.target.replace(/^#\d+ /, '').replace(/"/g, '').slice(0, 14)} ` : '';
    let label;
    if (r.type === 'css') label = `${who}${PRETTY[prop] || humanize(prop || 'Style')}: ${r.expected}`;
    else if (r.type === 'contrast') label = `Contrast: ${String(r.actual).replace(':1', '')}:1`;
    else if (r.type === 'spacing') label = `Spacing: ${r.expected}`;
    else if (r.type === 'size') label = `Size`;
    else if (r.type === 'lines') label = `${who}One line`;
    else label = `${who}${TYPE_LABEL[r.type] || humanize(r.type || 'Check')}`;
    items.push({ label, pass: !!r.pass });
  }
  return items;
}

// Break test results, with a Show button that puts one attack on the page so you can see it.
const breakResults = () => [...(run.stress?.results || []), ...(run.states?.results || [])];
const SHOWABLE = new Set(['long_text', 'long_word', 'big_numbers', 'empty', 'many_items', 'big_font', 'narrow', 'rtl']);

function renderStress() {
  const all = breakResults();
  $('stressCard').hidden = !all.length;
  if (!all.length) return;
  const r = { results: all };
  const tried = r.results.filter((x) => x.applicable);
  const held = tried.filter((x) => x.held).length;
  $('stressCount').textContent = `${held} / ${tried.length} held`;
  $('stressCount').className = `count${held === tried.length ? '' : ' bad'}`;
  const order = [...r.results].sort((a, b) => (a.held - b.held) || (b.applicable - a.applicable));
  $('stressList').replaceChildren(...order.map((x) => {
    const li = document.createElement('li');
    li.className = !x.applicable ? 'na' : x.held ? 'held' : 'broke';
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<svg class="state"><use href="#${!x.applicable || x.held ? 'i-check-circle' : 'i-x-circle'}"/></svg><span class="name"></span>`;
    row.querySelector('.name').textContent = x.label + (!x.applicable ? ' (not applicable)' : x.error ? ` (${x.error})` : '');
    if (x.applicable && SHOWABLE.has(x.attack) && run.stress?.results.includes(x)) {
      const btn = document.createElement('button');
      btn.className = 'btn ghost small show';
      btn.textContent = shownAttack === x.attack ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(shownAttack === x.attack));
      btn.addEventListener('click', async () => {
        const next = shownAttack === x.attack ? null : x.attack;
        const res = await sendToPage({ type: 'PP_TOOL', name: 'stress_show', args: { attack: next } });
        if (res?.error) { addTrace('error', 'Could not show the attack', res.error); return; }
        shownAttack = next;
        renderStress();
      });
      row.appendChild(btn);
    }
    li.appendChild(row);
    const lines = [...(x.problems || []), ...(!x.problems?.length && x.changes?.length ? [`changes: ${x.changes.slice(0, 3).join('; ')}`] : [])];
    if (lines.length) {
      const ul = document.createElement('ul');
      ul.className = 'problems';
      for (const p of lines.slice(0, 4)) { const i = document.createElement('li'); i.textContent = p; ul.appendChild(i); }
      li.appendChild(ul);
    }
    return li;
  }));
}

function renderChecks() {
  const items = run.lastVerify ? checkItems(run.lastVerify) : [];
  if (run.responsive) items.push({ label: 'Responsive', pass: run.responsive.allPass === true });
  $('checksCard').hidden = items.length === 0;
  if (!items.length) return;
  const passed = items.filter((i) => i.pass).length;
  $('checksCount').textContent = `${passed} / ${items.length} passed`;
  $('checksCount').className = `count${passed === items.length ? '' : ' bad'}`;
  $('checksList').replaceChildren(...items.slice(0, 12).map((i) => {
    const li = document.createElement('li');
    li.className = i.pass ? 'pass' : 'fail';
    li.innerHTML = `<svg class="state"><use href="#${i.pass ? 'i-check-circle' : 'i-x-circle'}"/></svg><span></span>${i.pass ? '<svg class="tick"><use href="#i-check"/></svg>' : ''}`;
    li.querySelector('span').textContent = i.label;   // label text never goes through innerHTML
    li.title = i.label;
    return li;
  }));
  const warnings = run.lastVerify?.warnings || [];
  $('warnNote').hidden = !warnings.length;
  $('warnNote').textContent = warnings.length ? `⚠ ${warnings.length} nearby element${warnings.length === 1 ? '' : 's'} moved. Expected if the fix changes size; see View Details.` : '';
}

$('viewDetails').addEventListener('click', () => { $('traceCard').hidden = false; $('traceCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('hideTrace').addEventListener('click', () => { $('traceCard').hidden = true; });

// Footer
function setFooter(kind) {
  const f = $('footer');
  f.className = 'footer' + (['verified-all', 'verified-one', 'already', 'applied', 'held'].includes(kind) ? ' verified' : ['failed', 'applied-failed', 'broken'].includes(kind) ? ' failed' : '');
  const text = {
    idle: 'Nothing changed yet',
    working: 'Working…',
    already: 'Already matches: no change needed',
    'verified-all': 'Fix verified across mobile, tablet and desktop',
    'verified-one': `Fix verified at this screen size`,
    failed: 'Not verified yet',
    applied: 'Applied and re-verified on your code',
    'applied-failed': 'Applied, but the real code fails a check',
    broken: 'Break test found problems. Nothing was changed',
    held: 'Break test passed. Nothing was changed'
  }[kind] || '';
  $('footerText').textContent = text + (kind === 'verified-all' || kind === 'applied' ? ' ✓' : '');
  for (const w of [375, 768, 1280]) {
    const icon = $(`dev${w}`);
    const r = run.responsive?.byWidth?.find((b) => b.width === w);
    icon.classList.toggle('ok', !!r?.allPass);
    icon.classList.toggle('fail', !!r && !r.allPass);
  }
}

// ── Live preview: real before/after screenshots of the element ───────────────
function setPreviewButtons(showingOriginal) {
  $('showOriginal').setAttribute('aria-pressed', String(showingOriginal));
  $('showChanges').setAttribute('aria-pressed', String(!showingOriginal));
}
$('showOriginal').addEventListener('click', async () => { const s = await sendToPage({ type: 'PP_PREVIEW_MODE', mode: 'original' }); if (s) setPreviewButtons(true); });
$('showChanges').addEventListener('click', async () => { const s = await sendToPage({ type: 'PP_PREVIEW_MODE', mode: 'changes' }); if (s) setPreviewButtons(false); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureShots() {
  $('previewCard').hidden = false;
  $('shotNote').hidden = true;
  setBadges();
  try {
    const tab = await chrome.tabs.get(tabId);
    await sendToPage({ type: 'PP_MARKERS', visible: false });
    await sendToPage({ type: 'PP_PREVIEW_MODE', mode: 'original' });
    await wait(300);
    const boxBefore = await sendToPage({ type: 'PP_ELEMENT_BOX' });
    const before = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await sendToPage({ type: 'PP_PREVIEW_MODE', mode: 'changes' });
    await wait(650);   // Chrome allows about two screenshots per second
    const boxAfter = await sendToPage({ type: 'PP_ELEMENT_BOX' });
    const after = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await sendToPage({ type: 'PP_MARKERS', visible: true });
    if (boxBefore) $('shotBefore').src = await crop(before, boxBefore);
    if (boxAfter) $('shotAfter').src = await crop(after, boxAfter);
    const offscreen = [boxBefore, boxAfter].some((b) => b && (b.y < 0 || b.y + b.height > b.viewportHeight));
    if (offscreen) { $('shotNote').hidden = false; $('shotNote').textContent = 'Part of the element is outside the visible page; scroll it into view and run again for a full picture.'; }
  } catch (err) {
    await sendToPage({ type: 'PP_MARKERS', visible: true });
    $('shotNote').hidden = false;
    $('shotNote').textContent = `Couldn't capture screenshots (${err.message}). Use Original / Changes to compare on the page.`;
  }
  setPreviewButtons(false);
}

async function crop(dataUrl, box) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = img.naturalWidth / box.viewportWidth;
  const pad = 12;
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const w = Math.min(box.viewportWidth - x, box.width + pad * 2), h = Math.min(box.viewportHeight - y, box.height + pad * 2);
  if (w <= 0 || h <= 0) throw new Error('the element is not on screen');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, x * scale, y * scale, w * scale, h * scale, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

// Badges show the first measured difference: the value before, and the value after the fix.
function setBadges() {
  const failed = run.firstFailing?.results?.find((r) => !r.pass && r.type === 'css' && r.actual != null);
  const prop = failed?.summary?.split(':')[0];
  const shortProp = prop ? (prop.replace(/-(top|right|bottom|left)$/, '').replace('border-top-left-radius', 'radius')) : '';
  const after = failed && run.lastVerify?.results?.find((r) => r.summary?.split(':')[0] === prop && r.pass);
  $('badgeBefore').hidden = !failed;
  $('badgeAfter').hidden = !after;
  if (failed) $('badgeBefore').textContent = `${shortProp} ${failed.actual}`;
  if (after) $('badgeAfter').textContent = `${shortProp} ${after.actual}`;
}

// ── Diff, Apply, Discard, Undo ────────────────────────────────────────────────
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

// The previewed CSS as rules you can paste: inline previews get a selector for their element,
// and the !important used only for previewing is removed.
function selectorFor(e) {
  if (!e) return '/* selected element */';
  if (e.id) return `#${CSS.escape(e.id)}`;
  return e.tag + (e.classes || []).map((c) => `.${CSS.escape(c)}`).join('');
}
function previewCssText() {
  const parts = (run.previews || []).map((p) => {
    const css = p.css.replace(/\s*!important/gi, '').trim();
    if (!css) return '';
    if (p.element === undefined) return css;
    const decls = css.split(';').map((d) => d.trim()).filter(Boolean).map((d) => `  ${d};`).join('\n');
    return `${selectorFor(elements[p.element])} {\n${decls}\n}`;
  }).filter(Boolean);
  return parts.length ? `/* pixelPerfect preview (${run.verified ? 'verified' : 'NOT verified'}), ${new Date().toLocaleString()} */\n${parts.join('\n\n')}\n` : '';
}
$('copyCss').addEventListener('click', async () => {
  const text = previewCssText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    $('copyCss').querySelector('span').textContent = 'Copied ✓';
    setTimeout(() => { $('copyCss').querySelector('span').textContent = 'Copy CSS'; }, 1600);
  } catch (err) {
    addTrace('error', 'Could not copy', err.message);
  }
});

$('toggleDiff').addEventListener('click', () => {
  const open = $('diffCard').hidden;
  $('diffCard').hidden = !open;
  $('toggleDiff').setAttribute('aria-pressed', String(open));
});

let lastApplied = null;

$('applyCode').addEventListener('click', async () => {
  const edits = state.pendingEdits.map(({ file, find, replace }) => ({ file, find, replace }));
  if (!edits.length) return;
  $('applyCode').disabled = true;
  setStatus('Writing to your files…');
  try {
    const result = await bridgeRequest('apply_edits', { edits, label: (session.turns.at(-1)?.goal || $('goal').value.trim()).slice(0, 80) });
    lastApplied = { file: state.pendingEdits[0].file, line: state.pendingEdits[0].line, files: result.files };
    addTrace('pass', `Applied to code: ${result.files.join(', ')}`, state.pendingEdits.map((e) => `${e.file}:${e.line}  ${e.reason}`).join('\n'));
  } catch (err) {
    addTrace('error', 'Could not apply to code', err.message);
    setStatus(`Apply failed: ${err.message}`.slice(0, 90), 'bad');
    $('applyCode').disabled = false;
    return;
  }

  await sendToPage({ type: 'PP_DISCARD' });
  state.pendingEdits = [];
  $('actionBar').hidden = true;
  $('diffCard').hidden = true;
  setStatus('Waiting for the page to reload…');
  await wait(1500);
  const ok = await reverify();
  $('appliedSummary').textContent = `Changed ${lastApplied.files.join(', ')}. ${ok ? 'The real code passes the same checks.' : 'Check the result on the page.'}`;
  $('applied').hidden = false;
  setFooter(ok ? 'applied' : 'applied-failed');
  session.notes.push(`The developer applied your proposed change(s) to ${lastApplied.files.join(', ')}; the re-check on the real code ${ok ? 'passed' : 'FAILED'}. The source files now contain this change.`);
  updateLastTurn(ok ? 'Applied to code ✓' : 'Applied, re-check failed', ok ? 'ok' : 'bad');
  await clearSelection();
});

async function reverify() {
  const checks = state.lastPassingChecks;
  const stressOk = await rerunStress();
  if (!checks) {
    if (stressOk === null) { setStatus('Applied. No checks to re-run', ''); return false; }
    setStatus(stressOk ? 'Applied, and the break test still holds on your code' : 'Applied, but the break test fails on the real code', stressOk ? 'ok' : 'bad');
    return stressOk;
  }
  if (stressOk === false) { setStatus('Applied, but the break test fails on the real code', 'bad'); return false; }
  const v = await sendToPage({ type: 'PP_TOOL', name: 'verify', args: { checks } });
  if (!v || v.error) {
    addTrace('fail', 'Re-check on the real code could not run', v?.error || 'The page did not answer. If it fully reloaded, pick the element again.');
    setStatus('Applied, not re-checked', 'bad');
    return false;
  }
  run.lastVerify = v;
  renderChecks();
  addTrace(v.allPass ? 'pass' : 'fail', v.allPass ? 'Re-checked on the real code: all checks pass ✓' : 'Re-checked on the real code: some checks fail', v.results.map((r) => r.line).join('\n'));
  setStatus(v.allPass ? 'Applied and verified on your code' : 'Applied, but checks fail on the real code', v.allPass ? 'ok' : 'bad');
  return v.allPass;
}

// After Apply: run the attacks that held in the preview again, on the real code.
async function rerunStress() {
  if (!state.lastStress) return null;
  const r = await runTool(tabId, 'stress_test', state.lastStress);
  if (!r || r.error) { addTrace('fail', 'Break test could not re-run on the real code', r?.error || 'No answer from the page.'); return false; }
  run.stress = r;
  renderStress();
  addTrace(r.allPass ? 'pass' : 'fail', `Break test on the real code: ${r.summary}`, r.results.filter((x) => !x.held).map((x) => `✗ ${x.label}: ${x.problems.join('; ')}`).join('\n'));
  return r.allPass;
}

$('undoCode').addEventListener('click', async () => {
  try {
    const r = await bridgeRequest('undo');
    addTrace('', 'Code change undone', (r.restored || []).join('\n') || r.message);
    $('applied').hidden = true;
    session.notes.push('The developer undid the last code change; the files are back to how they were before it.');
    updateLastTurn('Applied, then undone', '');
    setStatus('Undone', '');
    setFooter('idle');
  } catch (err) {
    addTrace('error', 'Could not undo', err.message);
  }
});

$('openEditor').addEventListener('click', async () => {
  if (!lastApplied) return;
  try { await openInEditor({ file: lastApplied.file, line: lastApplied.line }); }
  catch (err) { addTrace('error', 'Could not open the editor', err.message); }
});

$('discard').addEventListener('click', async () => {
  await sendToPage({ type: 'PP_DISCARD' });
  state.pendingEdits = [];
  if (session.turns.length) {
    session.notes.push('The developer discarded your preview; nothing was written to the code and the page is back to its original state.');
    updateLastTurn('Discarded', '');
  }
  await clearSelection();
  resetRunView();
  setStatus('Changes discarded. The page is back to the original', '');
});

// ── Trace timeline (every step the agent takes; shown under View Details) ─────
let thinkingItem = null;
const lastArgs = {};

function onStep(s) {
  thinkingItem?.remove();
  thinkingItem = null;
  if (s.kind === 'tool') {
    lastArgs[s.name] = s.args;
    let stage = STAGE_OF[s.name];
    if (s.name === 'verify' && !run.previewed) stage = 'explain';   // a verify before any change confirms the problem
    if (stage) setStepper(stage);
    if (s.name.startsWith('preview')) run.previewed = true;
  }
  if (s.kind === 'result' && s.name === 'verify' && s.result?.results) {
    run.lastVerify = s.result;
    if (!s.result.allPass && !run.firstFailing) run.firstFailing = s.result;
    if (s.result.allPass && !s.result.checksChanged && lastArgs.verify?.checks) state.lastPassingChecks = lastArgs.verify.checks;
  }
  if (s.kind === 'result' && s.name === 'verify_responsive' && s.result?.byWidth) run.responsive = s.result;
  if (s.kind === 'result' && s.name === 'check_states' && s.result?.results) { run.states = s.result; renderStress(); }
  if (s.kind === 'result' && s.name === 'stress_test' && s.result?.results) {
    if (!run.firstStress) run.firstStress = s.result;
    run.stress = s.result;
    if (s.result.allPass && lastArgs.stress_test) state.lastStress = lastArgs.stress_test;
    renderStress();
  }
  // Mirror the previews on the page, so "Copy CSS" gives exactly what is applied now.
  if (s.kind === 'result' && !s.result?.error) {
    run.previews ||= [];
    if (s.name === 'preview_stylesheet') run.previews.push({ css: lastArgs.preview_stylesheet?.css || '' });
    if (s.name === 'preview_css') run.previews.push({ css: lastArgs.preview_css?.css || '', element: lastArgs.preview_css?.element ?? 0 });
    if (s.name === 'undo_preview' && /Reverted/.test(s.result?.message || '')) run.previews.pop();
  }
  if (s.kind === 'result' && s.result?.checksChanged) {
    addTrace('fail', 'Doesn\'t count: the agent changed the original checks', s.result.checksChanged.join('\n'));
  }
  if (s.kind === 'final') run.answer = s.text || '';

  if (s.kind === 'result' && s.name === 'propose_source_edit' && s.result?.proposed) {
    addTrace('pass', `← proposed change: ${s.result.file}:${s.result.line}`, s.result.diff);
    return;
  }
  if (s.kind === 'thinking') { thinkingItem = addTrace('', `Step ${s.step}: thinking…`); setStatus(`Thinking… (step ${s.step})`); }
  if (s.kind === 'tool') addTrace('tool', `→ ${s.name}`, Object.keys(s.args).length ? JSON.stringify(s.args, null, 2) : '');
  if (s.kind === 'result' && s.name === 'verify' && s.result?.results) {
    const lines = s.result.results.map((r) => r.line);
    if (s.result.warnings?.length) lines.push('', 'Nearby changes:', ...s.result.warnings.map((w) => `⚠ ${w}`));
    addTrace(s.result.allPass ? 'pass' : 'fail', `← verify: ${s.result.allPass ? 'all checks pass' : 'some checks fail'}`, lines.join('\n'));
  } else if (s.kind === 'result' && s.name === 'check_states' && s.result?.results) {
    const lines = s.result.results.map((r) => `${r.held ? '✓' : '✗'} ${r.label}${r.changes?.length ? `  (${r.changes.join('; ')})` : ''}${r.problems?.length ? '\n   ' + r.problems.join('\n   ') : ''}`);
    addTrace(s.result.allPass ? 'pass' : 'fail', `← states: ${s.result.summary}`, lines.join('\n'));
  } else if (s.kind === 'result' && s.name === 'stress_test' && s.result?.results) {
    const lines = s.result.results.map((r) => `${!r.applicable ? '–' : r.held ? '✓' : '✗'} ${r.label}${r.problems?.length ? '\n   ' + r.problems.join('\n   ') : ''}`);
    addTrace(s.result.allPass ? 'pass' : 'fail', `← break test: ${s.result.summary}`, lines.join('\n'));
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
  return li;
}

['apiKey', 'localUrl'].forEach((f) => $(f).addEventListener('input', updateRunButton));
renderSelection();
loadSettings();