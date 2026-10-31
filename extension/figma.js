// Figma context: load one page or frame, index its components, match the selected element,
// and turn the matched design into verify checks (the acceptance criteria).
let design = null;   // { fileKey, nodeId, name, components: [...] }

export const figmaLoaded = () => !!design;
export const figmaSummary = () => design ? { name: design.name, components: design.components.length } : null;

// https://www.figma.com/design/<key>/<name>?node-id=12-34  (also /file/ and /proto/)
export function parseFigmaUrl(url) {
  const m = String(url).match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('That is not a Figma file link. In Figma, right-click a frame → Copy link to selection.');
  const node = new URL(url).searchParams.get('node-id');
  return { fileKey: m[1], nodeId: node ? node.replace(/-/g, ':') : null };
}

export async function loadFigma({ url, token, fetchImpl = fetch }) {
  if (!token) throw new Error('Add a Figma personal access token in Settings (Figma → Settings → Security).');
  const { fileKey, nodeId } = parseFigmaUrl(url);
  const endpoint = nodeId
    ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`
    : `https://api.figma.com/v1/files/${fileKey}?depth=4`;
  const res = await fetchImpl(endpoint, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) throw new Error(`Figma returned ${res.status}. Check the token and that you can open this file.`);
  const data = await res.json();
  const root = nodeId ? data.nodes?.[nodeId]?.document : data.document;
  if (!root) throw new Error('Figma did not return that frame. Copy the link again with the frame selected.');
  const components = [];
  index(root, components, 0);
  design = { fileKey, nodeId, name: root.name, components };
  return figmaSummary();
}

// ── Indexing ─────────────────────────────────────────────────────────────────
const CONTAINERS = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'GROUP', 'SECTION']);

function index(node, out, depth) {
  if (node.visible === false || depth > 12) return;
  if (CONTAINERS.has(node.type) && node.children?.length && node.absoluteBoundingBox) {
    out.push({ id: node.id, name: node.name, type: node.type, node, texts: textsIn(node), box: node.absoluteBoundingBox });
  }
  for (const c of node.children || []) index(c, out, depth + 1);
}

