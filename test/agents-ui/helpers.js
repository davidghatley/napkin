// Shared bits for the agents lane's page tests.
import { connectCanvas } from '../../src/canvas-client.js';
import { open as openPage, sleep, waitFor } from '../history/page.js';
import { http, session } from '../helpers/agents.js';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export { sleep, waitFor };
export async function openAgents(names = ['Button', 'Card', 'Chip'], size) {
  const p = await openPage(names, size);
  const agents = new Map();
  // A scripted agent: a roster connection (so the top bar knows it) plus an HTTP session (so its writes and presence are its own).
  p.agent = async (name) => {
    if (agents.has(name)) return agents.get(name);
    const live = await connectCanvas(p.server.url, { by: 'agent', identify: false, name });
    const token = await session(p.server.url, name);
    const a = {
      name, live, token,
      async presence(component, node, o = {}) { return http(p.server.url, '/api/presence', { method: 'POST', token, body: { component, node, label: `${name}: editing ${component}${node ? ' · ' + node : ''}`, ...o } }); },
      async apply(component, edits, o = {}) {
        const cur = (await http(p.server.url, `/api/components/${component}`)).json.revision;
        return (await http(p.server.url, `/api/components/${component}/edits`, { method: 'POST', token, body: { baseRevision: o.baseRevision ?? cur, edits, ...(o.propose && { propose: true }) } })).json;
      },
      disconnect() { live.close(); agents.delete(name); },
    };
    agents.set(name, a);
    return a;
  };
  // docs/evidence/<name>.png when EVIDENCE_OUT is set (under 300 KB each)
  p.shot = async (name) => {
    if (!process.env.EVIDENCE_OUT) return;
    mkdirSync(process.env.EVIDENCE_OUT, { recursive: true });
    const f = join(process.env.EVIDENCE_OUT, `${name}.png`);
    writeFileSync(f, await p.browser.screenshot());
    if (statSync(f).size > 300 * 1024) throw new Error(`${f} is over 300 KB`);
  };
  const close = p.close;
  p.close = async () => { for (const a of agents.values()) a.live.close(); await close(); };
  return p;
}
