// How the store reads and writes each file type. A codec bundles the format with its edit rules,
// so store.js stays the same single commit path (decision 0002) for both.
//   load(text, file) -> { doc, state }          throws on unreadable files
//   save(state, before, after) -> { text, state }
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { parse, serialize } from './format.js';
import * as spikeEdits from './edits.js';
import * as model from './model.js';
import { readComponent } from './tsx/read.js';
import { writeComponent } from './tsx/write.js';

// The 18 Oct spike format (decision 0001), kept until the canvas moves to TSX (M2).
export const jsonCodec = {
  kind: 'napkin/0',
  load: (text) => ({ doc: parse(text), state: null }),
  save: (state, before, after) => ({ text: serialize(after), state }),
  ...spikeEdits,
};

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

export const codecFor = (file) => (basename(file).endsWith('.tsx') ? tsxCodec : jsonCodec);
