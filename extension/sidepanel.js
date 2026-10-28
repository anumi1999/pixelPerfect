import { runAgent, callMuseSpark } from './agent.js';

const $ = (id) => document.getElementById(id);
let tabId = null;
let element = null;     // description of the picked element
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

// ── Picking an element ────────────────────────────────────────────────────────
$('pick').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  tabId = tab.id;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-main.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'PP_PICK' });
    $('pick').textContent = 'Click an element on the page… (Esc to cancel)';
  } catch (err) {
    addTrace('error', 'Could not open the picker', `${err.message}\nTip: this works on normal web pages and localhost, not on chrome:// pages.`);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'PP_SELECTED') return;
  if (sender.tab?.id) tabId = sender.tab.id;
  element = msg.element;
  $('pick').textContent = 'Pick another element';
  const cls = element.classes.length ? '.' + element.classes.join('.') : '';
  const lines = [`<${element.tag}${element.id ? '#' + element.id : ''}${cls}>  ${element.size}`];
  if (element.text) lines.push(`"${element.text}"`);
  if (element.source) lines.push(element.source);
  $('selection').textContent = lines.join('\n');
  $('selection').style.whiteSpace = 'pre-wrap';
  $('selection').hidden = false;
  updateRunButton();
  $('goal').focus();
});

// ── Running the agent ─────────────────────────────────────────────────────────
function updateRunButton() {
  $('run').disabled = running || !element || !$('apiKey').value.trim();
}

$('goal').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('run').click();
});

$('run').addEventListener('click', async () => {
  const goal = $('goal').value.trim();
  if (!goal || running) return;
  running = true;
  updateRunButton();
  $('trace').replaceChildren();
  setStatus('Agent working…');
  try {
    await runAgent({ goal, element, tabId, settings: settings(), onStep });
    setStatus('Done', 'ok');
  } catch (err) {
    addTrace('error', 'Agent stopped', err.message);
    setStatus('Error', 'bad');
  }
  running = false;
  updateRunButton();
});

// ── Trace timeline (every step the agent takes) ───────────────────────────────
let thinkingItem = null;

function onStep(s) {
  thinkingItem?.remove();
  thinkingItem = null;
  if (s.kind === 'thinking') thinkingItem = addTrace('', `Step ${s.step}: thinking…`);
  if (s.kind === 'tool') addTrace('tool', `→ ${s.name}`, Object.keys(s.args).length ? JSON.stringify(s.args, null, 2) : '');
  if (s.kind === 'result') addTrace('', `← ${s.name}`, JSON.stringify(s.result, null, 2), true);
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
