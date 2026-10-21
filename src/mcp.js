// MCP server (stdio, newline-delimited JSON-RPC 2.0). A thin proxy: every tool
// call goes to the napkin server's HTTP API (NAPKIN_URL), and the server's SSE stream
// becomes notifications/napkin/change for edits made by anyone but this agent.
import { createInterface } from 'node:readline';
import { connectCanvas } from './canvas-client.js';

const BASE = process.env.NAPKIN_URL || 'http://127.0.0.1:4810/';
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const api = async (path, init) => (await fetch(new URL(path, BASE), init)).json();

const editSchema = { type: 'object', description: '{op:"set",path:"<nodeId>.<cssProp|text|@src|@alt>",value,variant?:{axis:value}} | {op:"insert",parent,index,node} | {op:"delete",id} | {op:"move",id,parent,index} | {op:"addProp"|"removeProp"|"bindText"|"addVariant"|"removeVariant",...}' };
const TOOLS = [
  { name: 'list_components', description: 'List the napkin components in this folder: [{ id, name, readOnly? }].', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_component', description: 'Read a component: its document tree, current revision and the TSX source text (readOnly says why a file cannot be edited).', inputSchema: { type: 'object', properties: { component: { type: 'string' } }, required: ['component'] } },
  { name: 'apply_edits', description: 'Apply a batch of edits, all or nothing, against baseRevision. Fails with "stale revision" if a property you touch changed since; read again and retry. dryRun: true validates and returns the would-be TSX source without writing.', inputSchema: { type: 'object', properties: { component: { type: 'string' }, baseRevision: {}, edits: { type: 'array', items: editSchema }, dryRun: { type: 'boolean' } }, required: ['component', 'baseRevision', 'edits'] } },
  { name: 'create_component', description: 'Create a new component file components/<Name>.tsx (PascalCase name) with one root frame; it appears on the canvas. Returns { id, name }.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, rootTag: { type: 'string' } }, required: ['name'] } },
  { name: 'add_variant', description: 'Add a value to a variant axis (creating the axis if needed, with base value "default" unless given), optionally with style overrides per node, e.g. { component: "Button", baseRevision, axis: "size", value: "xl", overrides: { root: { padding: "14px 28px" } } }.', inputSchema: { type: 'object', properties: { component: { type: 'string' }, baseRevision: {}, axis: { type: 'string' }, value: { type: 'string' }, base: { type: 'string' }, overrides: { type: 'object' }, dryRun: { type: 'boolean' } }, required: ['component', 'baseRevision', 'axis', 'value'] } },
];

const variantEdits = (a) => [
  { op: 'addVariant', axis: a.axis, value: a.value, ...(a.base ? { base: a.base } : {}) },
  ...Object.entries(a.overrides || {}).flatMap(([node, style]) => Object.entries(style).map(([prop, value]) => ({ op: 'set', path: `${node}.${prop}`, value, variant: { [a.axis]: a.value } }))),
];

let live = null; // the SSE subscription, opened lazily so the agent works even if started first
async function subscribe() {
  if (live) return live;
  live = connectCanvas(BASE, { by: 'agent' }).then((c) => {
    c.onChange((ch) => { if (ch.type === 'change' && !ch.mine) send({ method: 'notifications/napkin/change', params: { component: ch.component, revision: ch.revision, by: ch.by, edits: ch.edits } }); });
    return c;
  }).catch((e) => { live = null; throw e; });
  return live;
}

// Presence (F16): say what this agent is editing while it works; clear it after a quiet moment.
const quiet = new Map();
function presence(component, label) {
  const post = (l) => fetch(new URL('api/presence', BASE), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component, label: l }) }).catch(() => {});
  clearTimeout(quiet.get(component));
  const p = post(label);
  quiet.set(component, setTimeout(() => post(null), Number(process.env.NAPKIN_PRESENCE_MS || 1500)));
  return p;
}
function describe(name, a, compName) {
  if (name === 'add_variant') return `agent: editing ${compName} / ${a.axis}=${a.value}`;
  const e = a.edits?.[0];
  const node = e?.path?.split('.')[0] || e?.id || e?.parent || e?.name;
  const v = e?.variant ? ` / ${Object.entries(e.variant).map(([k, x]) => `${k}=${x}`).join(' ')}` : '';
  return `agent: editing ${compName}${node ? ` · ${node}` : ''}${v}`;
}

async function callTool(name, a = {}) {
  const c = encodeURIComponent(a.component ?? '');
  if (name === 'list_components') return api('api/components');
  if (name === 'read_component') return api(`api/components/${c}`);
  if (name === 'create_component') {
    const r = await api('api/components', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: a.name, rootTag: a.rootTag }) });
    if (!r.ok) throw new Error(r.error);
    return { id: r.id, name: r.name };
  }
  if (name === 'apply_edits' || name === 'add_variant') {
    const { origin } = await subscribe();
    const edits = name === 'add_variant' ? variantEdits(a) : a.edits;
    if (!a.dryRun) await presence(a.component, describe(name, a, a.component));
    const r = await api(`api/components/${c}/edits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: a.baseRevision, edits, by: 'agent', origin, dryRun: !!a.dryRun }) });
    if (!r.ok) throw new Error(r.error);
    return r.dryRun ? { dryRun: true, revision: r.revision, source: r.source } : { revision: r.revision };
  }
  throw new Error(`unknown tool ${name}`);
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'parse error' } }); }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications from the client
  if (method === 'initialize') {
    subscribe().catch(() => {});
    return send({ id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'napkin', version: '0.1.0' } } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    try {
      const data = await callTool(params.name, params.arguments);
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: Array.isArray(data) ? { components: data } : data } });
    } catch (e) {
      return send({ id, result: { isError: true, content: [{ type: 'text', text: String(e.message) }] } });
    }
  }
  send({ id, error: { code: -32601, message: `method not found: ${method}` } });
});
