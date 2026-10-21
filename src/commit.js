// The one place component files are written, created, moved or removed (INV-05).
// store.js calls writeComponent for every edit it applies; workspace.js calls the file-level ones
// for create, rename and delete, each with the author and a summary that it records as a revision
// and announces as a frame. Nothing else in src/ touches a component .tsx with fs.
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { writeFileAtomic } from './atomic-write.js';

// Atomic replace of an existing component file (edits, hand-edit-safe).
export function writeComponent(file, text) {
  const tmp = join(dirname(file), `.${basename(file)}.tmp-${process.pid}`);
  writeFileSync(tmp, text); renameSync(tmp, file);
}
// A new component file; fails if it exists.
export function createComponent(file, text) { writeFileSync(file, text, { flag: 'wx' }); }
// Remove a component file (and optionally its sidecar).
export function removeComponent(file) { unlinkSync(file); }
// Move a component file to a new name, rewriting its text on the way (rename).
export function moveComponent(from, to, text) { writeFileSync(to, text, { flag: 'wx' }); unlinkSync(from); }
// Sidecar files (<Name>.napkin.json) travel with their component.
export function writeSidecar(file, text) { writeFileAtomic(file, text); } // atomic: a kill mid-write never leaves a truncated sidecar
export function removeSidecar(file) { try { unlinkSync(file); } catch {} }

// CLI init creates a project config only after checking an empty destination.
export function createProjectConfig(file, text) { writeFileSync(file, text, { flag: 'wx' }); }
