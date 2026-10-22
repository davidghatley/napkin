// The one place component files are written, created, moved or removed (INV-05). store.js calls writeComponent for every
// edit it applies; workspace.js calls the file-level ones for create, rename and delete, each with the author and a
// summary that it records as a revision and announces as a frame. Nothing else in src/ touches a component .tsx with fs.
// Every write goes through writeFileAtomic (REL-01): temp file in the same folder, fsync, rename; a new file is created
// exclusively (link), so it can never replace one that exists.
import { unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.js';

// Atomic replace of an existing component file. opts.check() runs just before the rename (a hand edit that landed meanwhile cancels it).
export function writeComponent(file, text, opts) { writeFileAtomic(file, text, opts); }
// A new component file; throws EEXIST if it exists.
export function createComponent(file, text) { writeFileAtomic(file, text, { exclusive: true }); }
// Remove a component file (and optionally its sidecar).
export function removeComponent(file) { unlinkSync(file); }
// Move a component file to a new name, rewriting its text on the way (rename).
export function moveComponent(from, to, text) { writeFileAtomic(to, text, { exclusive: true }); unlinkSync(from); }
// Sidecar files (<Name>.napkin.json) travel with their component.
export function writeSidecar(file, text) { writeFileAtomic(file, text); }
export function createSidecar(file, text) { writeFileAtomic(file, text, { exclusive: true }); }
export function removeSidecar(file) { try { unlinkSync(file); } catch {} }
// Pasted images (LAY-10): <components folder>/assets/<content hash>.<ext>. Same bytes, same name, so a second paste changes nothing.
export function writeAsset(dir, name, bytes) {
  const folder = join(dir, 'assets');
  mkdirSync(folder, { recursive: true });
  try { writeFileAtomic(join(folder, name), bytes, { exclusive: true }); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}

// CLI init creates a project config only after checking an empty destination.
export function createProjectConfig(file, text) { writeFileAtomic(file, text, { exclusive: true }); }

// Token source is authoritative; generated CSS (when owned by napkin) follows it.
// Both files use the shared fsync + atomic rename writer.
export function writeTokens(file, text, generated) {
  writeFileAtomic(file, text);
  if (generated) writeFileAtomic(generated.file, generated.text);
}
