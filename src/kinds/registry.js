import { extname } from 'node:path';
import { sections, applyNative } from './controls.js';
import { renderViewer, previewData } from './view.js';
import { cardMetadata } from './metadata.js';
const entries = [];
export function registerKind(definition) {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || entries.some((d) => d.id === definition.id))
    throw new Error('Kind ids must be unique lowercase names');
  for (const key of ['detect', 'metadata', 'viewer', 'controls', 'apply'])
    if (typeof definition[key] !== 'function')
      throw new Error(`Kind ${definition.id} needs ${key}()`);
  entries.push(Object.freeze(definition));
  return definition;
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
  throw new Error('No binary fallback registered');
}
const textMime = 'text/plain; charset=utf-8';
function define(id, extensions, mime, family, magic) {
  return registerKind({
    id,
    extensions,
    mime,
    family,
    detect: (ctx) =>
      magic?.(ctx) ? (id === 'binary' ? 0.1 : 2) : extensions.includes(ctx.ext) ? 1 : 0,
    metadata: (ctx) => metadata(ctx, family),
    viewer: (ctx) => renderViewer(ctx),
    preview: (ctx, query) => previewData(ctx, query),
    controls: (ctx) => sections(ctx),
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
    if (b.length >= 24) {
      meta.width = b.readUInt32BE(16);
      meta.height = b.readUInt32BE(20);
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
define('txt', ['.txt', '.log'], textMime, 'text', (c) => c.ext === '' && !c.head.includes(0));
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
define('json', ['.json', '.jsonc'], 'application/json', 'json');
define('jsonl', ['.jsonl', '.ndjson'], 'application/x-ndjson', 'table');
define('csv', ['.csv'], 'text/csv', 'table');
define('tsv', ['.tsv'], 'text/tab-separated-values', 'table');
define('css', ['.css'], 'text/css', 'css');
define('html', ['.html', '.htm'], 'text/html', 'component');
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
    c.head.toString('ascii', 0, 3) === 'ID3' || (c.head[0] === 255 && (c.head[1] & 224) === 224),
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
define(
  'arrow',
  ['.arrow', '.feather'],
  'application/vnd.apache.arrow.file',
  'arrow',
  (c) => c.head.toString('ascii', 0, 6) === 'ARROW1',
);
define('ipynb', ['.ipynb'], 'application/x-ipynb+json', 'notebook');
define(
  'css-animation',
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
  return !j?.$schema && !!((j?.series && Array.isArray(j.series)) || (j?.data && j?.encoding));
});
define('waapi', ['.waapi'], 'application/json', 'animation', (c) => {
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
define('agent-log', [], 'application/x-ndjson', 'timeline', (c) => {
  if (!['.jsonl', '.ndjson', '.log', '.json'].includes(c.ext)) return false;
  return (
    /"(?:role|tool_call|tool_use|run_id|step_id)"\s*:/.test(c.text) ||
    /"(?:type|event)"\s*:\s*"(?:step|message|tool|run|assistant|user|result)/.test(c.text)
  );
});
export function context(path, head, bytes) {
  return {
    id: path,
    path,
    name: path.split('/').at(-1),
    ext: extname(path).toLowerCase(),
    head,
    bytes,
    text: head.toString('utf8'),
  };
}
