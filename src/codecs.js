// How the store reads and writes a component file. A codec bundles the format with its edit rules,
// so store.js stays the single commit path (decision 0002).
//   load(text, file) -> { doc, state }          throws on unreadable files
//   save(state, before, after) -> { text, state }
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import * as model from './model.js';
import { readComponent } from './tsx/read.js';
import { writeComponent } from './tsx/write.js';

// Sidecar <Name>.napkin.json: what isn't code (the stable component id, canvas position).
export function sidecarPath(file) { return file.replace(/\.tsx$/, '.napkin.json'); }
export function readSidecar(file, name) {
  const p = sidecarPath(file);
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const side = { id: `cmp_${name.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase())}_${Math.random().toString(36).slice(2, 8)}`, canvas: { x: 0, y: 0 } };
  writeFileSync(p, JSON.stringify(side, null, 2) + '\n');
  return side;
}

// Components as React TSX in the napkin dialect (decision 0003).
export const tsxCodec = {
  kind: 'napkin/1',
  load(text, file) {
    const { doc, ast } = readComponent(text);
    const side = file ? readSidecar(file, doc.name) : { id: `cmp_${doc.name}` };
    return { doc: { ...doc, id: side.id }, state: { ast, text } };
  },
  save(state, before, after) {
    const strip = ({ id, ...rest }) => rest;
    const text = writeComponent(state.ast, strip(before), strip(after), state.text);
    const { ast } = readComponent(text); // fresh AST and locations for the next edit
    return { text, state: { ast, text } };
  },
  applyEdits: model.applyEdits,
  touched: model.touched,
  conflicts: model.conflicts,
  diffKeys: model.diffKeys,
  EditError: model.EditError,
};

export function codecFor(file) {
  if (basename(file).endsWith('.tsx')) return tsxCodec;
  throw new Error(`napkin opens .tsx component files, not ${basename(file)}`);
}
