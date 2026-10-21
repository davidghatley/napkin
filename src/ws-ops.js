// File-level component operations the store does not cover: rename and delete.
// (create lives in workspace.js.) Like create, these move whole files; content edits still go through store.apply.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CreateError } from './workspace.js';
import { readComponent } from './tsx/read.js';
import { sidecarPath } from './codecs.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; }

export async function deleteComponent(ws, idOrName) {
  const e = ws.find(idOrName);
  if (!e) throw new CreateError('not found', 404);
  const { id, name, file } = e;
  unlinkSync(file);
  try { unlinkSync(sidecarPath(file)); } catch {}
  if (!(await until(() => !ws.find(id)))) throw new Error(`deleted ${name}.tsx but the workspace did not notice`);
  return { id, name };
}

// Renames the file, the exported function and its Props interface; the component id stays.
export async function renameComponent(ws, idOrName, newName) {
  const e = ws.find(idOrName);
  if (!e) throw new CreateError('not found', 404);
  if (typeof newName !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(newName)) throw new CreateError(`component name "${newName}" must be PascalCase (letters and digits, starting with a capital)`);
  const { readOnly, source, doc } = await e.store.read();
  if (readOnly) throw new CreateError(`read-only: ${readOnly}`, 403);
  const old = doc.name;
  if (old === newName) return { id: e.id, name: newName };
  const taken = ws.entries().some((x) => x !== e && x.name.toLowerCase() === newName.toLowerCase());
  const file = join(ws.dir, `${newName}.tsx`);
  if (taken || existsSync(file)) throw new CreateError(`component "${newName}" already exists`, 409);
  const text = source.replace(new RegExp(`\\bfunction ${old}\\b`), `function ${newName}`).replace(new RegExp(`\\b${old}Props\\b`, 'g'), `${newName}Props`);
  try { if (readComponent(text).doc.name !== newName) throw new Error('name not rewritten'); }
  catch (err) { throw new CreateError(`could not rename safely: ${err.message}`); }
  const side = JSON.parse(readFileSync(sidecarPath(e.file), 'utf8'));
  const oldFile = e.file, id = e.id;
  writeFileSync(file, text, { flag: 'wx' });
  writeFileSync(sidecarPath(file), JSON.stringify(side, null, 2) + '\n');
  unlinkSync(oldFile); try { unlinkSync(sidecarPath(oldFile)); } catch {}
  if (!(await until(() => ws.find(id)?.file === file))) throw new Error('renamed the file but the workspace did not notice');
  return { id, name: newName };
}

// Components and nodes whose name, id, tag or text contain the query (case-insensitive).
export async function search(ws, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const e of ws.entries()) {
    const { doc } = await e.store.read();
    if (e.name.toLowerCase().includes(q)) out.push({ kind: 'component', component: e.id, name: e.name });
    if (!doc) continue;
    (function walk(n) {
      const text = typeof n.text === 'string' ? n.text : null;
      const why = n.id.toLowerCase().includes(q) ? 'id' : n.tag.toLowerCase() === q ? 'tag' : text?.toLowerCase().includes(q) ? 'text' : null;
      if (why) out.push({ kind: 'node', component: e.id, name: e.name, node: n.id, tag: n.tag, ...(text !== null && { text }), match: why });
      for (const c of n.children || []) walk(c);
    })(doc.root);
  }
  return out;
}
