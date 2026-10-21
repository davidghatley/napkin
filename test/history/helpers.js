// A workspace and API in one process (no HTTP), over a temp git repo, for the history lane's server tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { openWorkspace } from '../../src/workspace.js';
import { createApi } from '../../src/api.js';
import { tempRepo, sleep, waitFor } from '../helpers/harness.js';

export async function rig(names = ['Card', 'Button'], { napkinJson } = {}) {
  const repo = tempRepo(names);
  if (napkinJson) writeFileSync(`${repo.compDir}/napkin.json`, JSON.stringify(napkinJson));
  const ws = await openWorkspace(repo.compDir);
  const api = createApi(ws, { dir: repo.compDir });
  const tokens = {};
  const as = async (name) => (tokens[name] ??= (await api.session(name)).json.token);
  const call = async (name, method, path, body) => { const u = new URL(path, 'http://x'); const r = await api.handle({ method, path: u.pathname, query: u.searchParams, body: JSON.stringify(body ?? {}), token: name ? await as(name) : undefined }); return { ...(r.json ?? r), status: r.status }; };
  const read = (n) => readFileSync(repo.fileOf(n), 'utf8');
  const rev = async (n) => (await call(null, 'GET', `/api/components/${n}`)).revision;
  const edit = async (name, comp, edits) => call(name, 'POST', `/api/components/${comp}/edits`, { baseRevision: await rev(comp), edits });
  const history = async (n, limit = 50) => (await call(null, 'GET', `/api/components/${n}/history?limit=${limit}`)).history;
  return { ...repo, ws, api, as, call, read, rev, edit, history, async close() { await api.close(); await ws.close(); } };
}
export { sleep, waitFor };
