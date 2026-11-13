#!/usr/bin/env node
// Original CC0 fixtures. Optional tools are used only when rebuilding binary fixtures.
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeParquet } from "../bench/lib3/parquet.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) =>
  process.argv.includes(name)
    ? process.argv[process.argv.indexOf(name) + 1]
    : fallback;
const ff = (...a) =>
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", ...a],
    { stdio: "pipe" },
  );
export async function stress(
  dir,
  { mixed = true, large = true, seed = 7 } = {},
) {
  mkdirSync(dir, { recursive: true });
  if (mixed) {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "bench/corpus3/manifest.json")),
    );
    for (let n = 0; n < 1000; n++) {
      const f = manifest.files[n % manifest.files.length];
      // Keep supporting URIs beside glTF/HTML; a prefix directory makes every mixed item unique.
      const d = join(dir, `batch-${String(n).padStart(4, "0")}`);
      mkdirSync(d);
      for (const p of f.dependencies || [])
        copyFileSync(join(ROOT, "bench/corpus3", p), join(d, p));
      copyFileSync(join(ROOT, "bench/corpus3", f.path), join(d, f.path));
    }
  }
  if (large) {
    await writeParquet(join(dir, "large.parquet"), 5_000_000, seed);
    // Encode a real noisy H.264 keyframe, then repeat its packets with valid timestamps.
    // Over 2 GB of compressed frame payload; no sparse allocation or padding atoms.
    const base = join(dir, "stress-source.mp4");
    try {
      ff(
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=1920x1080:rate=30,noise=alls=100:allf=u:all_seed=${seed}`,
        "-frames:v",
        "1",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-qp",
        "0",
        "-threads",
        "1",
        base,
      );
      const repeats = Math.ceil(2_100_000_000 / statSync(base).size) + 1;
      ff(
        "-stream_loop",
        String(repeats - 1),
        "-i",
        base,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        join(dir, "large.mov"),
      );
    } finally {
      rmSync(base, { force: true });
    }
  }
}
export async function generate(dir, tooling) {
  mkdirSync(dir, { recursive: true });
  const require = createRequire(join(resolve(tooling), "package.json"));
  const arrow = require("apache-arrow"),
    ot = require("opentype.js");
  const files = [],
    put = (
      path,
      bytes,
      kind,
      selectors,
      text = [],
      meta = {},
      dependencies = [],
    ) => {
      writeFileSync(join(dir, path), bytes);
      files.push({
        path,
        kind,
        markers: { selectors, text },
        meta,
        dependencies,
      });
    };
  const adopt = (path, kind, selectors, text = [], meta = {}) =>
    put(path, readFileSync(join(dir, path)), kind, selectors, text, meta);
  const html =
    '<!doctype html><html lang="en"><title>Orbit specimen</title><style>body{background:#f6ead4;color:#154f65;font:24px sans-serif}button{background:#f0bd45;padding:24px;border:0;border-radius:16px}</style><h1>Orbit 731</h1><button>Launch 731</button></html>';
  put("orbit.html", html, "html", ["h1", "button"], ["Orbit 731"]);
  for (const ext of ["tsx", "jsx"])
    put(
      `Orbit.${ext}`,
      (ext === "tsx" ? 'type Props = { tone?: "gold" | "blue" };\n' : "") +
        `export default function Orbit({tone="gold"}${ext === "tsx" ? ": Props" : ""}){return <button style={{background:tone==="gold"?"#f0bd45":"#154f65",padding:24}}>Launch 731</button>}\n`,
      ext,
      ["button"],
      ["Launch 731"],
    );
  put(
    "palette.css",
    ":root{--orbit:#154f65} .orbit{color:var(--orbit);padding:13px}\n",
    "css",
    ['pre,code,[role="table"]'],
    ["#154f65"],
  );
  put(
    "orbit.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#154f65"/><rect x="45" y="15" width="70" height="70" fill="#f0bd45"><animateTransform attributeName="transform" type="rotate" from="0 80 50" to="360 80 50" dur="2s" repeatCount="indefinite"/></rect></svg>',
    "svg",
    ["svg,img,canvas"],
    [],
    { width: 160, height: 100 },
  );
  for (const ext of ["png", "jpg", "webp", "avif", "gif", "apng"]) {
    ff(
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x100:rate=5",
      "-frames:v",
      ["gif", "apng"].includes(ext) ? "5" : "1",
      ...(ext === "apng" ? ["-plays", "0", "-f", "apng"] : []),
      join(dir, `spectrum.${ext}`),
    );
    adopt(`spectrum.${ext}`, ext, ["img,canvas"], [], {
      width: 160,
      height: 100,
      frames: ["gif", "apng"].includes(ext) ? 5 : 1,
    });
  }
  for (const ext of ["mp4", "webm", "mov"]) {
    ff(
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x100:rate=10",
      "-t",
      "1.2",
      "-an",
      "-c:v",
      ext === "webm" ? "libvpx-vp9" : "libx264",
      "-threads",
      "1",
      ...(ext === "webm" ? [] : ["-pix_fmt", "yuv420p"]),
      join(dir, `orbit.${ext}`),
    );
    adopt(`orbit.${ext}`, ext, ["video"], [], {
      duration: 1.2,
      width: 160,
      height: 100,
    });
  }
  for (const ext of ["wav", "mp3", "flac", "ogg"]) {
    ff(
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=731:sample_rate=44100:duration=1.2",
      "-ac",
      "1",
      join(dir, `tone.${ext}`),
    );
    adopt(
      `tone.${ext}`,
      ext,
      ["audio", 'canvas,svg,[aria-label*="waveform" i]'],
      [],
      { duration: 1.2, frequency: 731 },
    );
  }
  const lottie = {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 60,
    w: 160,
    h: 100,
    nm: "Orbit 731",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Circle",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: {
            a: 1,
            k: [
              {
                t: 0,
                s: [32, 50, 0],
                e: [128, 50, 0],
                o: { x: 0.3, y: 0 },
                i: { x: 0.7, y: 1 },
              },
              { t: 60, s: [128, 50, 0] },
            ],
          },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [
          {
            ty: "el",
            p: { a: 0, k: [0, 0] },
            s: { a: 0, k: [32, 32] },
            nm: "Ellipse",
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.94, 0.74, 0.27, 1] },
            o: { a: 0, k: 100 },
          },
        ],
        ip: 0,
        op: 60,
        st: 0,
        bm: 0,
      },
    ],
  };
  put(
    "orbit.lottie.json",
    JSON.stringify(lottie),
    "lottie",
    ["svg,canvas"],
    [],
    { duration: 2 },
  );
  put(
    "orbit.animation.html",
    html.replace(
      "</style>",
      "@keyframes orbit{from{transform:translateX(0)}to{transform:translateX(100px)}}button{animation:orbit 2s linear infinite}</style>",
    ),
    "css-animation",
    ["button"],
    ["Launch 731"],
    { duration: 2 },
  );
  put(
    "orbit.waapi.html",
    html +
      '<script>document.querySelector("button").animate([{transform:"translateX(0)"},{transform:"translateX(100px)"}],{duration:2000,iterations:Infinity})</script>',
    "waapi",
    ["button"],
    ["Launch 731"],
    { duration: 2 },
  );
  const data = Array.from({ length: 17 }, (_, id) => ({
    id,
    label: `orbit-${id}`,
    value: id * 31 + 731,
    active: id % 2 === 0,
  }));
  for (const [ext, sep] of [
    ["csv", ","],
    ["tsv", "\t"],
  ])
    put(
      `table.${ext}`,
      [
        "id,label,value,active".replaceAll(",", sep),
        ...data.map((r) => Object.values(r).join(sep)),
      ].join("\n") + "\n",
      ext,
      ['table,[role="grid"],[role="table"]'],
      ["orbit-0"],
      { rows: 17, columns: 4 },
    );
  put(
    "table.json",
    JSON.stringify(data),
    "json",
    ['table,[role="grid"],[role="table"]'],
    ["orbit-0"],
    { rows: 17, columns: 4 },
  );
  put(
    "table.jsonl",
    data.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "jsonl",
    ['table,[role="grid"],[role="table"]'],
    ["orbit-0"],
    { rows: 17, columns: 4 },
  );
  await writeParquet(join(dir, "table.parquet"), 17, 731);
  adopt(
    "table.parquet",
    "parquet",
    ['table,[role="grid"],[role="table"]'],
    ["731"],
    { rows: 17, columns: 2 },
  );
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "table.sqlite"));
  db.exec(
    "DROP TABLE IF EXISTS measurements; CREATE TABLE measurements(id INTEGER PRIMARY KEY, label TEXT, value REAL, active INTEGER)",
  );
  const stmt = db.prepare("INSERT INTO measurements VALUES(?,?,?,?)");
  for (const r of data) stmt.run(r.id, r.label, r.value, Number(r.active));
  db.close();
  adopt(
    "table.sqlite",
    "sqlite",
    ['table,[role="grid"],[role="table"]'],
    ["orbit-0"],
    { rows: 17, columns: 4 },
  );
  put(
    "table.arrow",
    arrow.tableToIPC(
      arrow.tableFromArrays({
        id: Int32Array.from(data.map((r) => r.id)),
        value: Int32Array.from(data.map((r) => r.value)),
      }),
      "file",
    ),
    "arrow",
    ['table,[role="grid"],[role="table"]'],
    ["731"],
    { rows: 17, columns: 2 },
  );
  put(
    "chart.vl.json",
    JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      data: { values: data },
      mark: "bar",
      encoding: {
        x: { field: "label", type: "nominal" },
        y: { field: "value", type: "quantitative" },
      },
    }),
    "vega-lite",
    ["svg,canvas"],
    [],
    { marks: 17 },
  );
  put(
    "chart.data.json",
    JSON.stringify({ type: "bar", x: "label", y: "value", data }),
    "chart",
    ["svg,canvas"],
    [],
    { marks: 17 },
  );
  for (const [path, kind, source, selector, text] of [
    [
      "notes.md",
      "md",
      "# Orbit 731\n\nA **bright** circle.\n",
      ["h1", "strong"],
      ["Orbit 731"],
    ],
    [
      "notes.txt",
      "txt",
      "Orbit 731\nA bright circle.\n",
      ["pre,article"],
      ["Orbit 731"],
    ],
    [
      "orbit.rs",
      "code",
      'fn main() { println!("Orbit 731"); }\n',
      ["pre code,pre"],
      ["Orbit 731"],
    ],
    [
      "orbit.diff",
      "diff",
      "diff --git a/orbit.txt b/orbit.txt\n--- a/orbit.txt\n+++ b/orbit.txt\n@@ -1 +1 @@\n-dull\n+Orbit 731\n",
      ['pre,code,[role="table"]'],
      ["+Orbit 731"],
    ],
    [
      "orbit.patch",
      "patch",
      "--- a/orbit.txt\n+++ b/orbit.txt\n@@ -1 +1 @@\n-dull\n+Orbit 731\n",
      ['pre,code,[role="table"]'],
      ["+Orbit 731"],
    ],
  ])
    put(path, source, kind, selector, text);
  put(
    "orbit.ipynb",
    JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: {
          display_name: "JavaScript",
          language: "javascript",
          name: "javascript",
        },
      },
      cells: [
        {
          cell_type: "markdown",
          id: "intro",
          metadata: {},
          source: ["# Orbit 731"],
        },
        {
          cell_type: "code",
          id: "calc",
          metadata: {},
          source: ["31 + 731"],
          execution_count: 1,
          outputs: [
            {
              output_type: "execute_result",
              data: { "text/plain": ["762"] },
              metadata: {},
              execution_count: 1,
            },
          ],
        },
      ],
    }),
    "ipynb",
    ["pre,code", "h1"],
    ["762"],
  );
  const parts = ["%PDF-1.4\n"],
    offsets = [0];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const content =
    "0.08 0.31 0.4 rg 0 0 320 200 re f 0.94 0.74 0.27 rg 40 40 240 80 re f BT /F1 24 Tf 0 0 0 rg 48 80 Td (Orbit 731) Tj ET";
  objects.push(
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  );
  objects.forEach((o, n) => {
    offsets.push(Buffer.byteLength(parts.join("")));
    parts.push(`${n + 1} 0 obj\n${o}\nendobj\n`);
  });
  const xref = Buffer.byteLength(parts.join(""));
  parts.push(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join(
        "",
      )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  put("orbit.pdf", parts.join(""), "pdf", ["canvas,embed,object,iframe"], [], {
    pages: 1,
  });
  const vertices = Buffer.alloc(36);
  [-0.7, -0.5, 0, 0.7, -0.5, 0, 0, 0.7, 0].forEach((v, n) =>
    vertices.writeFloatLE(v, n * 4),
  );
  const gltf = {
    asset: { version: "2.0", generator: "napkin CC0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.94, 0.74, 0.27, 1],
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
        doubleSided: true,
      },
    ],
    buffers: [
      {
        byteLength: 36,
        uri:
          "data:application/octet-stream;base64," + vertices.toString("base64"),
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        max: [0.7, 0.7, 0],
        min: [-0.7, -0.5, 0],
      },
    ],
  };
  put(
    "triangle.gltf",
    JSON.stringify(gltf),
    "gltf",
    ["canvas,model-viewer"],
    [],
    { vertices: 3 },
  );
  const g = structuredClone(gltf);
  delete g.buffers[0].uri;
  let json = Buffer.from(JSON.stringify(g));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(28 + json.length + 36, 8);
  h.writeUInt32LE(json.length, 12);
  h.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(36);
  bh.writeUInt32LE(0x004e4942, 4);
  put(
    "triangle.glb",
    Buffer.concat([h, json, bh, vertices]),
    "glb",
    ["canvas,model-viewer"],
    [],
    { vertices: 3 },
  );
  put(
    "triangle.obj",
    "o Orbit\nv -0.7 -0.5 0\nv 0.7 -0.5 0\nv 0 0.7 0\nf 1 2 3\n",
    "obj",
    ["canvas,model-viewer"],
    [],
    { vertices: 3 },
  );
  const glyphs = Array.from({ length: 96 }, (_, n) => {
    const p = new ot.Path();
    if (n > 1) {
      p.moveTo(50, 0);
      p.lineTo(300 + (n % 4) * 40, 0);
      p.lineTo(250, 400 + (n % 7) * 30);
      p.close();
    }
    return new ot.Glyph({
      name: n ? `uni${(n + 31).toString(16).padStart(4, "0")}` : ".notdef",
      unicode: n ? n + 31 : undefined,
      advanceWidth: 600,
      path: p,
    });
  });
  const font = new ot.Font({
    familyName: "Orbit Measures",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  });
  const otf = Buffer.from(font.toArrayBuffer());
  put(
    "orbit.otf",
    otf,
    "otf",
    [],
    [],
    { glyphs: 96 },
  );
  // opentype writes CFF OTF; ffmpeg cannot convert fonts. Build a genuine TrueType sfnt below.
  const { makeTTF } = await import("../bench/lib3/ttf.mjs");
  put(
    "orbit.ttf",
    makeTTF(),
    "ttf",
    [],
    [],
    { glyphs: 96 },
  );
  execFileSync("woff2_compress", [join(dir, "orbit.ttf")], { stdio: "pipe" });
  adopt(
    "orbit.woff2",
    "woff2",
    [],
    [],
    { glyphs: 96 },
  );
  const workflow = {
    1: {
      class_type: "EmptyLatentImage",
      inputs: { width: 160, height: 128, batch_size: 1 },
    },
    2: {
      class_type: "SaveImage",
      inputs: { images: ["3", 0], filename_prefix: "orbit" },
    },
    3: { class_type: "PreviewImage", inputs: { images: ["4", 0] } },
    4: { class_type: "LoadImage", inputs: { image: "spectrum.png" } },
  };
  // API and UI workflows use a real connected, model-free LoadImage → SaveImage graph.
  delete workflow["1"];
  delete workflow["3"];
  workflow["2"].inputs.images = ["4", 0];
  put(
    "workflow.api.json",
    JSON.stringify(workflow),
    "comfyui",
    ['svg,canvas,[role="tree"]'],
    ["LoadImage", "SaveImage"],
    { nodes: 2 },
  );
  put(
    "workflow.ui.json",
    JSON.stringify({
      last_node_id: 4,
      last_link_id: 1,
      nodes: [
        {
          id: 4,
          type: "LoadImage",
          pos: [0, 0],
          size: [300, 200],
          flags: {},
          order: 0,
          mode: 0,
          inputs: [],
          outputs: [
            { name: "IMAGE", type: "IMAGE", links: [1], slot_index: 0 },
          ],
          properties: { "Node name for S&R": "LoadImage" },
          widgets_values: ["spectrum.png", "image"],
        },
        {
          id: 2,
          type: "SaveImage",
          pos: [350, 0],
          size: [300, 200],
          flags: {},
          order: 1,
          mode: 0,
          inputs: [{ name: "images", type: "IMAGE", link: 1 }],
          outputs: [],
          properties: { "Node name for S&R": "SaveImage" },
          widgets_values: ["orbit"],
        },
      ],
      links: [[1, 4, 0, 2, 0, "IMAGE"]],
      groups: [],
      config: {},
      extra: {},
      version: 0.4,
    }),
    "comfyui",
    ['svg,canvas,[role="tree"]'],
    ["LoadImage", "SaveImage"],
    { nodes: 2 },
  );
  put(
    "orbit.run.jsonl",
    [
      { type: "run", id: "orbit-731", plan: ["draw", "review"] },
      { type: "step", run: "orbit-731", step: "draw", status: "complete" },
      { type: "artifact", run: "orbit-731", path: "spectrum.png" },
      { type: "question", run: "orbit-731", text: "Keep the gold?" },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
    "agent-run",
    ['[role="log"],ol,[role="tree"]'],
    ["Keep the gold?"],
  );
  execFileSync("zip", [
    "-q",
    "-j",
    join(dir, "orbit.zip"),
    join(dir, "notes.txt"),
    join(dir, "spectrum.png"),
  ]);
  adopt(
    "orbit.zip",
    "zip",
    [],
    ["notes.txt", "spectrum.png"],
    { entries: 2 },
  );
  put(
    "unknown.bin",
    Buffer.concat([
      Buffer.from([0, 255, 128, 31, 73, 0, 12, 200]),
      Buffer.from("ORBIT_731_USEFUL_STRING"),
      Buffer.from(Array.from({ length: 256 }, (_, n) => n)),
    ]),
    "binary",
    [],
    ["ORBIT_731_USEFUL_STRING"],
    { bytes: 287 },
  );
  for (const f of files) {
    f.bytes = statSync(join(dir, f.path)).size;
    f.sha256 = createHash("sha256")
      .update(readFileSync(join(dir, f.path)))
      .digest("hex");
  }
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      { license: "CC0-1.0", generator: "tools/make-corpus3.mjs", kindAliases: { patch: ["diff"], "agent-run": ["agent-log"] }, files },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(dir, "LICENSE.txt"),
    "All corpus content was synthesized or authored for napkin measures.\nTo the extent possible under law, its authors waive copyright and related rights under CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/\nNo system fonts, third-party images, models or datasets are included.\n",
  );
  console.log(
    `Generated ${files.length} files, ${files.reduce((s, f) => s + f.bytes, 0)} bytes`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const out = resolve(arg("--out", join(ROOT, "bench/corpus3")));
  if (process.argv.includes("--stress"))
    await stress(out, { seed: Number(arg("--seed", "7")) });
  else await generate(out, arg("--tooling", join(ROOT, "bench/tools")));
}
