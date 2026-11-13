import { brotliDecompressSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
// Glyph count and table list of a font file, read from its own tables (ttf, otf, woff, woff2).
// Returns null when the file is not a font napkin can read; the viewer then shows no count.
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
export function fontInfo(file) {
  const b = readFileSync(file),
    tag = b.toString('ascii', 0, 4);
  let maxp = null,
    tables = [];
  if (tag === 'wOF2') {
    let at = 48;
    const n = b.readUInt16BE(12),
      dir = [];
    const base128 = () => {
      let v = 0;
      for (let i = 0; i < 5; i++) {
        const c = b[at++];
        v = v * 128 + (c & 127);
        if (!(c & 128)) return v;
      }
      throw new Error('Bad woff2 table length. Next: open the font in its own application.');
    };
    for (let i = 0; i < n; i++) {
      const flags = b[at++],
        idx = flags & 63,
        name = idx === 63 ? (at += 4, b.toString('ascii', at - 4, at)) : WOFF2_TAGS[idx],
        transformed = idx === 10 || idx === 11 ? ((flags >> 6) & 3) === 0 : ((flags >> 6) & 3) !== 0,
        len = base128(),
        stored = transformed ? base128() : len;
      dir.push({ name, stored });
    }
    const data = brotliDecompressSync(b.subarray(at, at + b.readUInt32BE(20)));
    let p = 0;
    for (const t of dir) {
      tables.push(t.name);
      if (t.name === 'maxp') maxp = data.subarray(p, p + t.stored);
      p += t.stored;
    }
  } else if (tag === 'wOFF') {
    for (let i = 0, n = b.readUInt16BE(12); i < n; i++) {
      const e = 44 + i * 20,
        name = b.toString('ascii', e, e + 4);
      tables.push(name);
      if (name === 'maxp') {
        const off = b.readUInt32BE(e + 4),
          comp = b.readUInt32BE(e + 8),
          orig = b.readUInt32BE(e + 12),
          raw = b.subarray(off, off + comp);
        maxp = comp < orig ? inflateSync(raw) : raw;
      }
    }
  } else if (tag === '\0\x01\0\0' || tag === 'OTTO' || tag === 'true') {
    for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
      const e = 12 + i * 16,
        name = b.toString('ascii', e, e + 4);
      tables.push(name);
      if (name === 'maxp') maxp = b.subarray(b.readUInt32BE(e + 8), b.readUInt32BE(e + 8) + 6);
    }
  } else return null;
  return { glyphs: maxp && maxp.length >= 6 ? maxp.readUInt16BE(4) : null, tables };
}
