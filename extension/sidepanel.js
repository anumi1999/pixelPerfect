import { runAgent, callMuseSpark } from './agent.js';

const $ = (id) => document.getElementById(id);
let tabId = null;
let elements = [];      // descriptions of the picked elements (index = position)
let running = false;

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await chrome.storage.local.get(['apiKey', 'model', 'baseUrl']);
  if (s.apiKey) $('apiKey').value = s.apiKey;
  if (s.model) $('model').value = s.model;
  if (s.baseUrl) $('baseUrl').value = s.baseUrl;
  setStatus(s.apiKey ? 'Ready' : 'Add your Meta API key in Settings', s.apiKey ? 'ok' : 'bad');
  if (!s.apiKey) $('settings').open = true;
}

function settings() {
  return { apiKey: $('apiKey').value.trim(), model: $('model').value.trim(), baseUrl: $('baseUrl').value.trim() };
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set(settings());
  setStatus('Saved', 'ok');
  updateRunButton();
});

$('test').addEventListener('click', async () => {
  setStatus('Testing…');
  try {
    const msg = await callMuseSpark([{ role: 'user', content: 'Reply with exactly: pixelPerfect connected' }], settings(), false);
    setStatus(`Connected: ${(msg.content || '').slice(0, 40)}`, 'ok');
  } catch (err) {
    setStatus('Connection failed', 'bad');
    addTrace('error', 'Connection test', err.message);
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
  $('run').disabled = running || !elements.length || !$('apiKey').value.trim();
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
  $('trace').replaceChildren();
  setStatus('Agent working…');
  try {
    await runAgent({ goal, element: elements, tabId, settings: settings(), onStep });
    setStatus('Done', 'ok');
  } catch (err) {
    addTrace('error', 'Agent stopped', err.message);
    setStatus('Error', 'bad');
  }
  running = false;
  updateRunButton();
  await refreshReview();
});

// ── Review: see the page with and without the agent's changes ────────────────
async function sendToPage(message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return null; }
}

async function refreshReview() {
  const state = await sendToPage({ type: 'PP_PREVIEW_MODE', mode: 'changes' });
  $('review').hidden = !state?.hasChanges;
  setToggle(false);
}

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
  $('review').hidden = true;
  addTrace('', 'Changes discarded', 'The page is back to its original state.');
});

// ── Trace timeline (every step the agent takes) ───────────────────────────────
let thinkingItem = null;

function onStep(s) {
  thinkingItem?.remove();
  thinkingItem = null;
  if (s.kind === 'thinking') thinkingItem = addTrace('', `Step ${s.step}: thinking…`);
  if (s.kind === 'tool') addTrace('tool', `→ ${s.name}`, Object.keys(s.args).length ? JSON.stringify(s.args, null, 2) : '');
  if (s.kind === 'result' && s.name === 'verify' && s.result?.results) {
    const lines = s.result.results.map((r) => r.line);
    if (s.result.warnings?.length) lines.push('', 'Nearby changes:', ...s.result.warnings.map((w) => `⚠ ${w}`));
    addTrace(s.result.allPass ? 'pass' : 'fail', `← verify: ${s.result.allPass ? 'all checks pass' : 'some checks fail'}`, lines.join('\n'));
  } else if (s.kind === 'result' && s.name === 'verify_responsive' && s.result?.byWidth) {
    const lines = s.result.byWidth.flatMap((w) => [`${w.allPass ? '✓' : '✗'} ${w.width}px`, ...w.lines.map((l) => `   ${l}`)]);
    addTrace(s.result.allPass ? 'pass' : 'fail', `← verify at ${s.result.byWidth.map((w) => w.width).join(' / ')}px`, lines.join('\n'));
  } else if (s.kind === 'result' && s.name === 'get_structure' && s.result?.lines) {
    addTrace('', '← get_structure', s.result.lines.join('\n'), true);
  } else if (s.kind === 'result') {
    addTrace(s.result?.error ? 'error' : '', `← ${s.name}`, JSON.stringify(s.result, null, 2), true);
  }
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

$('apiKey').addEventListener('input', updateRunButton);
loadSettings();
