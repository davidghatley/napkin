// Images and SVGs next to the components (AST-01..04).
// Convention (test/CONTRACT.md): an asset lives in `<components dir>/assets/<sha8>.<ext>`, sha8 being the first 8 hex digits of the
// SHA-256 of its bytes, and a component refers to it by the relative path `assets/<sha8>.<ext>` in an <img src>.
// The same bytes always give the same name, so the same image dropped twice is stored once.
//   saveAsset(dir, bytes, ext) -> { path: 'assets/ab12cd34.png', abs, created, bytes }
// Asset files are not component files, so they do not go through commit.js, but they are written atomically.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { gitDirOf, repoRoot } from './git.js';

export const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' };
export const MAX_BYTES = 8 * 1024 * 1024;
export class AssetError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

const extOf = (e) => String(e ?? '').toLowerCase().replace(/^\./, '');
// A cheap check that the bytes look like what the extension says (a text file called .png is refused).
function looksLike(bytes, ext) {
  const b = Buffer.from(bytes.subarray(0, 16));
  switch (ext) {
    case 'png': return b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case 'jpg': case 'jpeg': return b[0] === 0xff && b[1] === 0xd8;
    case 'gif': return b.subarray(0, 3).toString('latin1') === 'GIF';
    case 'webp': return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'avif': return b.subarray(4, 8).toString('latin1') === 'ftyp';
    case 'svg': return /<svg[\s>]/i.test(Buffer.from(bytes.subarray(0, 2048)).toString('utf8'));
    default: return false;
  }
}

export function saveAsset(dir, bytes, ext) {
  ext = extOf(ext);
  if (!TYPES[ext]) throw new AssetError(`"${ext}" is not an image type napkin stores. Next: use one of ${Object.keys(TYPES).join(', ')}.`);
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!bytes.length) throw new AssetError('the image is empty. Next: send the image bytes.');
  if (bytes.length > MAX_BYTES) throw new AssetError(`the image is ${bytes.length} bytes; the limit is ${MAX_BYTES}. Next: send a smaller image.`, 413);
  if (ext === 'svg' && /<script|\son\w+\s*=|<foreignObject|javascript:/i.test(bytes.toString('utf8'))) throw new AssetError('the SVG has a script, an event handler or a foreignObject, so napkin will not store it. Next: remove them and paste again.', 415);
  if (!looksLike(bytes, ext)) throw new AssetError(`the bytes are not a ${ext} image. Next: check the file type and send it again.`);
  const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${sha8}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const folder = join(dir, 'assets'), abs = join(folder, name);
  if (existsSync(abs)) return { path: `assets/${name}`, abs, created: false, bytes: bytes.length };
  mkdirSync(folder, { recursive: true });
  const tmp = join(folder, `.${name}.tmp-${process.pid}-${Date.now()}`);
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(tmp, abs); } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
  return { path: `assets/${name}`, abs, created: true, bytes: bytes.length };
}

// The top of the tree an asset may be read from: the git repo around the components, else the components folder.
export const assetRoot = (dir) => resolve(gitDirOf(dir) ? repoRoot(dir) : dir);
const SKIP = new Set(['node_modules', '.git', '.napkin', 'dist', 'build', '.next', 'coverage']);

// Every image and SVG in the repo (or folder): [{ path (relative to the root, / separated), name, ext, bytes }], sorted.
export function listAssets(dir, { limit = 2000, depth = 8 } = {}) {
  const root = assetRoot(dir), out = [];
  (function walk(d, level) {
    let names; try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      if (out.length >= limit) return;
      if (n.name.startsWith('.') || SKIP.has(n.name)) continue;
      const p = join(d, n.name);
      if (n.isDirectory()) { if (level < depth) walk(p, level + 1); continue; }
      const ext = extOf(extname(n.name));
      if (!n.isFile() || !TYPES[ext]) continue;
      let size = 0; try { size = statSync(p).size; } catch {}
      out.push({ path: relative(root, p).split(sep).join('/'), name: n.name, ext, bytes: size });
    }
  })(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// Resolve a path from the page to a file: relative to the components folder first (a src like "assets/x.png"), then the root.
// Never outside the root, never anything but an image type. -> { abs, type } | null
export function resolveAsset(dir, p) {
  const root = assetRoot(dir), ext = extOf(extname(String(p)));
  if (!TYPES[ext] || typeof p !== 'string' || p.includes('\0')) return null;
  for (const base of [resolve(dir), root]) {
    const abs = resolve(base, p);
    if (abs !== root && !abs.startsWith(root + sep)) continue;
    if (relative(root, abs).split(sep).some((s) => s.startsWith('.') || SKIP.has(s))) continue;
    try { if (statSync(abs).isFile()) return { abs, type: TYPES[ext] }; } catch {}
  }
  return null;
}
export const readAsset = (abs) => readFileSync(abs);
