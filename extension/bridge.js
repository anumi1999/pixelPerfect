// Connection from the side panel to the local pixelPerfect bridge (a WebSocket on 127.0.0.1).
let socket = null;
let config = { url: 'ws://127.0.0.1:7777', token: '' };
let nextId = 1;
const pending = new Map();

export function configureBridge({ url, token }) {
  const changed = url !== config.url || token !== config.token;
  config = { url: url || config.url, token: token || '' };
  if (changed && socket) { socket.close(); socket = null; }
}

export const bridgeConfigured = () => !!config.token;

function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(socket), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to the bridge.')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(config.url);
    socket = ws;
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => {
      socket = null;
      reject(new Error(`Can't reach the bridge at ${config.url}. Start it with: node bridge/index.js <your project folder>`));
    }, { once: true });
    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      for (const [, p] of pending) p.reject(new Error('The bridge disconnected.'));
      pending.clear();
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'Bridge error'));
    });
  });
}

// Sends one request; resolves with the result or rejects with the bridge's error message.
export async function bridgeRequest(action, args = {}, timeoutMs = 20000) {
  if (!config.token) throw new Error('The bridge is not set up. Start it, then paste its token into Settings.');
  const ws = await connect();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`The bridge did not answer "${action}" in time.`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, token: config.token, action, args }));
  });
}