function textsIn(node, acc = []) {
  if (node.visible === false) return acc;
  if (node.type === 'TEXT' && node.characters?.trim()) acc.push(norm(node.characters));
  for (const c of node.children || []) textsIn(c, acc);
  return acc;
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// ── Matching ─────────────────────────────────────────────────────────────────
// features: { texts: [...], classes: [...], component, width, height }
export function matchElement(features) {
  if (!design) throw new Error('No Figma design loaded.');
  const elTexts = new Set(features.texts.map(norm));
  const elWords = new Set([...features.classes.flatMap(words), ...words(features.component || '')]);

  const scored = design.components.map((c) => {
    // Text: how many of the design's texts appear in the element, and vice versa.
    const designTexts = [...new Set(c.texts)];
    const hit = designTexts.filter((t) => elTexts.has(t) || [...elTexts].some((e) => e.includes(t) && t.length > 3)).length;
    const textScore = designTexts.length && elTexts.size
      ? (hit / designTexts.length) * 0.5 + (hit / elTexts.size) * 0.5
      : 0;
    // Name: words in the Figma layer name vs class names and component name.
    const nameWords = words(c.name);
    const nameScore = nameWords.length ? nameWords.filter((w) => elWords.has(w)).length / nameWords.length : 0;
    // Size: similar width and height.
    const ratio = (a, b) => (a && b ? Math.min(a, b) / Math.max(a, b) : 0);
    const sizeScore = (ratio(c.box.width, features.width) + ratio(c.box.height, features.height)) / 2;
    const score = textScore * 0.6 + nameScore * 0.25 + sizeScore * 0.15;
    return { id: c.id, name: c.name, score: Math.round(score * 100) / 100, why: { text: `${hit}/${designTexts.length} texts`, name: Math.round(nameScore * 100) / 100, size: Math.round(sizeScore * 100) / 100 } };
  }).sort((a, b) => b.score - a.score);

  const [best, second] = scored;
  const confident = best && best.score >= 0.45 && (!second || best.score - second.score >= 0.1);
  return {
    best: best || null,
    confident,
    candidates: scored.slice(0, 3),
    note: confident ? undefined : 'Low confidence: confirm the match with the developer before changing anything.'
  };
}

// ── Design spec → verify checks ──────────────────────────────────────────────
const hex = (c, opacity = 1) => {
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  const a = (c.a ?? 1) * opacity;
  return `#${to(c.r)}${to(c.g)}${to(c.b)}${a < 0.999 ? to(a) : ''}`;
};
const solidFill = (n) => {
  const f = (n.fills || []).find((p) => p.type === 'SOLID' && p.visible !== false);
  return f ? hex(f.color, f.opacity ?? 1) : null;
};
const solidStroke = (n) => {
  const s = (n.strokes || []).find((p) => p.type === 'SOLID' && p.visible !== false);
  return s ? hex(s.color, s.opacity ?? 1) : null;
};
const firstText = (n) => (n.type === 'TEXT' ? n.characters : (n.children || []).map(firstText).find(Boolean));

export function specFor(id) {
  if (!design) throw new Error('No Figma design loaded.');
  const entry = design.components.find((c) => c.id === id);
  if (!entry) throw new Error(`No Figma node ${id} in the loaded design.`);
  const node = entry.node;
  const checks = [];
  const spec = { name: node.name, size: { width: Math.round(node.absoluteBoundingBox.width), height: Math.round(node.absoluteBoundingBox.height) }, layers: [] };

  containerChecks(node, checks, null, spec);
  walkChildren(node, checks, spec, 0);

  return {
    figma: spec,
    checks,
    note: 'Use these checks as the acceptance criteria. Sizes depend on screen width, so width/height are listed in "figma.size" but not checked. Text layers are found by their text inside the selected element.'
  };
}

function containerChecks(n, checks, target, spec) {
  const t = target ? { target } : {};
  const push = (property, expected) => checks.push({ type: 'css', property, expected: String(expected), ...t });
  if (n.layoutMode && n.layoutMode !== 'NONE') {
    push('padding-top', `${n.paddingTop || 0}px`);
    push('padding-right', `${n.paddingRight || 0}px`);
    push('padding-bottom', `${n.paddingBottom || 0}px`);
    push('padding-left', `${n.paddingLeft || 0}px`);
    if (n.itemSpacing != null && (n.children || []).length > 1) push(n.layoutMode === 'VERTICAL' ? 'row-gap' : 'column-gap', `${n.itemSpacing}px`);
  }
  if (n.cornerRadius != null) push('border-top-left-radius', `${n.cornerRadius}px`);
  const fill = solidFill(n);
  if (fill) push('background-color', fill);
  const stroke = solidStroke(n);
  if (stroke && n.strokeWeight) { push('border-top-width', `${n.strokeWeight}px`); push('border-top-color', stroke); }
  if (spec && target) spec.layers.push({ name: n.name, text: target.text, padding: n.layoutMode ? [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] : undefined, radius: n.cornerRadius, fill });
}

function walkChildren(node, checks, spec, depth) {
  for (const c of node.children || []) {
    if (c.visible === false || depth > 4 || checks.length > 40) continue;
    if (c.type === 'TEXT' && c.characters?.trim()) {
      const text = c.characters.trim().slice(0, 60);
      const s = c.style || {};
      if (s.fontSize) checks.push({ type: 'css', property: 'font-size', expected: `${s.fontSize}px`, target: { text } });
      if (s.fontWeight) checks.push({ type: 'css', property: 'font-weight', expected: String(s.fontWeight), target: { text } });
      const color = solidFill(c);
      if (color) checks.push({ type: 'css', property: 'color', expected: color, target: { text } });
      spec.layers.push({ name: c.name, text, fontSize: s.fontSize, fontWeight: s.fontWeight, color });
    } else if (CONTAINERS.has(c.type) || c.type === 'RECTANGLE') {
      // A nested frame with its own text (e.g. a button) is found by that text.
      const text = firstText(c);
      const ownStyle = (c.layoutMode && c.layoutMode !== 'NONE') || c.cornerRadius != null || solidFill(c);
      if (text && ownStyle && c.children?.length) containerChecks(c, checks, { text: text.trim().slice(0, 60) }, spec);
      walkChildren(c, checks, spec, depth + 1);
    }
  }
}
