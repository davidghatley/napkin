// Presence (AGT-03): where each connected agent is working right now, with a colour that stays the same for a name.
//   const p = createPresence({ broadcast, ttl })
//   p.color(name) -> { color, ink }           stable per name for the life of the server (hash start, then the next free colour)
//   p.set(name, { component, node?, variant?, label?, ttl? })   broadcasts a `presence` frame and clears itself after ttl ms of quiet
//   p.clear(name)                             broadcasts the clearing frame now (label null)
//   p.frames() -> [frame]                     the live ones, for a new SSE client
//   p.connect(name) / p.disconnect(name)      one SSE connection of an agent; disconnect clears its presence at once
//   p.agentsFrame() -> { type: 'agents', count, agents: [{ name, color, ink }] }
// Seven colours, none of them the selection blue or the measure red; `ink` is the text colour that reads on it (>= 4.5:1).
export const PALETTE = [
  { color: '#c2255c', ink: '#ffffff' }, { color: '#0b7285', ink: '#ffffff' }, { color: '#e67700', ink: '#1a1000' }, { color: '#7048e8', ink: '#ffffff' },
  { color: '#2f9e44', ink: '#06140a' }, { color: '#f59f00', ink: '#1a1000' }, { color: '#8c5a2b', ink: '#ffffff' },
];
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const MAX_TTL = 3000; // an agent may ask for longer; nobody is shown as "there" for more than 3 s without a new signal
export function createPresence({ broadcast = () => {}, ttl = Number(process.env.NAPKIN_PRESENCE_TTL_MS || 700) } = {}) {
  const colors = new Map(); // name -> palette index
  const live = new Map();   // name -> { frame, timer }
  const conns = new Map();  // name -> open SSE connections
  const color = (name) => {
    if (!colors.has(name)) {
      const used = new Set(colors.values());
      let i = hash(name) % PALETTE.length;
      for (let n = 0; n < PALETTE.length && used.has(i); n++) i = (i + 1) % PALETTE.length;
      colors.set(name, i);
    }
    return PALETTE[colors.get(name)];
  };
  const clear = (name) => {
    const cur = live.get(name);
    if (!cur) return;
    clearTimeout(cur.timer); live.delete(name);
    broadcast({ type: 'presence', agent: name, ...color(name), component: cur.frame.component, node: null, variant: null, label: null, at: Date.now() });
  };
  const set = (name, { component, node = null, variant = null, label = null, ttl: own } = {}) => {
    const prev = live.get(name);
    clearTimeout(prev?.timer);
    const frame = { type: 'presence', agent: name, ...color(name), component, node, variant, label: label || (prev?.frame.component === component && prev.frame.label) || `${name} is editing`, at: Date.now() }; // an automatic update (from a change frame) keeps the label the agent gave
    const wait = Math.min(Math.max(Number(own) || ttl, 100), MAX_TTL);
    const timer = setTimeout(() => clear(name), wait);
    timer.unref?.();
    live.set(name, { frame, timer, wait });
    broadcast(frame);
    return frame;
  };
  return {
    color, set, clear,
    frames: () => [...live.values()].map((x) => x.frame),
    connect(name) { conns.set(name, (conns.get(name) || 0) + 1); color(name); },
    disconnect(name) { const n = (conns.get(name) || 1) - 1; if (n > 0) conns.set(name, n); else { conns.delete(name); clear(name); } },
    agentsFrame: () => ({ type: 'agents', count: [...conns.values()].reduce((a, b) => a + b, 0), agents: [...conns.keys()].map((name) => ({ name, ...color(name) })) }),
  };
}
