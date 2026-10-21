// Small helpers for the agents-lane tests.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './harness.js';

export const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// token: a bearer token (see session()); without one the server treats the call as anonymous (reads only).
export const http = async (base, path, { method = 'GET', body, token } = {}) => {
  const headers = { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) };
  const r = await fetch(new URL(path.replace(/^\//, ''), base), { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json() };
};
// A session token for a name: the server, not the request body, decides who is calling.
export const session = async (base, as, token) => (await http(base, '/api/session', { method: 'POST', body: { as, token } })).json.token;
// Recorded evidence (docs/evidence/<ID>.txt) is only written when EVIDENCE=1, so plain test runs leave git clean.
export function evidence(id, text) {
  if (!process.env.EVIDENCE) return;
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', `${id}.txt`), text.endsWith('\n') ? text : text + '\n');
}
export const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
