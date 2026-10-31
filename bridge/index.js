#!/usr/bin/env node
// pixelPerfect bridge: lets the extension find, read and edit source files in ONE project folder.
//
//   node bridge/index.js ./demo-app
//
// Safety:
// - listens on 127.0.0.1 only, and accepts connections only from Chrome extensions
// - every request must carry the pairing token printed at startup
// - only files inside the project folder, with source-file extensions, outside node_modules/.git/dist
// - every write is all-or-nothing and can be undone
import { WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const ROOT = fss.realpathSync(path.resolve(process.argv[2] || '.'));
const PORT = Number(process.env.PP_PORT || 7777);
const TOKEN = process.env.PP_TOKEN || crypto.randomBytes(4).toString('hex');
const EXTS = new Set(['.css', '.scss', '.sass', '.less', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte', '.html']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.vite', '.turbo']);
const MAX_FILE = 1024 * 1024;
const history = [];   // [{ label, files: [{ abs, content }] }]

// ── Paths ────────────────────────────────────────────────────────────────────
function resolveInRoot(file) {
  if (!file || typeof file !== 'string') throw new Error('Missing "file".');
  let p = file.replace(/^file:\/\//, '').split('?')[0];
  p = p.replace(/:\d+(:\d+)?$/, '');                       // strip "file:line:col"
  const abs = path.isAbsolute(p) && p.startsWith(ROOT) ? p : path.resolve(ROOT, p.replace(/^\/+/, ''));
  const real = fss.existsSync(abs) ? fss.realpathSync(abs) : abs;
  const rel = path.relative(ROOT, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`"${file}" is outside the project folder.`);
  if (rel.split(path.sep).some((part) => SKIP_DIRS.has(part))) throw new Error(`"${file}" is in a folder pixelPerfect doesn't touch.`);
  if (!EXTS.has(path.extname(real))) throw new Error(`"${file}" is not a source file pixelPerfect can open.`);
  return { abs: real, rel: rel.split(path.sep).join('/') };
}

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (EXTS.has(path.extname(entry.name))) yield abs;
  }
}

async function readText(abs) {
  const stat = await fs.stat(abs);
  if (stat.size > MAX_FILE) throw new Error(`${path.relative(ROOT, abs)} is too large (${stat.size} bytes).`);
  return fs.readFile(abs, 'utf8');
}

const count = (text, find) => (find ? text.split(find).length - 1 : 0);

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

// Whole-line diff of the region an edit touches, with one line of context on each side.
function diffPreview(text, find, replace) {
  const at = text.indexOf(find);
  const newText = text.slice(0, at) + replace + text.slice(at + find.length);
  const oldLines = text.split('\n');
  const newLines = newText.split('\n');
  const start = lineOf(text, at);
  const oldEnd = lineOf(text, at + find.length);
  const newEnd = lineOf(newText, at + replace.length);
  let oldSeg = oldLines.slice(start - 1, oldEnd);
  let newSeg = newLines.slice(start - 1, newEnd);
  let first = start;
  while (oldSeg.length && newSeg.length && oldSeg[0] === newSeg[0]) { oldSeg = oldSeg.slice(1); newSeg = newSeg.slice(1); first++; }
  while (oldSeg.length && newSeg.length && oldSeg.at(-1) === newSeg.at(-1)) { oldSeg = oldSeg.slice(0, -1); newSeg = newSeg.slice(0, -1); }
  const out = [];
  if (first > 1) out.push(`  ${first - 1} ${oldLines[first - 2]}`);
  oldSeg.forEach((l, k) => out.push(`- ${first + k} ${l}`));
  newSeg.forEach((l) => out.push(`+   ${l}`));
  const after = first + oldSeg.length;
  if (oldLines[after - 1] !== undefined) out.push(`  ${after} ${oldLines[after - 1]}`);
  return out.join('\n');
}

