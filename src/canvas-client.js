// Variant A canvas socket: Server-Sent Events down (GET /api/events), HTTP POST up.
// Isomorphic: the browser page and Node tests use this same module (fetch streaming, no EventSource).
export async function connectCanvas(baseUrl, { by = 'canvas', component = 'Card' } = {}) {
  const origin = Math.random().toString(36).slice(2);
  const ctrl = new AbortController();
  const listeners = [];
  let current = null;
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));

  const res = await fetch(new URL('api/events', baseUrl), { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
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
          current = { revision: msg.revision, doc: msg.doc };
          if (msg.type === 'state') resolveFirst();
          else listeners.forEach((cb) => cb({ ...msg, mine: msg.origin === origin }));
        }
      }
    } catch (e) { if (e.name !== 'AbortError') console.error('napkin: event stream ended', e); }
  })();
  await first;

  return {
    origin,
    state: () => current,
    onChange: (cb) => listeners.push(cb),
    async sendEdits(baseRevision, edits) {
      const r = await fetch(new URL(`api/components/${component}/edits`, baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision, edits, by, origin }),
      });
      return r.json();
    },
    close: () => ctrl.abort(),
  };
}
