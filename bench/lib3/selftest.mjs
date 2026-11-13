import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash, generateKeyPairSync } from "node:crypto";
import { setLeadForSelfTest } from "./lead-env.mjs";
import { mockComfy } from "./comfy.mjs";
import {
  Book,
  fixture,
  waitUntil,
  ROOT,
  stress,
  snapshot,
  canonical,
  key,
  typeKeys,
} from "./runtime.mjs";
import { writeParquet } from "./parquet.mjs";
import { launchChromium } from "../../test/helpers/cdp.js";
import { selectionTime, scrubPixel } from "./pixels.mjs";
const require = createRequire(
  (process.env.NAPKIN_D3_TOOLS || join(ROOT, "bench/tools")) +
    "/package.json",
);
test("manifest hashes, all kinds, genuine binaries and small footprint", async () => {
  const { files } = JSON.parse(
    readFileSync(join(ROOT, "bench/corpus3/manifest.json")),
  );
  assert.equal(files.length, 48);
  assert.ok(new Set(files.map((f) => f.kind)).size >= 40);
  assert.ok(files.reduce((n, f) => n + f.bytes, 0) < 15_000_000);
  for (const f of files) {
    const b = readFileSync(join(ROOT, "bench/corpus3", f.path));
    assert.equal(b.length, f.bytes);
    assert.equal(createHash("sha256").update(b).digest("hex"), f.sha256);
  }
  const parquet = require("parquetjs-lite"),
    arrow = require("apache-arrow"),
    ot = require("opentype.js");
  const reader = await parquet.ParquetReader.openFile(
    join(ROOT, "bench/corpus3/table.parquet"),
  );
  try {
    let n = 0;
    const c = reader.getCursor();
    while (await c.next()) n++;
    assert.equal(n, 17);
  } finally {
    await reader.close();
  }
  assert.equal(
    arrow.tableFromIPC(readFileSync(join(ROOT, "bench/corpus3/table.arrow")))
      .numRows,
    17,
  );
  for (const ext of ["ttf", "otf"]) {
    const bytes = readFileSync(join(ROOT, "bench/corpus3/orbit." + ext));
    const font = ot.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    assert.equal(font.numGlyphs, 96);
    assert.ok(font.charToGlyph("A").path.commands.length >= 3);
  }
  for (const ext of ["mp4", "webm", "mov", "wav", "mp3", "flac", "ogg"]) {
    const path = join(
      ROOT,
      "bench/corpus3",
      (["mp4", "webm", "mov"].includes(ext) ? "orbit." : "tone.") + ext,
    );
    const info = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        path,
      ]),
    );
    assert.ok(Number(info.format.duration) > 1);
    assert.ok(info.streams.length);
  }
  assert.match(
    execFileSync("pdfinfo", [join(ROOT, "bench/corpus3/orbit.pdf")], {
      encoding: "utf8",
    }),
    /Pages:\s+1/,
  );
  assert.match(
    execFileSync("unzip", ["-t", join(ROOT, "bench/corpus3/orbit.zip")], {
      encoding: "utf8",
    }),
    /No errors/,
  );
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(ROOT, "bench/corpus3/table.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      db.prepare("select count(*) as n from measurements").get().n,
      17,
    );
  } finally {
    db.close();
  }
});
test("custom parquet writer crosses row groups and survives an independent reader", async () => {
  const dir = mkdtempSync(join(tmpdir(), "napkin-d3-parquet-"));
  try {
    const p = join(dir, "rows.parquet");
    await writeParquet(p, 65539, 919);
    const reader = await require("parquetjs-lite").ParquetReader.openFile(p);
    try {
      const c = reader.getCursor();
      let n = 0,
        last;
      while ((last = await c.next())) {
        assert.equal(last.id, n);
        assert.equal(last.value, (n * 31 + 919) % 100003);
        n++;
      }
      assert.equal(n, 65539);
    } finally {
      await reader.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("fresh names and bytes, no manifest leaked to product folder, initial git clean", async () => {
  const a = await fixture(),
    b = await fixture();
  try {
    assert.notEqual(a.seed, b.seed);
    assert.notEqual(a.files[0].path, b.files[0].path);
    assert.notEqual(
      canonical(snapshot(a.folder)),
      canonical(snapshot(b.folder)),
    );
    assert.equal(Object.keys(snapshot(a.folder)).length, 48);
    assert.equal(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: a.folder,
        encoding: "utf8",
      }),
      "",
    );
    assert.deepEqual(snapshot(a.folder), a.initial);
    const arrowFile = a.files.find((f) => f.kind === "arrow");
    const table = require("apache-arrow").tableFromIPC(
      readFileSync(join(a.folder, arrowFile.path)),
    );
    assert.equal(table.getChild("value").get(0), a.seed);
    assert.equal(table.getChild("value").get(16), a.seed + 16 * 31);
    const csv = a.files.find((f) => f.kind === "csv");
    assert.equal(
      readFileSync(join(a.folder, csv.path), "utf8").trim().split("\n").length -
        1,
      csv.meta.rows,
    );
  } finally {
    a.clean();
    b.clean();
  }
});
test("failure accounting cannot skip unavailable checks or turn NaN into a pass", async () => {
  const b = new Book("D1");
  await b.check("missing", "200", () => {
    throw Error("HTTP 404");
  });
  await b.check("nan", "<150", () => ({ ok: false, value: Infinity }));
  const r = b.result();
  assert.deepEqual(r.dream, { met: 0, total: 2 });
  assert.match(r.checks[0].value.error, /404/);
  assert.equal(r.checks[1].value, "Infinity");
});
test("ComfyUI protocol: validate, queue, WS progress, history, bytes, serial execution, deletion", async () => {
  const m = await mockComfy();
  let ws;
  try {
    const events = [];
    ws = new WebSocket(m.url.replace("http", "ws") + "/ws?clientId=selftest");
    ws.onmessage = (e) => {
      if (typeof e.data === "string") events.push(JSON.parse(e.data));
    };
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
    const post = async (path, body) =>
      fetch(m.url + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await post("/prompt", {
          prompt: { 1: { class_type: "Imaginary", inputs: {} } },
        })
      ).status,
      400,
    );
    const graph = {
      1: { class_type: "LoadImage", inputs: { image: "spectrum.png" } },
      2: {
        class_type: "SaveImage",
        inputs: { images: ["1", 0], filename_prefix: "selftest" },
      },
    };
    const a = await (
        await post("/prompt", { client_id: "selftest", prompt: graph })
      ).json(),
      b = await (
        await post("/prompt", { client_id: "selftest", prompt: graph })
      ).json();
    assert.equal(a.number + 1, b.number);
    assert.equal(
      (await (await fetch(m.url + "/queue")).json()).queue_pending.length,
      2,
    );
    await waitUntil(() => m.history[a.prompt_id] && m.history[b.prompt_id]);
    assert.ok(
      events.some((x) => x.type === "progress" && x.data.max === m.steps),
    );
    assert.ok(
      events.some((x) => x.type === "executing" && x.data.node === null),
    );
    const starts = events.filter((x) => x.type === "execution_start"),
      ends = events.filter((x) => x.type === "execution_success");
    assert.equal(starts.length, 2);
    assert.ok(events.indexOf(ends[0]) < events.indexOf(starts[1]));
    const h = await (await fetch(m.url + "/history/" + a.prompt_id)).json();
    assert.deepEqual(h[a.prompt_id].prompt[2], graph);
    const descriptor = h[a.prompt_id].outputs["2"].images[0],
      bytes = Buffer.from(
        await (
          await fetch(m.url + "/view?" + new URLSearchParams(descriptor))
        ).arrayBuffer(),
      );
    assert.ok(
      bytes.equals(readFileSync(join(ROOT, "bench/corpus3/spectrum.png"))),
    );
    assert.equal((await fetch(m.url + "/view?filename=bogus")).status, 404);
    await post("/history", { delete: [a.prompt_id] });
    assert.deepEqual(
      await (await fetch(m.url + "/history/" + a.prompt_id)).json(),
      {},
    );
    assert.ok(
      (await (await fetch(m.url + "/object_info")).json()).KSampler.input
        .required.seed,
    );
    for (const [load, save, input, output, slot, field, source] of [
      [
        "LoadAudio",
        "SaveAudio",
        { audio: "tone.wav" },
        "audio",
        0,
        "audio",
        "tone.flac",
      ],
      [
        "LoadVideo",
        "SaveVideo",
        { file: "orbit.mp4" },
        "video",
        0,
        "images",
        "orbit.mp4",
      ],
    ]) {
      const prompt = {
        1: { class_type: load, inputs: input },
        2: {
          class_type: save,
          inputs: {
            [output]: ["1", slot],
            filename_prefix: "media",
            ...(save === "SaveVideo"
              ? { format: "auto", "format.codec": "auto" }
              : {}),
          },
        },
      };
      const response = await post("/prompt", { client_id: "selftest", prompt });
      assert.equal(response.status, 200, await response.clone().text());
      const { prompt_id } = await response.json();
      await waitUntil(() => m.history[prompt_id]);
      const descriptor = m.history[prompt_id].outputs["2"][field][0];
      const bytes = Buffer.from(
        await (
          await fetch(m.url + "/view?" + new URLSearchParams(descriptor))
        ).arrayBuffer(),
      );
      assert.ok(
        bytes.equals(readFileSync(join(ROOT, "bench/corpus3", source))),
      );
    }
  } finally {
    ws?.close();
    await m.close();
  }
});
test("Chromium can decode all three original font formats; key driver sends keyboard events only", async () => {
  assert.ok(!process.env.NAPKIN_GPU, "CPU only");
  const b = await launchChromium();
  try {
    const html =
      '<title>Keys</title><input aria-label="Words"><script>window.events=[];for(const t of ["keydown","keyup","input","pointerdown","mousedown","click"])addEventListener(t,e=>events.push(e.type))</script>';
    await b.goto("data:text/html," + encodeURIComponent(html));
    await key(b, "Tab");
    await typeKeys(b, "Orbit #731");
    assert.equal(
      await b.eval('document.querySelector("input").value'),
      "Orbit #731",
    );
    const events = await b.eval("events");
    assert.ok(events.includes("keydown"));
    assert.ok(
      !events.some((x) => ["click", "pointerdown", "mousedown"].includes(x)),
    );
    for (const ext of ["ttf", "otf", "woff2"]) {
      const bytes = readFileSync(join(ROOT, "bench/corpus3/orbit." + ext));
      assert.equal(
        await b.eval(
          `new FontFace('Orbit${ext}',Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0))).load().then(f=>f.status)`,
        ),
        "loaded",
      );
    }
  } finally {
    await b.close();
  }
});
test("panel and compositor clocks observe real key-driven changes", async () => {
  const b = await launchChromium();
  try {
    const html = `<title>Clocks</title><input aria-label="Size" type="range" min="0" max="10" value="2"><div data-item-id="item"><iframe style="width:320px;height:240px" srcdoc="<body style='background:rgb(20,40,60)'>"></iframe></div><aside hidden data-controls-for="item"><input data-control-id="size"></aside><script>document.addEventListener('keydown',e=>{if(e.key==='Enter')document.querySelector('aside').hidden=false});document.querySelector('input').addEventListener('input',e=>document.querySelector('iframe').contentDocument.body.style.background='rgb('+Number(e.target.value)*22+',80,130)')</script>`;
    await b.goto("data:text/html," + encodeURIComponent(html));
    await key(b, "Tab");
    const ms = await selectionTime(b, () => key(b, "Enter"), "item");
    assert.ok(Number.isFinite(ms) && ms >= 0 && ms < 1000);
    const pixels = await scrubPixel(b, "ArrowRight");
    assert.ok(Number.isFinite(pixels) && pixels >= 0 && pixels < 1000);
  } finally {
    await b.close();
  }
});
test(
  "real large workloads are generated outside git",
  { skip: !process.env.D3_STRESS_SELFTEST },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "napkin-d3-stress-"));
    try {
      await stress(dir, { mixed: true, large: true, seed: 119 });
      assert.ok(statSync(join(dir, "large.mov")).size > 2_000_000_000);
      const info = JSON.parse(
        execFileSync("ffprobe", [
          "-v",
          "error",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          join(dir, "large.mov"),
        ]),
      );
      assert.ok(Number(info.streams[0].nb_frames) > 1);
      assert.equal(info.streams[0].codec_name, "h264");
      const p = await require("parquetjs-lite").ParquetReader.openFile(
        join(dir, "large.parquet"),
      );
      try {
        assert.equal(p.metadata.num_rows.toString(), "5000000");
      } finally {
        await p.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("cheats are rejected and honest work passes: focus ring, causal scrub, lead attestation", async () => {
  const { createServer } = await import("node:http");
  const { focusVisible } = await import("./runtime.mjs");
  const { scrubWalk } = await import("./pixels.mjs");
  const { leadAttested, buildHash, signAttestation } =
    await import("./reviews.mjs");
  const { writeFileSync } = await import("node:fs");
  const pages = {
    none: `<input id=i style="outline:none;box-shadow:none;caret-color:transparent"><script>i.focus()</script>`,
    fill: `<style>button{outline:none;background:#eee;color:#222;width:140px;height:40px;border:0}button:focus-visible{background:#111;color:#fff}</style><button id=i>Go</button><script>i.focus()</script>`,
    ring: `<input id=i style="outline:3px solid #e00;outline-offset:1px"><script>i.focus()</script>`,
    unrelated: `<input id=r type=range min=0 max=10 value=5 aria-label=time><canvas id=c width=200 height=100 style="display:block"></canvas><script>const x=c.getContext('2d');let t=0;(function f(){x.fillStyle='hsl('+(t++*7%360)+',80%,50%)';x.fillRect(0,0,200,100);requestAnimationFrame(f)})();r.focus()</script>`,
    random: `<input id=r type=range min=0 max=10 value=5 aria-label=time><canvas id=c width=200 height=100 style="display:block"></canvas><script>const x=c.getContext('2d');addEventListener('keydown',()=>{x.fillStyle='hsl('+Math.floor(Math.random()*360)+',80%,50%)';x.fillRect(0,0,200,100)});r.focus()</script>`,
    honest: `<input id=r type=range min=0 max=10 value=5 aria-label=time><canvas id=c width=200 height=100 style="display:block"></canvas><script>const x=c.getContext('2d');const d=()=>{x.fillStyle='hsl('+(r.value*30)+',80%,50%)';x.fillRect(0,0,200,100)};r.addEventListener('input',d);d();r.focus()</script>`,
  };
  const srv = createServer((q, r) => {
    r.writeHead(200, { "content-type": "text/html" });
    r.end("<body>" + (pages[q.url.slice(1)] || ""));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const b = await launchChromium();
  try {
    await b.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await b.goto(base + "none");
    assert.equal(
      await focusVisible(b),
      false,
      "a suppressed focus indicator must not count",
    );
    await b.goto(base + "ring");
    assert.equal(await focusVisible(b), true);
    await b.goto(base + "fill");
    assert.equal(await focusVisible(b), true, "a background-fill focus style is valid");
    for (const name of ["unrelated", "random"]) {
      await b.goto(base + name);
      await assert.rejects(
        scrubWalk(b, { selector: "canvas", steps: 10 }),
        /by itself|differs between visits|not the scrub key|unrelated key/,
      );
    }
    await b.goto(base + "honest");
    assert.equal(
      (await scrubWalk(b, { selector: "canvas", steps: 10 })).length,
      10,
    );
  } finally {
    await b.close();
    srv.close();
  }
  const dir = mkdtempSync(join(tmpdir(), "napkin-d3-attest-")),
    file = join(dir, "a.json"),
    h = buildHash(),
    entry = { attestedBy: "lead", at: "2026-11-12" };
  const lead = generateKeyPairSync("ed25519"),
    other = generateKeyPairSync("ed25519"),
    pem = (k) => k.privateKey.export({ type: "pkcs8", format: "pem" });
  try {
    setLeadForSelfTest(
      file,
      lead.publicKey.export({ type: "spki", format: "pem" }),
    );
    const put = (mac) =>
      writeFileSync(
        file,
        JSON.stringify({ sourceHash: h, k: { ...entry, mac } }),
      );
    put(undefined);
    assert.throws(() => leadAttested("k"), /signature/);
    put(signAttestation(pem(other), h, "k", entry));
    assert.throws(() => leadAttested("k"), /signature/);
    put(signAttestation(pem(lead), h, "k", entry));
    assert.equal(leadAttested("k").attestedBy, "lead");
    // the retired shared-secret scheme and the environment must not leak into children
    assert.equal(process.env.NAPKIN_LEAD_PUBKEY, undefined);
    assert.equal(process.env.NAPKIN_LEAD_KEY, undefined);
    setLeadForSelfTest(undefined, undefined);
    assert.throws(() => leadAttested("k"), /PENDING LEAD ATTESTATION/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("card pixel oracle: a thumbnail matches its view, placeholder text does not", async () => {
  const { dominantColours, shareOf } = await import("./semantic.mjs");
  const pic = (w, h, fill) => {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(fill(i % w, (i / w) | 0), i * 4);
    return { width: w, height: h, data };
  };
  const view = pic(100, 100, (x) => (x < 50 ? [200, 30, 30, 255] : [30, 60, 220, 255]));
  const thumb = pic(60, 40, (x) => (x < 30 ? [205, 28, 33, 255] : [28, 62, 215, 255]));
  const xxx = pic(60, 40, () => [250, 250, 250, 255]);
  const want = dominantColours(view);
  assert.equal(want.length, 2);
  const rect = { x: 0, y: 0, w: 60, h: 40 };
  assert.equal(want.filter((c) => shareOf(thumb, rect, c) >= 0.005).length, 2);
  assert.equal(want.filter((c) => shareOf(xxx, rect, c) >= 0.005).length, 0);
});