// ── Actions ──────────────────────────────────────────────────────────────────
const actions = {
  async hello() {
    let files = 0;
    for await (const _ of walk(ROOT)) files++;
    return { project: path.basename(ROOT), root: ROOT, sourceFiles: files };
  },

  // Search source files for text, e.g. a selector ".product-card.featured" or a class name.
  async find_in_source({ query, max = 30 }) {
    if (!query || query.length < 2) throw new Error('Give a "query" of at least 2 characters.');
    const q = query.toLowerCase();
    const matches = [];
    for await (const abs of walk(ROOT)) {
      const text = await readText(abs).catch(() => '');
      text.split('\n').forEach((line, i) => {
        if (matches.length < max && line.toLowerCase().includes(q)) {
          matches.push({ file: path.relative(ROOT, abs).split(path.sep).join('/'), line: i + 1, text: line.trim().slice(0, 200) });
        }
      });
      if (matches.length >= max) break;
    }
    return { query, matches, truncated: matches.length >= max };
  },

  async read_file({ file, start_line = 1, end_line }) {
    const { abs, rel } = resolveInRoot(file);
    const lines = (await readText(abs)).split('\n');
    const from = Math.max(1, start_line);
    const to = Math.min(lines.length, end_line || from + 399);
    return {
      file: rel,
      totalLines: lines.length,
      from, to,
      content: lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(4)}  ${l}`).join('\n')
    };
  },

  // Check that an edit would apply cleanly (the text to replace appears exactly once). Writes nothing.
  async check_edit({ file, find, replace }) {
    const { abs, rel } = resolveInRoot(file);
    if (typeof find !== 'string' || !find) throw new Error('"find" must be the exact text to replace.');
    if (typeof replace !== 'string') throw new Error('"replace" must be a string (use "" to delete).');
    const text = await readText(abs);
    const n = count(text, find);
    if (n === 0) return { ok: false, file: rel, error: 'The "find" text does not appear in the file. Copy it exactly from read_file, without line numbers.' };
    if (n > 1) return { ok: false, file: rel, error: `The "find" text appears ${n} times. Include more surrounding lines so it is unique.` };
    return { ok: true, file: rel, line: lineOf(text, text.indexOf(find)), diff: diffPreview(text, find, replace) };
  },

  // Apply several edits, all or nothing. Each: { file, find, replace }.
  async apply_edits({ edits, label = 'pixelPerfect fix' }) {
    if (!Array.isArray(edits) || !edits.length) throw new Error('"edits" must be a non-empty list.');
    const plan = new Map();   // abs -> { rel, original, text }
    for (const e of edits) {
      const { abs, rel } = resolveInRoot(e.file);
      const entry = plan.get(abs) || { rel, original: await readText(abs) };
      const text = entry.text ?? entry.original;
      const n = count(text, e.find);
      if (n !== 1) throw new Error(`${rel}: "find" text appears ${n} times (must be exactly once). Nothing was changed.`);
      entry.text = text.replace(e.find, () => e.replace);
      plan.set(abs, entry);
    }
    history.push({ label, files: [...plan].map(([abs, v]) => ({ abs, content: v.original })) });
    for (const [abs, v] of plan) await fs.writeFile(abs, v.text, 'utf8');
    return { applied: edits.length, files: [...plan.values()].map((v) => v.rel), undoSteps: history.length };
  },

  async undo() {
    const last = history.pop();
    if (!last) return { message: 'Nothing to undo.' };
    for (const f of last.files) await fs.writeFile(f.abs, f.content, 'utf8');
    return { restored: last.files.map((f) => path.relative(ROOT, f.abs)), undoSteps: history.length };
  },

  async open_in_editor({ file, line = 1 }) {
    const { abs, rel } = resolveInRoot(file);
    const editor = process.env.PP_EDITOR || 'code';
    await new Promise((resolve, reject) => {
      const child = spawn(editor, ['-g', `${abs}:${Number(line) || 1}`], { stdio: 'ignore', detached: true });
      child.on('error', () => reject(new Error(`Could not run "${editor}". In VS Code, run "Shell Command: Install 'code' command in PATH".`)));
      child.on('spawn', () => { child.unref(); resolve(); });
    });
    return { opened: `${rel}:${line}` };
  }
};

// ── Server ───────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: PORT,
  verifyClient: ({ origin }) => {
    const ok = typeof origin === 'string' && origin.startsWith('chrome-extension://');
    if (!ok) console.warn(`[bridge] refused a connection from origin: ${origin || '(none)'}`);
    return ok;
  }
});

wss.on('connection', (ws) => {
  console.log('[bridge] extension connected');
  ws.on('message', async (raw) => {
    let msg = {};
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const reply = (body) => ws.send(JSON.stringify({ id: msg.id, ...body }));
    if (msg.token !== TOKEN) return reply({ ok: false, error: 'Wrong pairing token. Copy it from the bridge terminal into pixelPerfect Settings.' });
    const fn = actions[msg.action];
    if (!fn) return reply({ ok: false, error: `Unknown action "${msg.action}".` });
    try {
      const result = await fn(msg.args || {});
      if (['apply_edits', 'undo'].includes(msg.action)) console.log(`[bridge] ${msg.action}:`, JSON.stringify(result));
      reply({ ok: true, result });
    } catch (err) {
      reply({ ok: false, error: err.message });
    }
  });
});

wss.on('listening', () => {
  console.log(`\npixelPerfect bridge`);
  console.log(`  project : ${ROOT}`);
  console.log(`  address : ws://127.0.0.1:${PORT}`);
  console.log(`  token   : ${TOKEN}   ← paste this into pixelPerfect Settings\n`);
});
wss.on('error', (err) => { console.error(`[bridge] ${err.message}`); process.exit(1); });
