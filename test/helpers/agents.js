// Small helpers for the agents-lane tests.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './harness.js';

export const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const http = async (base, path, { method = 'GET', body } = {}) => {
  const r = await fetch(new URL(path.replace(/^\//, ''), base), { method, ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json() };
};
// Recorded evidence (docs/evidence/<ID>.txt) is only written when EVIDENCE=1, so plain test runs leave git clean.
export function evidence(id, text) {
  if (!process.env.EVIDENCE) return;
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', `${id}.txt`), text.endsWith('\n') ? text : text + '\n');
}
export const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
