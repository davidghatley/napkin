// Shared set-up for the agents lane tests: a temp folder, a server on a free port with its own state dir, and a tiny
// HTTP client that carries a session token per agent name.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/harness.js';

export const SVG = (n = 1) => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><rect x="${n}" y="10" width="40" height="30" fill="#154f65"/><circle cx="90" cy="50" r="20" fill="#f0bd45"/></svg>\n`;

export async function setup(t, { config, files = {}, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-agents3-'));
  const state = join(dir, 'state');
  writeFileSync(join(dir, 'seed.svg'), SVG());
  writeFileSync(join(dir, 'notes.md'), '# Notes\n\nhello\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  if (config) writeFileSync(join(dir, 'napkin.json'), JSON.stringify(config));
  const ctl = { dir, state, server: null, url: null, boots: 0 };
  const boot = async (port = 0) => {
    ctl.server = await startServer(dir, { env: { NAPKIN_STATE_DIR: state, ...env }, port });
    ctl.url = ctl.server.url; ctl.boots++;
    return ctl;
  };
  await boot();
  t.after(async () => { await ctl.server?.stop(); rmSync(dir, { recursive: true, force: true }); });
  ctl.restart = async () => {
    const port = Number(new URL(ctl.url).port);
    await ctl.server.stop();
    return boot(port);
  };
  const clients = new Map();
  ctl.as = async (name) => {
    const key = `${name}@${ctl.boots}`;
    if (clients.has(key)) return clients.get(key);
    // one session per call would be wasteful and would hide identity bugs: keep one token
    const sess = await (await fetch(ctl.url + 'api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: name }) })).json();
    const c = {
      name, token: sess.token,
      async req(method, path, body) {
        const r = await fetch(ctl.url + path.replace(/^\//, ''), { method, headers: { authorization: `Bearer ${sess.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const text = await r.text();
        let json; try { json = JSON.parse(text); } catch { json = text; }
        return { status: r.status, json };
      },
      get: (p) => c.req('GET', p), post: (p, b) => c.req('POST', p, b ?? {}),
    };
    clients.set(key, c);
    return c;
  };
  return ctl;
}
