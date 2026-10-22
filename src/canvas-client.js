// The canvas socket: Server-Sent Events down (GET /api/events), HTTP POST up.
// Isomorphic: the browser page and Node tests use this same module (fetch streaming, no EventSource).
//   const c = await connectCanvas(baseUrl, { by })   (by: your name, default "you"; the server issues a session token for it)     resolves once every component's state has arrived
//   c.components()          [{ component, name, revision, doc, readOnly?, problem? }]
//   c.state(idOrName)       one of those (kept current), or undefined
//   c.onChange(cb)          cb(frame) for every frame after the first state: change | problem | added | removed | build;
//                           frames carry `component`, and `mine: true` for edits this client sent
//   c.sendEdits(component, baseRevision, edits)   same result shape as store.apply
//
// Reconnecting (REL-03): when the stream ends (the server restarted, the network dropped) the client retries with a short
// backoff (50 ms, doubling, at most 500 ms), takes a fresh session token and a complete fresh snapshot, then tells its listeners
// what differs: `change` (revision, doc, read-only state or problem differ), `added`, `removed`, `canvas`, `preview`.
// Frames: { type: 'connection', connected: false|true } on every loss and return.
// Writes are never replayed. While the stream is down, or if the request is cut off, sendEdits answers
// { ok: false, error: 'stale revision: ...' }: the caller reads the component again before retrying (the edit may have landed).
export async function connectCanvas(baseUrl, { by = 'you', identify = true } = {}) {
  const origin = Math.random().toString(36).slice(2);
  const ctrl = new AbortController();
  const listeners = [];
  const early = []; // non-state frames that arrive before 'ready' (agents, presence), replayed to each listener
  let ready = false, connected = false;
  const comps = new Map(); // id -> snapshot
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));

  // Who is writing is decided by the server from this token, not from the request body.
  const newSession = () => (identify ? fetch(new URL('api/session', baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: by }), signal: ctrl.signal }).then((r) => r.json()).then((j) => j.token) : Promise.resolve(undefined));
  let tokenP = newSession();
  const stream = () => fetch(new URL(`api/events?by=${encodeURIComponent(by)}`, baseUrl), { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
  const initial = await stream();
  if (!initial.ok) throw new Error(`event stream: HTTP ${initial.status}`);

  const emit = (msg) => {
    const f = { ...msg, mine: msg.origin === origin };
    if (!ready) { early.push(f); return; }
    for (const cb of [...listeners]) cb(f);
  };
  const snapshot = (m, seq = 1) => ({ seq, component: m.component, name: m.name, path: m.path, canvas: m.canvas, preview: m.preview, revision: m.revision, doc: m.doc, readOnly: m.readOnly, problem: m.problem });
  const apply = (msg) => {
    if (msg.type === 'added') comps.set(msg.component, snapshot(msg));
    else if (msg.type === 'canvas') { const c = comps.get(msg.component); if (c) c.canvas = msg.canvas; }
    else if (msg.type === 'preview') { const c = comps.get(msg.component); if (c) c.preview = msg.preview; }
    else if (msg.type === 'change') { const c = comps.get(msg.component); if (c) Object.assign(c, { seq: (c.seq || 1) + 1, revision: msg.revision, doc: msg.doc, name: msg.doc?.name || c.name, readOnly: msg.doc ? undefined : c.readOnly }); else comps.set(msg.component, { component: msg.component, name: msg.doc?.name || msg.component, revision: msg.revision, doc: msg.doc }); }
    else if (msg.type === 'problem') { const c = comps.get(msg.component); if (c) c.problem = msg.error || undefined; }
    else if (msg.type === 'removed') comps.delete(msg.component);
    if (msg.type !== 'state') emit(msg);
  };
  // After a reconnect: replace everything with the fresh snapshot, then say what differs.
  const resync = (incoming) => {
    const previous = new Map(comps);
    comps.clear();
    for (const [id, c] of incoming) { const p = previous.get(id); comps.set(id, p ? { ...c, seq: (p.seq || 1) + (p.revision !== c.revision ? 1 : 0) } : c); }
    for (const [id, c] of comps) {
      const p = previous.get(id);
      if (!p) emit({ type: 'added', ...c, by: 'file', origin: 'reconnect' });
      else {
        if (p.revision !== c.revision || p.readOnly !== c.readOnly || JSON.stringify(p.doc) !== JSON.stringify(c.doc)) emit({ type: 'change', component: id, revision: c.revision, doc: c.doc, by: 'file', origin: 'reconnect' });
        if (p.problem !== c.problem) emit({ type: 'problem', component: id, error: c.problem || null });
        if (JSON.stringify(p.canvas) !== JSON.stringify(c.canvas)) emit({ type: 'canvas', component: id, canvas: c.canvas });
        if (JSON.stringify(p.preview) !== JSON.stringify(c.preview)) emit({ type: 'preview', component: id, preview: c.preview });
      }
    }
    for (const id of previous.keys()) if (!comps.has(id)) emit({ type: 'removed', component: id });
  };
  const pause = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); ctrl.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    ctrl.signal.addEventListener('abort', done, { once: true });
  });

  (async () => {
    let response = initial, backoff = 50;
    while (!ctrl.signal.aborted) {
      let reader;
      try {
        if (!response) response = await stream();
        if (!response.ok) throw new Error(`event stream: HTTP ${response.status}`);
        reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        const incoming = new Map(), held = []; let buf = '';
        const again = ready; // a reconnect: collect the whole snapshot first, then compare it with what the page has
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
            if (msg.type === 'ready') {
              if (again) {
                tokenP = newSession(); await tokenP.catch(() => {});
                resync(incoming);
                for (const m of held) { if (m.component && m.type !== 'build') apply(m); else emit(m); }
                connected = true; backoff = 50; emit({ type: 'connection', connected: true });
              } else { ready = true; connected = true; backoff = 50; resolveFirst(); }
              continue;
            }
            if (again && !connected) { if (msg.type === 'state') incoming.set(msg.component, snapshot(msg)); else held.push(msg); continue; }
            if (msg.type === 'state') comps.set(msg.component, snapshot(msg)); else apply(msg);
          }
        }
      } catch { /* the server went away or the network dropped: resnapshot below */ }
      finally {
        if (connected && !ctrl.signal.aborted) emit({ type: 'connection', connected: false });
        connected = false; response = null;
        try { await reader?.cancel(); } catch {}
      }
      if (!ctrl.signal.aborted) { await pause(backoff); backoff = Math.min(backoff * 2, 500); }
    }
  })();
  await first;

  const state = (idOrName) => comps.get(idOrName) || [...comps.values()].find((c) => c.name === idOrName);
  const stale = { ok: false, error: 'stale revision: the connection to napkin was interrupted. Next: read the component again, then retry (the edit may have landed).' };
  return {
    origin,
    components: () => [...comps.values()],
    state,
    connected: () => connected,
    onChange: (cb) => { listeners.push(cb); for (const m of early) cb({ ...m, mine: false }); },
    // fetch for any /api write: adds this client's session token (the server decides who is calling from it).
    async fetch(path, init = {}) { const t = await tokenP.catch(() => undefined); return fetch(new URL(path.replace(/^\//, ''), baseUrl), { ...init, headers: { ...init.headers, ...(t && { authorization: `Bearer ${t}` }) } }); },
    async sendEdits(component, baseRevision, edits) {
      if (!connected || ctrl.signal.aborted) return stale;
      try {
        const t = await tokenP;
        const r = await fetch(new URL(`api/components/${encodeURIComponent(component)}/edits`, baseUrl), {
          method: 'POST', headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) },
          body: JSON.stringify({ baseRevision, edits, origin }),
        });
        return await r.json();
      } catch { return stale; }
    },
    close: () => ctrl.abort(),
  };
}
