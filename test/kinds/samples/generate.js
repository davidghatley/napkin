// Rebuild the sample folder with Node and local ffmpeg. All visual and audio content is generated here.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { arrowBytes } from './arrow-writer.js';
import { sceneGltf } from './scene.js';
const here = dirname(fileURLToPath(import.meta.url));
const vi = (n) => {
  let x = BigInt(n);
  const a = [];
  do {
    let b = Number(x & 127n);
    x >>= 7n;
    if (x) b |= 128;
    a.push(b);
  } while (x);
  return Buffer.from(a);
};
const signed = (n) => vi(BigInt(n) >= 0 ? BigInt(n) * 2n : -BigInt(n) * 2n - 1n);
// Compact Thrift encoder; entries are [field id, compact type, value].
const val = (t, v) =>
  t === 5 || t === 6
    ? signed(v)
    : t === 8
      ? Buffer.concat([vi(Buffer.byteLength(v)), Buffer.from(v)])
      : t === 12
        ? struct(v)
        : t === 9
          ? Buffer.concat([
              Buffer.from([(Math.min(15, v.values.length) << 4) | v.type]),
              ...(v.values.length >= 15 ? [vi(v.values.length)] : []),
              ...v.values.map((x) => val(v.type, x)),
            ])
          : Buffer.from([v]);
