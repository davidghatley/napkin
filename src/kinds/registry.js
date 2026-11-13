import { extname } from 'node:path';
import { sections, applyNative } from './controls.js';
import { renderViewer, previewData } from './view.js';
import { cardMetadata } from './metadata.js';
const entries = [];
export function registerKind(definition) {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || entries.some((d) => d.id === definition.id))
    throw new Error('Kind ids must be unique lowercase names. Next: fix the kind definition and register it again.');
  for (const key of ['detect', 'metadata', 'viewer', 'controls', 'apply'])
    if (typeof definition[key] !== 'function')
      throw new Error(`Kind ${definition.id} needs ${key}(). Next: add it and register again.`);
  // Every kind's card shows the file's own content from the start: a kind whose metadata gives no preview gets the start of
  // its text (or its first bytes in hex), so a newly registered kind never shows a name sheet instead of the file.
  const own = definition.metadata;
  const wrapped = {
    ...definition,
    metadata(ctx) {
      const meta = own.call(definition, ctx) || {};
      if (meta.preview === undefined && !['image', 'video', 'font', 'pdf'].includes(definition.family)) {
        const binary = /[\x00-\x08\x0e-\x1f]/.test(ctx.text.slice(0, 512));
        meta.preview = binary ? ctx.head.subarray(0, 128).toString('hex') : ctx.text.slice(0, 1400);
      }
      return meta;
    },
  };
  entries.push(Object.freeze(wrapped));
  return wrapped;
}
export const kinds = () => [...entries];
export function detectKind(ctx) {
  let best = null,
    score = 0;
  for (const d of entries) {
    const match = d.detect(ctx),
      value = typeof match === 'number' ? match : match ? 2 : 0;
    if (value >= score && value > 0) {
      best = d;
      score = value;
    }
  }
  if (best) return best;
  throw new Error('No binary fallback registered. Next: fix the kind definition and register it again.');
}
const textMime = 'text/plain; charset=utf-8';
function define(id, extensions, mime, family, magic) {
  return registerKind({
    id,
    extensions,
    mime,
    family,
    detect: (ctx) => {
      const m = magic?.(ctx);
      return m ? (id === 'binary' ? 0.1 : typeof m === 'number' ? m : 2) : extensions.includes(ctx.ext) ? 1 : 0;
    },
    metadata: (ctx) => metadata(ctx, family),
    viewer: (ctx) => renderViewer(ctx),
    preview: (ctx, query) => previewData(ctx, query),
    controls: (ctx) => sections(ctx, entries.map((d) => d.id).sort()),
    apply: (ctx, c, v) =>
      c.target.mode === 'recipe'
        ? { recipe: { ...ctx.recipe, [c.target.key]: v } }
        : { source: applyNative(ctx, c, v) },
  });
}
function metadata(ctx, family) {
  const b = ctx.head,
    meta = { family };
  if (!['image', 'video', 'font', 'pdf'].includes(family))
    meta.preview =
      family === 'binary' ? b.subarray(0, 128).toString('hex') : ctx.text.slice(0, 1400);
  if (ctx.kind === 'png' || ctx.kind === 'apng') {
    if (b.length >= 24 && b.toString('ascii', 12, 16) === 'IHDR') {
      const w = b.readUInt32BE(16),
        h = b.readUInt32BE(20);
      if (w > 0 && h > 0 && w <= 65535 && h <= 65535) {
        meta.width = w;
        meta.height = h;
      }
    }
  }
  if (ctx.kind === 'gif' && b.length >= 10) {
    meta.width = b.readUInt16LE(6);
    meta.height = b.readUInt16LE(8);
    meta.animated = true;
  }
  if (ctx.kind === 'wav' && b.length >= 44) {
    meta.channels = b.readUInt16LE(22);
    meta.sampleRate = b.readUInt32LE(24);
    meta.duration = (ctx.bytes - 44) / (b.readUInt32LE(28) || 1);
  }
  if (family === 'text' || family === 'code') meta.linesInSample = ctx.text.split('\n').length;
  try {
    Object.assign(meta, cardMetadata(ctx, family));
  } catch (e) {
    meta.previewNote = e.message;
  }
  return meta;
}
// Broad fallbacks first, specific magic and content detection last. Plugins have final precedence.
define('binary', [], 'application/octet-stream', 'binary', () => true);
define('txt', ['.txt', '.log'], textMime, 'text', (c) => c.ext === '' && !c.head.includes(0) && 1.1);
define(
  'code',
  [
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.c',
    '.h',
    '.cpp',
    '.hpp',
    '.cs',
    '.sh',
    '.bash',
    '.fish',
    '.lua',
    '.php',
    '.ex',
    '.exs',
    '.elm',
    '.clj',
    '.swift',
    '.kt',
    '.kts',
    '.r',
    '.R',
    '.sql',
    '.nix',
    '.vue',
    '.svelte',
    '.dockerfile',
    '.cmake',
    '.zig',
    '.hs',
    '.pl',
    '.dart',
    '.scala',
    '.jl',
    '.ps1',
    '.bat',
    '.ml',
    '.f90',
    '.v',
    '.sv',
    '.ino',
    '.tex',
  ],
  (c) => (['.js', '.mjs', '.cjs'].includes(c.ext) ? 'text/javascript' : textMime),
  'code',
  (c) => /^(Dockerfile|Makefile|CMakeLists\.txt)$/i.test(c.name) || /^#!/.test(c.text),
);
define('yaml', ['.yaml', '.yml'], 'text/yaml', 'code');
define('toml', ['.toml'], 'application/toml', 'code');
define('xml', ['.xml'], 'application/xml', 'code');
define('shader', ['.glsl', '.vert', '.frag', '.wgsl'], textMime, 'code');
define('md', ['.md', '.mdx', '.markdown'], textMime, 'markdown');
define(
  'diff',
  ['.diff', '.patch'],
  textMime,
  'diff',
  (c) => /^diff --git /m.test(c.text) || /^--- .*\n\+\+\+ /m.test(c.text),
);
define('patch', ['.patch'], textMime, 'diff', (c) => c.ext === '.patch' && 3);
// Content sniffing: only when the name says nothing useful (no extension, or a catch-all one such as .bin).
const vague = (c) => ['', '.bin', '.dat', '.data', '.tmp', '.txt', '.log', '.file'].includes(c.ext);
const parsed = (c) => {
  if (!/^\s*[\[{]/.test(c.text) || c.bytes > LIMIT_SNIFF) return null;
  try {
    return JSON.parse(c.text);
  } catch {
    return null;
  }
};
const LIMIT_SNIFF = 1024 * 1024;
define('json', ['.json', '.jsonc'], 'application/json', 'json', (c) => vague(c) && parsed(c) !== null && 1.5);
define('jsonl', ['.jsonl', '.ndjson'], 'application/x-ndjson', 'table', (c) => {
  if (!vague(c) || c.bytes > LIMIT_SNIFF) return false;
  const lines = c.text.split(/\r?\n/).filter(Boolean).slice(0, 20);
  return (
    lines.length >= 2 &&
    lines.every((l) => {
      try {
        return typeof JSON.parse(l) === 'object';
      } catch {
        return false;
      }
    }) &&
    1.6
  );
});
// A delimited table has at least three lines with the same number of separators outside quotes.
const delimitedBy = (c, ch) => {
  if (!vague(c) || c.head.includes(0)) return false;
  const lines = c.text.split(/\r?\n/).filter(Boolean).slice(0, 12);
  if (lines.length < 3) return false;
  const n = (l) => l.replace(/"[^"]*"/g, '').split(ch).length - 1;
  return n(lines[0]) >= 1 && lines.slice(0, -1).every((l) => n(l) === n(lines[0])) && 1.2;
};
define('csv', ['.csv'], 'text/csv', 'table', (c) => delimitedBy(c, ','));
define('tsv', ['.tsv'], 'text/tab-separated-values', 'table', (c) => delimitedBy(c, '\t') && 1.3);
define('css', ['.css'], 'text/css', 'css');
define('html', ['.html', '.htm'], 'text/html', 'component', (c) => vague(c) && /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(c.text));
// Animated pages are still components; the kind names what moves them. Higher score beats plain html.
const page = (c) => c.ext === '.html' || c.ext === '.htm';
define(
  'css-animation',
  [],
  'text/html',
  'component',
  (c) => page(c) && /@(?:-webkit-)?keyframes\b/.test(c.text) && 3,
);
define(
  'waapi',
  [],
  'text/html',
  'component',
  (c) => page(c) && /\.animate\s*\(/.test(c.text) && 3,
);
define('tsx', ['.tsx'], 'text/plain', 'component');
define('jsx', ['.jsx'], 'text/plain', 'component');
define('svg', ['.svg'], 'image/svg+xml', 'image', (c) =>
  /^\s*(?:<\?xml[^>]+>\s*)?<svg[\s>]/i.test(c.text),
);
define('png', ['.png'], 'image/png', 'image', (c) =>
  c.head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
);
define(
  'jpg',
  ['.jpg', '.jpeg'],
  'image/jpeg',
  'image',
  (c) => c.head[0] === 255 && c.head[1] === 216 && c.head[2] === 255,
);
define('gif', ['.gif'], 'image/gif', 'image', (c) =>
  /^GIF8[79]a/.test(c.head.toString('ascii', 0, 6)),
);
define(
  'webp',
  ['.webp'],
  'image/webp',
  'image',
  (c) => c.head.toString('ascii', 0, 4) === 'RIFF' && c.head.toString('ascii', 8, 12) === 'WEBP',
);
define(
  'avif',
  ['.avif'],
  'image/avif',
  'image',
  (c) => c.head.toString('ascii', 4, 12) === 'ftypavif',
);
define('bmp', ['.bmp'], 'image/bmp', 'image', (c) => c.head.toString('ascii', 0, 2) === 'BM');
define('ico', ['.ico'], 'image/x-icon', 'image');
define(
  'mp4',
  ['.mp4', '.m4v'],
  'video/mp4',
  'video',
  (c) =>
    c.head.toString('ascii', 4, 8) === 'ftyp' &&
    !/^(avif|avis|M4A |qt  )$/.test(c.head.toString('ascii', 8, 12)),
);
define('webm', ['.webm'], 'video/webm', 'video');
define(
  'mov',
  ['.mov'],
  'video/quicktime',
  'video',
  (c) => c.head.toString('ascii', 8, 12) === 'qt  ',
);
define(
  'wav',
  ['.wav'],
  'audio/wav',
  'audio',
  (c) => c.head.toString('ascii', 0, 4) === 'RIFF' && c.head.toString('ascii', 8, 12) === 'WAVE',
);
define(
  'mp3',
  ['.mp3'],
  'audio/mpeg',
  'audio',
  (c) =>
    c.head.toString('ascii', 0, 3) === 'ID3' ||
    // A bare frame sync is also the UTF-16 byte order mark, so it only counts for an .mp3 name.
    (c.ext === '.mp3' && c.head[0] === 255 && (c.head[1] & 224) === 224),
);
define('flac', ['.flac'], 'audio/flac', 'audio', (c) => c.head.toString('ascii', 0, 4) === 'fLaC');
define(
  'ogg',
  ['.ogg', '.oga', '.opus'],
  'audio/ogg',
  'audio',
  (c) => c.head.toString('ascii', 0, 4) === 'OggS',
);
define('m4a', ['.m4a'], 'audio/mp4', 'audio', (c) => c.head.toString('ascii', 8, 12) === 'M4A ');
define(
  'pdf',
  ['.pdf'],
  'application/pdf',
  'pdf',
  (c) => c.head.toString('ascii', 0, 5) === '%PDF-',
);
define('obj', ['.obj'], textMime, 'model');
define('gltf', ['.gltf'], 'model/gltf+json', 'model');
define(
  'glb',
  ['.glb'],
  'model/gltf-binary',
  'model',
  (c) => c.head.toString('ascii', 0, 4) === 'glTF',
);
define(
  'ttf',
  ['.ttf'],
  'font/ttf',
  'font',
  (c) => c.head.length > 4 && c.head.readUInt32BE(0) === 65536,
);
define('otf', ['.otf'], 'font/otf', 'font', (c) => c.head.toString('ascii', 0, 4) === 'OTTO');
define('woff', ['.woff'], 'font/woff', 'font', (c) => c.head.toString('ascii', 0, 4) === 'wOFF');
define('woff2', ['.woff2'], 'font/woff2', 'font', (c) => c.head.toString('ascii', 0, 4) === 'wOF2');
define(
  'zip',
  ['.zip'],
  'application/zip',
  'zip',
  (c) => c.head[0] === 80 && c.head[1] === 75 && [3, 5, 7].includes(c.head[2]),
);
define(
  'sqlite',
  ['.sqlite', '.sqlite3', '.db'],
  'application/vnd.sqlite3',
  'sqlite',
  (c) => c.head.toString('ascii', 0, 15) === 'SQLite format 3',
);
define(
  'parquet',
  ['.parquet'],
  'application/vnd.apache.parquet',
  'parquet',
  (c) => c.head.toString('ascii', 0, 4) === 'PAR1',
);
// Arrow IPC: the file format starts with ARROW1; the stream format starts with a message whose header is a Schema.
const arrowStream = (h) => {
  try {
    const at = h.readInt32LE(0) === -1 ? 8 : 4,
      len = h.readInt32LE(at - 4);
    if (len <= 0 || len > h.length - at) return false;
    const m = h.subarray(at, at + len),
      p = m.readUInt32LE(0),
      vt = p - m.readInt32LE(p),
      slot = m.readUInt16LE(vt + 6);
    return m.readUInt16LE(vt) > 6 && slot > 0 && m[p + slot] === 1;
  } catch {
    return false;
  }
};
define(
  'arrow',
  ['.arrow', '.arrows', '.feather', '.ipc'],
  (c) => (c.head.toString('ascii', 0, 6) === 'ARROW1' ? 'application/vnd.apache.arrow.file' : 'application/vnd.apache.arrow.stream'),
  'arrow',
  (c) => c.head.toString('ascii', 0, 6) === 'ARROW1' || ((c.ext === '' || vague(c) || ['.arrow', '.arrows', '.ipc'].includes(c.ext)) && arrowStream(c.head)),
);
define('ipynb', ['.ipynb'], 'application/x-ipynb+json', 'notebook');
define(
  'css-keyframes',
  [],
  'text/css',
  'css',
  (c) => c.ext === '.css' && /@(?:-webkit-)?keyframes\b/.test(c.text),
);
define(
  'apng',
  ['.apng'],
  'image/apng',
  'image',
  (c) =>
    c.head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    c.head.includes(Buffer.from('acTL')),
);
const json = (c) => {
  if (!/^[\s]*[\[{]/.test(c.text)) return null;
  try {
    return JSON.parse(c.text);
  } catch {
    return null;
  }
};
define('lottie', ['.lottie.json'], 'application/json', 'animation', (c) => {
  const j = json(c);
  return !!(j && j.layers && j.fr !== undefined && j.ip !== undefined && j.op !== undefined);
});
define('vega-lite', [], 'application/json', 'chart', (c) =>
  /"\$schema"\s*:\s*"[^"\n]*vega(?:-lite)?/.test(c.text),
);
define('chart', [], 'application/json', 'chart', (c) => {
  const j = json(c);
  return (
    !j?.$schema &&
    !!(
      (j?.series && Array.isArray(j.series)) ||
      (j?.data && j?.encoding) ||
      (Array.isArray(j?.data) &&
        typeof j.x === 'string' &&
        typeof j.y === 'string' &&
        /^(bar|line|area|point|scatter|pie)$/.test(j.type))
    )
  );
});
define('waapi-json', ['.waapi'], 'application/json', 'animation', (c) => {
  const j = json(c);
  return !!(j?.keyframes && (j.options || j.timing));
});
define('comfyui', [], 'application/json', 'graph', (c) => {
  const j = json(c);
  return !!(
    j &&
    ((Array.isArray(j.nodes) && Array.isArray(j.links)) ||
      Object.values(j).some((n) => n?.class_type && n?.inputs))
  );
});
define('agent-run', [], 'application/x-ndjson', 'timeline', (c) => {
  if (!['.jsonl', '.ndjson', '.log', '.json'].includes(c.ext)) return false;
  return (
    /"(?:role|tool_call|tool_use|run_id|step_id)"\s*:/.test(c.text) ||
    /"(?:type|event)"\s*:\s*"(?:step|message|tool|run|assistant|user|result)/.test(c.text)
  );
});
// Text files arrive as UTF-8, UTF-16 with a byte order mark, or an older single-byte encoding.
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  // UTF-16 text with no byte order mark: every other byte is zero.
  if (buf.length >= 4) {
    let even = 0, odd = 0;
    const n = Math.min(buf.length, 400);
    for (let i = 0; i + 1 < n; i += 2) { if (buf[i] === 0) even++; if (buf[i + 1] === 0) odd++; }
    if (odd > n / 4 && even === 0) return buf.toString('utf16le');
    if (even > n / 4 && odd === 0) return Buffer.from(buf).swap16().toString('utf16le');
  }
  const text = buf.toString('utf8');
  // A cut-off multi-byte character at the end of a window is not a sign of another encoding.
  if (text.slice(0, -1).includes('\ufffd') && !buf.includes(0)) return new TextDecoder('windows-1252').decode(buf);
  return text;
}
export function context(path, head, bytes) {
  return {
    id: path,
    path,
    name: path.split('/').at(-1),
    ext: extname(path).toLowerCase(),
    head,
    bytes,
    text: decodeText(head),
  };
}
