// The canvas socket: Server-Sent Events down (GET /api/events), HTTP POST up.
// Isomorphic: the browser page and Node tests use this same module (fetch streaming, no EventSource).
//   const c = await connectCanvas(baseUrl, { by })     resolves once every component's state has arrived
//   c.components()          [{ component, name, revision, doc, readOnly?, problem? }]
//   c.state(idOrName)       one of those (kept current), or undefined
//   c.onChange(cb)          cb(frame) for every frame after the first state: change | problem | added | removed | build;
//                           frames carry `component`, and `mine: true` for edits this client sent
//   c.sendEdits(component, baseRevision, edits)   same result shape as store.apply
export async function connectCanvas(baseUrl, { by = 'canvas' } = {}) {
  const origin = Math.random().toString(36).slice(2);
  const ctrl = new AbortController();
  const listeners = [];
  const early = []; // non-state frames that arrive before 'ready' (agents, presence), replayed to each listener
  let ready = false;
  const comps = new Map(); // id -> snapshot
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));

  const res = await fetch(new URL(`api/events?by=${encodeURIComponent(by)}`, baseUrl), { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
  const apply = (msg) => {
    if (msg.type === 'state' || msg.type === 'added') comps.set(msg.component, { component: msg.component, name: msg.name, revision: msg.revision, doc: msg.doc, readOnly: msg.readOnly, problem: msg.problem });
    else if (msg.type === 'change') { const c = comps.get(msg.component); if (c) Object.assign(c, { revision: msg.revision, doc: msg.doc, name: msg.doc.name, readOnly: undefined }); else comps.set(msg.component, { component: msg.component, name: msg.doc.name, revision: msg.revision, doc: msg.doc }); }
    else if (msg.type === 'problem') { const c = comps.get(msg.component); if (c) c.problem = msg.error || undefined; }
    else if (msg.type === 'removed') comps.delete(msg.component);
  };
  (async () => {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (!data) continue;
          const msg = JSON.parse(data);
          if (msg.type === 'ready') { ready = true; resolveFirst(); continue; }
          apply(msg);
          if (!ready && msg.type !== 'state') { early.push(msg); continue; }
          if (msg.type !== 'state') listeners.forEach((cb) => cb({ ...msg, mine: msg.origin === origin }));
        }
      }
    } catch (e) { if (e.name !== 'AbortError') console.error('napkin: event stream ended', e); }
  })();
  await first;

  const state = (idOrName) => comps.get(idOrName) || [...comps.values()].find((c) => c.name === idOrName);
  return {
    origin,
    components: () => [...comps.values()],
    state,
    onChange: (cb) => { listeners.push(cb); for (const m of early) cb({ ...m, mine: false }); },
    async sendEdits(component, baseRevision, edits) {
      const r = await fetch(new URL(`api/components/${encodeURIComponent(component)}/edits`, baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision, edits, by, origin }),
      });
      return r.json();
    },
    close: () => ctrl.abort(),
  };
}