const struct = (fields) => {
  let prev = 0;
  const out = [];
  for (const [id, t, v] of fields) {
    const delta = id - prev;
    out.push(Buffer.from([delta > 0 && delta < 16 ? (delta << 4) | t : t]));
    if (delta <= 0 || delta >= 16) out.push(signed(id));
    out.push(val(t, v));
    prev = id;
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
};
export function parquetBytes(rows = 32, groupSize = 100000) {
  const parts = [Buffer.from('PAR1')],
    groups = [];
  let offset = 4;
  for (let base = 0; base < rows; base += groupSize) {
    const count = Math.min(groupSize, rows - base),
      data = Buffer.alloc(count * 4);
    for (let i = 0; i < count; i++) data.writeInt32LE(base + i, i * 4);
    const header = struct([
        [1, 5, 0],
        [2, 5, data.length],
        [3, 5, data.length],
        [
          5,
          12,
          [
            [1, 5, count],
            [2, 5, 0],
            [3, 5, 3],
            [4, 5, 3],
          ],
        ],
      ]),
      length = header.length + data.length;
    parts.push(header, data);
    groups.push([
      [
        1,
        9,
        {
          type: 12,
          values: [
            [
              [2, 6, offset],
              [
                3,
                12,
                [
                  [1, 5, 1],
                  [2, 9, { type: 5, values: [0, 3] }],
                  [3, 9, { type: 8, values: ['index'] }],
                  [4, 5, 0],
                  [5, 6, count],
                  [6, 6, length],
                  [7, 6, length],
                  [9, 6, offset],
                ],
              ],
            ],
          ],
        },
      ],
      [2, 6, length],
      [3, 6, count],
    ]);
    offset += length;
  }
  const footer = struct([
      [1, 5, 1],
      [
        2,
        9,
        {
          type: 12,
          values: [
            [
              [4, 8, 'schema'],
              [5, 5, 1],
            ],
            [
              [1, 5, 1],
              [3, 5, 0],
              [4, 8, 'index'],
            ],
          ],
        },
      ],
      [3, 6, rows],
      [4, 9, { type: 12, values: groups }],
      [6, 8, 'napkin sample writer'],
    ]),
    tail = Buffer.alloc(8);
  tail.writeUInt32LE(footer.length);
  tail.write('PAR1', 4);
  return Buffer.concat([...parts, footer, tail]);
}
function zip(files) {
  const chunks = [],
    central = [];
  let offset = 0;
  const crc = (b) => {
    let c = ~0;
    for (const byte of b) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ ~0) >>> 0;
  };
  for (const [name, text] of Object.entries(files)) {
    const b = Buffer.from(text),
      n = Buffer.from(name),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc(b), 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    chunks.push(h, n, b);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc(b), 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length + b.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
function pdf() {
  const stream =
    '0.08 0.45 0.36 rg 36 80 240 160 re f BT /F1 28 Tf 1 1 1 rg 55 160 Td (A small field guide) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let s = '%PDF-1.4\n',
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(s.length);
    s += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const at = s.length;
  s += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return s;
}
export function generateSamples(dir = here, { media = true } = {}) {
  mkdirSync(dir, { recursive: true });
  const expected = {};
  const put = (name, kind, bytes) => {
    writeFileSync(join(dir, name), bytes);
    expected[name] = kind;
  };
  put(
    'welcome.html',
    'html',
    '<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9eee3;color:#235c4a;padding:24px;font:24px system-ui}</style></head><body><h1>A field guide</h1><p>Real files on one surface.</p></body></html>',
  );
  put(
    'Badge.tsx',
    'tsx',
    'export default function Badge(){return <div style={{background:"#c9ded1",padding:24,color:"#224b39"}}>Field notes</div>}',
  );
  put('Label.jsx', 'jsx', 'export default function Label(){return <h2>Specimen</h2>}');
  put(
    'tokens.css',
    'css',
    ':root { --leaf: #35836a; --space: 16px; }\nbutton { color: var(--leaf); padding: var(--space); }',
  );
  put(
    'motion.css',
    'css-keyframes',
    '@keyframes drift { 0%,100% { transform: translateX(-50px) rotate(-10deg); } 50% { transform: translateX(50px) rotate(10deg); } }',
  );
  put(
    'leaf.svg',
    'svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#edf0df"/><path d="M80 180Q50 30 250 45Q270 200 80 180" fill="#4b9271"/><path d="M80 180L215 75" stroke="#d0e7bd" stroke-width="5"/></svg>',
  );
  put(
    'readme.md',
    'md',
    '---\ntitle: Field notes\nstatus: draft\n---\n# A living folder\n\nEvery file has a place.\n\n## Small observations\n- Leaves grow toward light\n- Water collects in low places\n\n> Keep the source close.\n\n```js\nconst color = "#35836a";\n```',
  );
  put(
    'notes.txt',
    'txt',
    'Walk the river path.\nRecord the birds at dawn.\nKeep a small field guide.\n',
  );
  put(
    'sample.rs',
    'code',
    'pub fn fibonacci(n: u32) -> u32 {\n  if n < 2 { return n; }\n  fibonacci(n - 1) + fibonacci(n - 2)\n}\n',
  );
  put(
    'change.patch',
    'patch',
    'diff --git a/notes b/notes\n--- a/notes\n+++ b/notes\n@@ -1,2 +1,2 @@\n-Keep it still.\n+Let it grow.\n Look closely.\n',
  );
  put('config.yaml', 'yaml', 'garden:\n  name: River garden\n  shade: partial\n  plants: 14\n');
  put('config.toml', 'toml', '[garden]\nname = "River garden"\nplants = 14\n');
  put(
    'catalog.xml',
    'xml',
    '<?xml version="1.0"?><garden><plant name="Fern" height="42"/><plant name="Moss" height="3"/></garden>',
  );
  put(
    'field.frag',
    'shader',
    'precision mediump float;\nuniform float time;\nvoid main(){ gl_FragColor = vec4(0.2, 0.7, 0.5, 1.0); }',
  );
  put(
    'settings.json',
    'json',
    '{\n  "title": "River garden",\n  "count": 14,\n  "visible": true,\n  "nested": { "color": "#35836a" }\n}\n',
  );
  const rows = Array.from({ length: 60 }, (_, i) => ({
    species: ['Fern', 'Moss', 'Sedge'][i % 3],
    height: 8 + i * 1.7,
    water: i % 4,
    healthy: i % 5 !== 0,
  }));
  put(
    'observations.csv',
    'csv',
    'species,height,water,healthy\n' +
      rows.map((r) => Object.values(r).join(',')).join('\n') +
      '\n',
  );
  put(
    'observations.tsv',
    'tsv',
    'species\theight\twater\thealthy\n' + rows.map((r) => Object.values(r).join('\t')).join('\n'),
  );
  put('observations.jsonl', 'jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  put(
    'growth.vl.json',
    'vega-lite',
    JSON.stringify({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: 'Height by observation',
      data: { values: rows.slice(0, 12).map((r, i) => ({ day: i + 1, height: r.height })) },
      mark: 'line',
      encoding: {
        x: { field: 'day', type: 'quantitative' },
        y: { field: 'height', type: 'quantitative' },
      },
    }),
  );
  put(
    'counts.chart.json',
    'chart',
    JSON.stringify({
      title: 'Garden census',
      series: [
        { x: 'Fern', y: 12 },
        { x: 'Moss', y: 24 },
        { x: 'Sedge', y: 18 },
      ],
    }),
  );
  put(
    'run.jsonl',
    'agent-run',
    [
      { role: 'user', timestamp: '09:10:00', content: 'Draw the river garden.' },
      { role: 'assistant', timestamp: '09:10:04', content: 'Collecting observations.' },
      { type: 'tool', timestamp: '09:10:05', message: 'Wrote observations.csv · 60 rows' },
      { type: 'result', timestamp: '09:10:07', message: 'Garden census is ready.' },
    ]
      .map((v) => JSON.stringify(v))
      .join('\n'),
  );
  put(
    'garden.workflow.json',
    'comfyui',
    JSON.stringify({
      nodes: [
        {
          id: 1,
          type: 'CLIPTextEncode',
          pos: [30, 30],
          widgets_values: ['A river garden, morning light'],
        },
        {
          id: 2,
          type: 'KSampler',
          pos: [300, 40],
          widgets_values: [1234, 20, 7, 'euler', 'normal'],
        },
        { id: 3, type: 'VAEDecode', pos: [570, 70], widgets_values: [] },
      ],
      links: [
        [1, 1, 0, 2, 0, 'CONDITIONING'],
        [2, 2, 0, 3, 0, 'LATENT'],
      ],
    }),
  );
  put(
    'pulse.waapi',
    'waapi-json',
    JSON.stringify({
      text: 'Breathe',
      keyframes: [
        { transform: 'scale(0.8)', opacity: 0.5 },
        { transform: 'scale(1.2)', opacity: 1 },
        { transform: 'scale(0.8)', opacity: 0.5 },
      ],
      options: { duration: 1600, easing: 'ease-in-out' },
    }),
  );
  put(
    'leaf.lottie.json',
    'lottie',
    JSON.stringify({
      v: '5.7.0',
      fr: 30,
      ip: 0,
      op: 90,
      w: 320,
      h: 240,
      layers: [
        {
          ty: 4,
          ip: 0,
          op: 90,
          ks: {
            p: { a: 0, k: [160, 120] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: {
              a: 1,
              k: [
                { t: 0, s: [-30], e: [30], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
                { t: 45, s: [30], e: [-30], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
                { t: 90, s: [-30] },
              ],
            },
            o: { k: 100 },
          },
          shapes: [
            { ty: 'gr', it: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [140, 90] } }, { ty: 'fl', c: { a: 0, k: [0.18, 0.5, 0.36, 1] }, o: { a: 0, k: 100 } }, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] },
          ],
        },
      ],
    }),
  );
  // A precomposition: the ellipse lives in an asset, and the root layer only points at it (refId).
  put(
    'nested.lottie.json',
    'lottie',
    JSON.stringify({
      v: '5.7.0',
      fr: 30,
      ip: 0,
      op: 60,
      w: 200,
      h: 200,
      assets: [
        {
          id: 'comp_0',
          layers: [
            {
              ty: 4, ip: 0, op: 60, st: 0,
              ks: { p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
              shapes: [
                { ty: 'gr', it: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [120, 80] } }, { ty: 'fl', c: { a: 0, k: [0.1, 0.5, 0.4, 1] }, o: { a: 0, k: 100 } }, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] },
              ],
            },
          ],
        },
      ],
      layers: [
        {
          ty: 0, refId: 'comp_0', ip: 0, op: 60, st: 0, w: 200, h: 200,
          ks: { p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
        },
      ],
    }),
  );
  put(
    'study.ipynb',
    'ipynb',
    JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { display_name: 'JavaScript', name: 'javascript' } },
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: ['# River garden\n', 'A small reproducible study.'],
        },
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          source: [
            'const heights = [12, 18, 24];\n',
            'heights.reduce((a,b) => a+b) / heights.length',
          ],
          outputs: [
            {
              output_type: 'execute_result',
              data: { 'text/plain': ['18'] },
              metadata: {},
              execution_count: 1,
            },
          ],
        },
      ],
    }),
  );
  put(
    'garden.zip',
    'zip',
    zip({
      'notes/readme.md': '# River garden\n\nA walk by the water.',
      'data/counts.csv': 'plant,count\nfern,12\nmoss,24\n',
      'palette.json': '{"leaf":"#35836a"}',
    }),
  );
  put(
    'bytes.bin',
    'binary',
    Buffer.concat([
      Buffer.from([0, 255, 17, 128, 3, 7]),
      Buffer.from('A useful string inside an unknown file\0napkin specimen\0'),
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    ]),
  );
  put('guide.pdf', 'pdf', pdf());
  put('sample.parquet', 'parquet', parquetBytes());
  put('powers.arrow', 'arrow', arrowBytes());
  const db = new DatabaseSync(join(dir, 'garden.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS plants (species TEXT, height REAL, healthy INTEGER); DELETE FROM plants;',
  );
  const insert = db.prepare('INSERT INTO plants VALUES (?,?,?)');
  for (const r of rows) insert.run(r.species, r.height, Number(r.healthy));
  db.close();
  expected['garden.sqlite'] = 'sqlite';
  put(
    'pyramid.obj',
    'obj',
    'v -1 0 -1\nv 1 0 -1\nv 1 0 1\nv -1 0 1\nv 0 2 0\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5\nf 1 4 3 2\n',
  );
  const positions = [-1, -1, 0, 1, -1, 0, 0, 1, 0],
    bin = Buffer.alloc(positions.length * 4);
  positions.forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const gltf = {
    asset: { version: '2.0' },
    buffers: [
      {
        byteLength: bin.length,
        uri: 'data:application/octet-stream;base64,' + bin.toString('base64'),
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-1, -1, 0],
        max: [1, 1, 0],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  put('triangle.gltf', 'gltf', JSON.stringify(gltf));
  put('scene.gltf', 'gltf', JSON.stringify(sceneGltf()));
  delete gltf.buffers[0].uri;
  let gj = Buffer.from(JSON.stringify(gltf));
  gj = Buffer.concat([gj, Buffer.alloc((4 - (gj.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + gj.length + bin.length, 8);
  header.writeUInt32LE(gj.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  put('triangle.glb', 'glb', Buffer.concat([header, gj, bh, bin]));
  copyFileSync(
    resolve(here, '../../../public/fonts/inter-latin-wght-normal.woff2'),
    join(dir, 'inter.woff2'),
  );
  copyFileSync(
    resolve(here, '../../../public/fonts/LICENSE-inter-OFL.txt'),
    join(dir, 'LICENSE-inter-OFL.txt'),
  );
  expected['inter.woff2'] = 'woff2';
  expected['LICENSE-inter-OFL.txt'] = 'txt';
  if (media) {
    const ff = (args) =>
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '1', ...args], { stdio: 'pipe' });
    for (const [extension, kind, codec] of [
      ['png', 'png', []],
      ['jpg', 'jpg', []],
      ['webp', 'webp', []],
      ['avif', 'avif', ['-c:v', 'libaom-av1', '-cpu-used', '8']],
      ['bmp', 'bmp', []],
      ['ico', 'ico', []],
    ]) {
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=128x96:rate=1',
        '-frames:v',
        '1',
        ...codec,
        join(dir, 'color.' + extension),
      ]);
      expected['color.' + extension] = kind;
    }
    for (const [ext, codec] of [
      ['mp4', 'libx264'],
      ['mov', 'libx264'],
      ['webm', 'libvpx-vp9'],
    ]) {
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x120:rate=12',
        '-t',
        '1',
        '-c:v',
        codec,
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        ...(ext === 'webm' ? [] : ['-movflags', '+faststart']),
        join(dir, 'turn.' + ext),
      ]);
      expected['turn.' + ext] = ext;
    }
    for (const ext of ['gif', 'apng']) {
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=128x96:rate=6',
        '-t',
        '1',
        ...(ext === 'apng' ? ['-plays', '0', '-f', 'apng'] : []),
        join(dir, 'motion.' + ext),
      ]);
      expected['motion.' + ext] = ext;
    }
    for (const ext of ['wav', 'mp3', 'flac', 'ogg', 'm4a']) {
      ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', join(dir, 'tone.' + ext)]);
      expected['tone.' + ext] = ext;
    }
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(expected, null, 2) + '\n');
  return expected;
}
if (!process.env.NODE_TEST_CONTEXT && process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = generateSamples(process.argv[2] || here);
  console.log('Generated ' + Object.keys(result).length + ' sample files');
}
