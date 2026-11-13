import "./lead-env.mjs"; // must run first: scrubs the lead inputs from process.env
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { once } from "node:events";
import { launchChromium } from "../../test/helpers/cdp.js";
import { decodePng, diffPng } from "../p0-lib.js";
// Chromium's profile lock is a unix socket whose path must stay under ~107 characters. A long
// TMPDIR (some sandboxes) breaks every browser launch, so fall back to /tmp instead of needing a wrapper.
if (tmpdir().length > 48) process.env.TMPDIR = "/tmp";
import { stress } from "../../tools/make-corpus3.mjs";
import { writeParquet } from "./parquet.mjs";
import { randomize, makeContext } from "./media.mjs";
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const p95 = (a) =>
  a.length
    ? [...a].sort((a, b) => a - b)[Math.ceil(a.length * 0.95) - 1]
    : Infinity;
// Frame-interval budget. DREAM 3 says p95 frame < 16.7 ms. requestAnimationFrame timestamps are
// vsync-quantised to ~0.1 ms, so a perfect 60 Hz page measures 16.6 to 16.9 ms; a page that misses
// a vsync measures >= 33 ms. Any budget between the two separates them, so 0.5 ms of timer
// quantisation is allowed and nothing more.
export const FRAME_BUDGET = 17.2;
export const nonce = () => randomBytes(6).toString("hex");
export const assert = (ok, message) => {
  if (!ok) throw Error(message);
};
export const canonical = (x) =>
  JSON.stringify(x, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export function walk(dir, prefix = "") {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((e) =>
      e.name === ".git"
        ? []
        : e.isDirectory()
          ? walk(dir, join(prefix, e.name))
          : [join(prefix, e.name)],
    )
    .sort();
}
export function snapshot(dir) {
  // A file the product removes between listing and reading (an undo deleting a recipe) is
  // simply absent from the snapshot.
  return Object.fromEntries(
    walk(dir).flatMap((p) => {
      let bytes;
      try {
        bytes = readFileSync(join(dir, p));
      } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
      }
      return [[p, createHash("sha256").update(bytes).digest("hex")]];
    }),
  );
}
export function git(dir, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Measures",
      "-c",
      "user.email=measures@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: dir, encoding: "utf8" },
  );
}
export async function freePort() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p === 4820 ? freePort() : p;
}
export function processRSS(pid) {
  try {
    const own =
      Number(
        readFileSync(`/proc/${pid}/status`, "utf8").match(
          /^VmRSS:\s+(\d+)/m,
        )?.[1] || 0,
      ) * 1024;
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return own + children.reduce((n, c) => n + processRSS(c), 0);
  } catch {
    return 0;
  }
}
// The page renderer: the largest web-content renderer under a Chromium main process (not the
// GPU, network or utility processes, and not a browser-UI or extension renderer). Own memory
// only: field "RssAnon" is its private memory (JS heap, ArrayBuffers, DOM, decoded data);
// "VmRSS" adds shared mappings, including raster tiles shared with the GPU process.
export function pageRendererRSS(pid, field = "VmRSS") {
  let best = 0;
  const rx = new RegExp("^" + field + ":\\s+(\\d+)", "m");
  const walk = (p) => {
    let children = [];
    try {
      children = readFileSync(`/proc/${p}/task/${p}/children`, "utf8").trim().split(/\s+/).filter(Boolean);
    } catch {}
    for (const c of children) {
      try {
        const cmd = readFileSync(`/proc/${c}/cmdline`, "utf8");
        if (cmd.includes("--type=renderer") && !/--extension-process|--top-chrome-webui/.test(cmd)) {
          const own = Number(readFileSync(`/proc/${c}/status`, "utf8").match(rx)?.[1] || 0) * 1024;
          best = Math.max(best, own);
        }
      } catch {}
      walk(c);
    }
  };
  walk(pid);
  return best;
}
export function chromiumMains() {
  const out = [];
  for (const d of readdirSync("/proc"))
    if (/^\d+$/.test(d))
      try {
        const c = readFileSync(`/proc/${d}/cmdline`, "utf8");
        if (c.includes("--remote-debugging-port=0") && !c.includes("--type="))
          out.push(Number(d));
      } catch {}
  return out;
}
export async function start(folder, state, env = {}) {
  mkdirSync(state, { recursive: true });
  const port = await freePort(),
    base = `http://127.0.0.1:${port}`,
    t = performance.now();
  const proc = spawn(
    process.execPath,
    [
      process.env.NAPKIN_BENCH_CLI || join(ROOT, "src/cli.js"),
      "open",
      folder,
      "--port",
      String(port),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NAPKIN_STATE_DIR: state,
        XDG_STATE_HOME: state,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let log = "";
  let peakRSS = 0;
  const sample = setInterval(() => {
    peakRSS = Math.max(peakRSS, processRSS(proc.pid));
  }, 10);
  proc.once("exit", () => clearInterval(sample));
  proc.stdout.on("data", (b) => (log += b));
  proc.stderr.on("data", (b) => (log += b));
  const stop = async () => {
    clearInterval(sample);
    if (proc.exitCode !== null) return;
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {}
    await Promise.race([once(proc, "exit"), sleep(2000)]);
    if (proc.exitCode === null) {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {}
    }
  };
  try {
    while (performance.now() - t < 15000) {
      if (proc.exitCode !== null)
        throw Error(`CLI exited ${proc.exitCode}: ${log.slice(-1200)}`);
      // Readiness uses the existing API; a missing DREAM route must not prevent measurement.
      try {
        const r = await fetch(base + "/api/files", {
          signal: AbortSignal.timeout(300),
        });
        if (r.status < 500)
          return {
            base,
            proc,
            stop,
            rss: () => processRSS(proc.pid),
            peakRSS: () => Math.max(peakRSS, processRSS(proc.pid)),
            ms: performance.now() - t,
            log: () => log,
          };
      } catch {}
      await sleep(30);
    }
    throw Error("CLI did not become ready: " + log.slice(-1200));
  } catch (e) {
    await stop();
    throw e;
  }
}
export async function request(
  s,
  path,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  let r = await fetch(s.base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(s.token ? { authorization: `Bearer ${s.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (r.status === 401 && !s.token) {
    const auth = await fetch(s.base + "/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ as: "measures-" + nonce() }),
      signal: AbortSignal.timeout(5000),
    });
    const a = await auth.json();
    assert(
      typeof a.token === "string" && a.token,
      "session did not return a token",
    );
    s.token = a.token;
    return request(s, path, body, method);
  }
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {}
  assert(r.ok, `${method} ${path}: HTTP ${r.status}: ${text.slice(0, 180)}`);
  assert(
    data && typeof data === "object",
    `${method} ${path}: expected JSON, received ${r.headers.get("content-type")}`,
  );
  return data;
}
export async function items(s) {
  const a = await request(s, "/api/items");
  assert(Array.isArray(a.items), "/api/items must return {items:[]}");
  return a.items;
}
// Temp dirs of fixtures that failed half-way are still removed by run().
const pendingTemps = [];
export async function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "napkin-d3-")),
    folder = join(temp, "work"),
    state = join(temp, "state");
  mkdirSync(folder);
  mkdirSync(state);
  const manifest = JSON.parse(
      readFileSync(join(ROOT, "bench/corpus3/manifest.json")),
    ),
    seed = randomInt(1000, 900000),
    suffix = nonce(),
    media = makeContext(seed, suffix);
  pendingTemps.push(temp, media.tmp);
  const files = manifest.files.map((f) => structuredClone(f));
  for (const f of files) {
    let bytes = readFileSync(join(ROOT, "bench/corpus3", f.path));
    assert(
      createHash("sha256").update(bytes).digest("hex") === f.sha256,
      "Committed corpus hash mismatch: " + f.path,
    );
    if (
      [
        "html",
        "tsx",
        "jsx",
        "css",
        "css-animation",
        "waapi",
        "md",
        "txt",
        "code",
        "diff",
        "patch",
        "ipynb",
        "csv",
        "tsv",
        "json",
        "jsonl",
        "agent-run",
      ].includes(f.kind)
    ) {
      bytes = Buffer.from(bytes.toString().replaceAll("731", String(seed)));
      f.markers.text = f.markers.text.map((t) =>
        t.replaceAll("731", String(seed)),
      );
    }
    const rowCount = 19 + (seed % 23);
    if (["csv", "tsv", "json", "jsonl"].includes(f.kind)) {
      const rows = Array.from({ length: rowCount }, (_, id) => ({
        id,
        label: `orbit-${seed}-${id}`,
        value: seed + id * 31,
        active: id % 2 === 0,
      }));
      bytes = Buffer.from(
        f.kind === "json"
          ? JSON.stringify(rows)
          : f.kind === "jsonl"
            ? rows.map((x) => JSON.stringify(x)).join("\n") + "\n"
            : [
                "id,label,value,active",
                ...rows.map((r) => Object.values(r).join(",")),
              ]
                .join("\n")
                .replaceAll(",", f.kind === "tsv" ? "\t" : ",") + "\n",
      );
      f.meta.rows = rowCount;
      f.markers.text = [`orbit-${seed}-0`, String(seed)];
    }
    if (f.kind === "arrow") {
      bytes = Buffer.from(bytes);
      const original = Buffer.from(bytes);
      for (let n = 0; n < 17; n++) {
        const value = Buffer.alloc(4);
        value.writeInt32LE(731 + n * 31);
        const offset = original.indexOf(value);
        assert(offset >= 0, "Arrow data field missing");
        bytes.writeInt32LE(seed + n * 31, offset);
      }
      f.markers.text = [String(seed)];
    }
    {
      const r = randomize(f, bytes, media);
      if (r) bytes = r.bytes;
      f.expect = r?.expect || {};
    }
    // No product sees this manifest. Paths and file-derived content vary each run.
    const original = f.path;
    f.path = `${suffix}-${original}`;
    f.original = original;
    writeFileSync(join(folder, f.path), bytes);
    if (f.kind === "parquet") {
      await writeParquet(join(folder, f.path), rowCount, seed);
      f.meta.rows = rowCount;
      f.markers.text = [String(seed % 100003)];
    }
    if (f.kind === "sqlite") {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(join(folder, f.path));
      try {
        db.exec("DELETE FROM measurements");
        const insert = db.prepare("INSERT INTO measurements VALUES(?,?,?,?)");
        for (let n = 0; n < rowCount; n++)
          insert.run(n, `orbit-${seed}-${n}`, seed + n * 31, n % 2);
      } finally {
        db.close();
      }
      f.meta.rows = rowCount;
      f.markers.text = [`orbit-${seed}-0`, String(seed)];
    }
  }
  git(folder, "init", "-q");
  git(folder, "add", ...files.map((f) => f.path));
  git(folder, "commit", "-qm", "Original generated corpus");
  const initial = snapshot(folder);
  return {
    temp,
    folder,
    state,
    files,
    seed,
    initial,
    media,
    clean: () => {
      media.clean();
      rmSync(temp, { recursive: true, force: true });
    },
  };
}
export class Book {
  constructor(dimension) {
    this.dimension = dimension;
    this.rows = [];
  }
  async check(id, target, fn, tiers = this.defaultTiers ?? ["dream", "beat"]) {
    let ok = false,
      value;
    try {
      const r = await fn();
      ok = !!r.ok;
      value = r.value ?? r;
    } catch (e) {
      value = { error: e.message };
    }
    this.rows.push({
      id,
      ok,
      value: JSON.parse(
        JSON.stringify(value, (_, x) =>
          typeof x === "number" && !Number.isFinite(x) ? String(x) : x,
        ),
      ),
      target,
      tiers,
    });
    return ok;
  }
  // Gate that only the lead can satisfy (see reviews.mjs). `judge(entry)` must hold for the
  // signed entry; without lead input the check fails as "pending" and is reported as such.
  async attest(id, target, key, judge, tiers) {
    const { leadAttested } = await import("./reviews.mjs");
    const ok = await this.check(
      id,
      target + " [lead-attested]",
      () => {
        const entry = leadAttested(key);
        return { ok: judge(entry) === true, value: entry };
      },
      tiers,
    );
    this.rows.at(-1).attested = true;
    return ok;
  }
  fail(id, target, message, tiers) {
    return this.check(
      id,
      target,
      () => {
        throw Error(message);
      },
      tiers,
    );
  }
  result() {
    const count = (t) => {
      const rows = this.rows.filter((r) => r.tiers.includes(t));
      return { met: rows.filter((r) => r.ok).length, total: rows.length };
    };
    return {
      dimension: this.dimension,
      dream: count("dream"),
      beat: count("beat"),
      pendingLead: this.rows.filter((r) => r.attested && !r.ok).length,
      checks: this.rows.map(({ tiers, ...r }) => r),
    };
  }
}
export async function run(dimension, fn, { env = {} } = {}) {
  const book = new Book(dimension);
  let f, s, b;
  try {
    f = await fixture();
    s = await start(f.folder, f.state, env);
    await fn({
      book,
      f,
      s,
      browser: async () => {
        if (process.env.NAPKIN_GPU)
          throw Error(
            "DREAM 3 measures require CPU Chromium; unset NAPKIN_GPU",
          );
        if (!b) {
          const before = new Set(chromiumMains());
          b = await launchChromium();
          b.pid = chromiumMains().find((p) => !before.has(p));
          // A headless page is never "focused", so :focus and :focus-visible would never match.
          await b.send("Emulation.setFocusEmulationEnabled", { enabled: true });
        }
        return b;
      },
      restart: async () => {
        await s.stop();
        s = await start(f.folder, f.state, env);
        return s;
      },
    });
  } catch (e) {
    await book.fail(
      "harness.execution",
      "measurement completes",
      e.stack || e.message,
    );
  } finally {
    for (const cleanup of [
      () => b?.close(),
      () => s?.stop(),
      () => f?.clean(),
      () =>
        pendingTemps
          .splice(0)
          .forEach((p) => rmSync(p, { recursive: true, force: true })),
    ])
      try {
        await cleanup();
      } catch (e) {
        await book.fail(
          "harness.cleanup",
          "all owned resources released",
          e.message,
        );
      }
  }
  return book.result();
}
export function output(r) {
  console.log(
    `\n${r.dimension} | beat ${r.beat.met}/${r.beat.total} | dream ${r.dream.met}/${r.dream.total}` +
      (r.pendingLead ? ` | lead-attested pending ${r.pendingLead}` : ""),
  );
  console.log("Check | Result | Value | Target");
  for (const c of r.checks)
    console.log(
      `${c.id} | ${c.ok ? "PASS" : "FAIL"} | ${JSON.stringify(c.value)} | ${c.target}`,
    );
  if (process.argv.includes("--json")) console.log(JSON.stringify(r));
  process.exitCode = r.checks.every((c) => c.ok) ? 0 : 1;
}
export const entry = (url) =>
  url ===
  new URL(process.argv[1] || "file:///none", "file://" + process.cwd() + "/")
    .href;
export async function observe(b, url, markers = null) {
  await b.send("Page.navigate", { url: "about:blank" });
  let script;
  if (markers)
    script = (
      await b.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(()=>{const sel=${JSON.stringify(markers.selectors || [])},txt=${JSON.stringify(markers.text || [])};const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const tick=()=>{if(window.__meaningful!==undefined)return;if(document.body&&sel.every(q=>[...document.querySelectorAll(q)].some(vis))&&txt.every(t=>document.body.innerText.includes(t))&&![...document.images].some(i=>!i.complete))window.__meaningful=performance.now();else requestAnimationFrame(tick)};requestAnimationFrame(tick)})()`,
      })
    ).identifier;
  await b.goto(url);
  if (script)
    await b.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: script,
    });
  await b.eval("document.fonts.ready");
  await b.eval(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
  // First-contentful-paint is delivered asynchronously after the frame that paints: wait for the
  // entry (up to 3 s) instead of guessing with two animation frames.
  await b
    .eval(
      "new Promise(r=>{const t0=performance.now();const q=()=>performance.getEntriesByName('first-contentful-paint').length||performance.now()-t0>3000?r():setTimeout(q,25);q()})",
    )
    .catch(() => {});
  const dom = await b.eval(
    `({text:document.body.innerText,kind:document.querySelector('[data-napkin-kind]')?.dataset.napkinKind,paint:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,meaningful:window.__meaningful})`,
  );
  const png = await b.screenshot(),
    p = decodePng(png);
  let sum = 0,
    sq = 0;
  const bins = new Set();
  for (let i = 0; i < p.data.length; i += 4) {
    const y = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
    sum += y;
    sq += y * y;
    bins.add(
      (p.data[i] >> 4) * 256 + (p.data[i + 1] >> 4) * 16 + (p.data[i + 2] >> 4),
    );
  }
  const n = p.width * p.height;
  if (typeof dom.paint === "number" && typeof dom.meaningful === "number")
    dom.paint = Math.max(dom.paint, dom.meaningful);
  return { ...dom, variance: sq / n - (sum / n) ** 2, colors: bins.size, png };
}
export async function evidence(b, name) {
  const i = process.argv.indexOf("--out");
  if (i < 0) return;
  const out = resolve(process.argv[i + 1]);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name + ".png"), await b.screenshot());
}
export async function key(b, key, modifiers = 0) {
  const codes = {
    Tab: 9,
    Enter: 13,
    Escape: 27,
    Backspace: 8,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Shift: 16,
    Control: 17,
    Alt: 18,
    " ": 32,
  };
  const p = {
    key,
    code: key.length === 1 ? "Key" + key.toUpperCase() : key,
    windowsVirtualKeyCode: codes[key] || key.toUpperCase().charCodeAt(0),
    modifiers,
  };
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...p });
  if (key.length === 1 && !modifiers)
    await b.send("Input.dispatchKeyEvent", { type: "char", text: key, ...p });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...p });
}
export async function typeKeys(b, text) {
  for (const c of text) await key(b, c);
}
export async function palette(b, command) {
  await key(b, "k", 2);
  await typeKeys(b, command);
  await key(b, "Enter");
  await sleep(100);
  return command.length + 2;
}
// Select an item by outcome. The documented route is the palette phrase "Select <path>"; if that
// leaves /api/board without the item selected (and no panel for it on screen), a person's route
// is taken instead: click the item's card. The result says which route worked. Used by the
// benches that are not about the keyboard (keys3 never falls back).
export async function selectItem(b, s, item) {
  const selected = async () => {
    try {
      const board = await request(s, "/api/board");
      if ((board.selection || []).includes(item.id)) return true;
    } catch {}
    return b.eval(
      `!![...document.querySelectorAll('[data-controls-for]')].find(e=>e.dataset.controlsFor===${JSON.stringify(item.id)}&&e.getBoundingClientRect().width>0)`,
    );
  };
  // Selection speed is judged by panel.swap; here the bench only needs the selection, so it
  // waits up to 2 s (a first selection after load can take several hundred ms).
  await palette(b, "Select " + item.path);
  for (let n = 0; n < 20; n++) {
    if (await selected()) return "palette";
    await sleep(100);
  }
  await key(b, "Escape");
  const clicked = await b.eval(
    `(()=>{const e=document.querySelector('[data-item-id="'+CSS.escape(${JSON.stringify(item.id)})+'"]');if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  if (clicked) {
    for (const type of ["mousePressed", "mouseReleased"])
      await b.send("Input.dispatchMouseEvent", { type, x: clicked.x, y: clicked.y, button: "left", clickCount: 1 });
    for (let n = 0; n < 6; n++) {
      if (await selected()) return "pointer";
      await sleep(100);
    }
  }
  throw Error("neither the palette phrase nor clicking the card selects " + item.path);
}
// Focus is visible only if an indicator is actually drawn: a real outline or ring whose colour
// is found in the pixels around the element and contrasts with what is behind it. A caret or
// the element merely being a text input does not count.
export async function focusVisible(b) {
  const info = await b.eval(
    `(()=>{const e=document.activeElement;if(!e||e===document.body||!e.matches(':focus-visible'))return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0)||s.visibility==='hidden'||s.display==='none')return null;const colours=[];if(s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=1.5)colours.push({c:s.outlineColor,reach:parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)||0)+2});for(const m of s.boxShadow.matchAll(/(rgba?\\([^)]*\\))\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+([\\d.]+)px(?:\\s+(-?[\\d.]+)px)?(?!\\s*inset)/g)){const spread=parseFloat(m[5]||0),blur=parseFloat(m[4]);if(spread>=1.5||(blur<=2&&Math.abs(parseFloat(m[2]))+Math.abs(parseFloat(m[3]))>=1.5))colours.push({c:m[1],reach:Math.abs(spread)+blur+Math.abs(parseFloat(m[2]))+Math.abs(parseFloat(m[3]))+2})}return{rect:{x:r.x,y:r.y,w:r.width,h:r.height},colours}})()`,
  );
  if (!info) return false;
  const p = decodePng(await b.screenshot());
  // Outcome test first: any visible change of the element (and its 4 px surround) between its
  // focused and unfocused state counts, so a high-contrast background fill, an inverted colour
  // scheme or a thick underline are as valid as an outline or ring. A blinking caret is too
  // small to pass (needs >= 4% of the box or 60 changed pixels).
  const x0 = Math.max(0, Math.floor(info.rect.x) - 4),
    y0 = Math.max(0, Math.floor(info.rect.y) - 4),
    x1 = Math.min(p.width, Math.ceil(info.rect.x + info.rect.w) + 4),
    y1 = Math.min(p.height, Math.ceil(info.rect.y + info.rect.h) + 4);
  await b.eval("void(window.__fv=document.activeElement,document.activeElement.blur())");
  await sleep(250);
  const q = decodePng(await b.screenshot());
  await b.eval("void(window.__fv.focus({focusVisible:true}))");
  await sleep(150);
  let changed = 0;
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * p.width + xx) * 4;
      if (
        Math.max(
          Math.abs(p.data[i] - q.data[i]),
          Math.abs(p.data[i + 1] - q.data[i + 1]),
          Math.abs(p.data[i + 2] - q.data[i + 2]),
        ) > 40
      )
        changed++;
    }
  if (changed >= Math.max(60, (x1 - x0) * (y1 - y0) * 0.04)) return true;
  for (const { c, reach } of info.colours) {
    const m = c.match(/[\d.]+/g)?.map(Number);
    if (!m || (m[3] !== undefined && m[3] < 0.5)) continue;
    const { x, y, w, h } = info.rect,
      r = Math.ceil(reach);
    let hit = 0;
    for (
      let yy = Math.max(0, Math.floor(y) - r);
      yy < Math.min(p.height, y + h + r);
      yy++
    )
      for (
        let xx = Math.max(0, Math.floor(x) - r);
        xx < Math.min(p.width, x + w + r);
        xx++
      ) {
        const inside =
          xx >= x + 1 && xx < x + w - 1 && yy >= y + 1 && yy < y + h - 1;
        if (inside) continue;
        const i = (yy * p.width + xx) * 4;
        if (
          Math.abs(p.data[i] - m[0]) <= 24 &&
          Math.abs(p.data[i + 1] - m[1]) <= 24 &&
          Math.abs(p.data[i + 2] - m[2]) <= 24
        )
          hit++;
      }
    if (hit >= (w + h) * 0.8) return true;
  }
  return false;
}
export async function axe(b) {
  await b.send("Runtime.evaluate", {
    expression: readFileSync(
      join(ROOT, "node_modules/axe-core/axe.min.js"),
      "utf8",
    ),
  });
  return b.eval(
    'axe.run(document,{resultTypes:["violations"]}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})))',
  );
}
export async function frameGesture(b, mode = "pan") {
  const geometry = () =>
    b.eval(
      `JSON.stringify([...document.querySelectorAll('[data-item-id]')].map(e=>{const r=e.getBoundingClientRect();return[e.dataset.itemId,r.x,r.y,r.width,r.height]}))`,
    );
  const before = await geometry();
  let moved = false;
  await b.eval(
    `window.__d3frames=[];window.__d3stop=false;window.__d3frameAt=performance.now();requestAnimationFrame(function frame(t){window.__d3frames.push(t-window.__d3frameAt);window.__d3frameAt=t;if(!window.__d3stop)requestAnimationFrame(frame)})`,
  );
  for (let i = 0; i < 100; i++) {
    await b.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 520,
      y: 350,
      deltaX: mode === "pan" ? (i % 40 < 20 ? 24 : -24) : 0,
      deltaY: mode === "pan" ? 8 : i % 20 < 10 ? -12 : 12,
      modifiers: mode === "pan" ? 0 : 2,
    });
    await sleep(16);
    if (i === 24) moved = before !== (await geometry());
  }
  assert(moved, "wheel gesture did not move or scale actual canvas items");
  return b.eval("window.__d3stop=true;window.__d3frames.slice(2)");
}
export function changed(before, after) {
  return canonical(before) !== canonical(after);
}
export function valueFor(c) {
  if (c.options?.length > 1)
    return c.options
      .map((o) => o.value ?? o)
      .find((o) => canonical(o) !== canonical(c.value));
  if (typeof c.value === "boolean") return !c.value;
  if (typeof c.value === "number") {
    const step = c.step || 1;
    return c.value + step <= (c.max ?? Infinity)
      ? c.value + step
      : c.value - step;
  }
  if (typeof c.value === "string") {
    if (/color/i.test(c.type) || /^#[0-9a-f]{3,8}$/i.test(c.value))
      return "#" + randomBytes(3).toString("hex");
    const numeric = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|deg|ms|s|vh|vw)?$/.exec(
      c.value,
    );
    if (numeric)
      return (
        String(valueFor({ ...c, value: Number(numeric[1]) })) +
        (numeric[2] || "")
      );
    const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(c.value);
    if (bezier) {
      const values = bezier[1].split(",").map(Number);
      values[1] += 0.125;
      return `cubic-bezier(${values.join(",")})`;
    }
    return "Orbit " + nonce();
  }
  if (Array.isArray(c.value) && c.value.length) {
    const value = structuredClone(c.value);
    value[0] = valueFor({ ...c, value: value[0] });
    return value;
  }
  if (c.value && typeof c.value === "object") {
    const key = Object.keys(c.value).find((k) =>
      ["number", "boolean"].includes(typeof c.value[k]),
    );
    if (key)
      return { ...c.value, [key]: valueFor({ ...c, value: c.value[key] }) };
  }
  throw Error(
    `No safe mutation for control type ${c.type}; add a semantic driver, never skip`,
  );
}
export async function eventStream(s) {
  const controller = new AbortController(),
    events = [],
    ready = performance.now();
  const timer = setTimeout(() => controller.abort(), 5000);
  let response;
  try {
    response = await fetch(s.base + "/api/events", {
      headers: s.token ? { authorization: `Bearer ${s.token}` } : {},
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    await response.body?.cancel();
    const url = new URL(s.base.replace(/^http/, "ws") + "/api/events");
    if (s.token) url.searchParams.set("token", s.token);
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      let value;
      try {
        value = JSON.parse(e.data);
      } catch {
        value = String(e.data);
      }
      events.push({ at: performance.now(), value });
    };
    try {
      await Promise.race([
        new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = () => reject(Error("WS /api/events unavailable"));
        }),
        sleep(3000).then(() => {
          throw Error("WS /api/events handshake timed out");
        }),
      ]);
    } catch (e) {
      ws.close();
      throw Error(`Events: HTTP ${response.status}, ${e.message}`);
    }
    return { events, ready, close: async () => ws.close() };
  }
  assert(response.ok, "/api/events HTTP " + response.status);
  const reader = response.body.getReader();
  let buffer = "";
  const done = (async () => {
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        buffer += Buffer.from(r.value).toString().replaceAll("\r\n", "\n");
        let at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const data = chunk
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (data) {
            let value;
            try {
              value = JSON.parse(data);
            } catch {
              value = data;
            }
            events.push({ at: performance.now(), value });
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) events.push({ error: e.message });
    }
  })();
  return {
    events,
    ready,
    close: async () => {
      controller.abort();
      await done;
    },
  };
}
export async function waitUntil(fn, ms = 5000) {
  const start = performance.now();
  while (performance.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(25);
  }
  throw Error("Outcome not observed within " + ms + " ms");
}
export { stress, diffPng, decodePng };
// Main-thread work per frame and dropped frames during a canvas gesture (see bench/README.md,
// "Frame budget"). For each animation frame: work = time from the frame's start (the rAF
// timestamp) to a message posted from inside rAF, which runs only after that frame's rendering
// task (rAF callbacks, style, layout, paint) has finished. Dropped = intervals over 1.5 vsyncs.
export async function frameWork(b, mode = "pan", { events = 240, x = 520, y = 350 } = {}) {
  const geometry = () =>
    b.eval(
      `JSON.stringify([...document.querySelectorAll('[data-item-id]')].slice(0,200).map(e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width]}))`,
    );
  const before = await geometry();
  await b.eval(
    `window.__fw={work:[],intervals:[],stop:false};(()=>{let last;const tick=t=>{if(last!==undefined)window.__fw.intervals.push(t-last);last=t;const ch=new MessageChannel();ch.port1.onmessage=()=>window.__fw.work.push(performance.now()-t);ch.port2.postMessage(0);if(!window.__fw.stop)requestAnimationFrame(tick)};requestAnimationFrame(tick)})()`,
  );
  let moved = false;
  for (let i = 0; i < events; i++) {
    await b.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: mode === "pan" ? (i % 80 < 40 ? 24 : -24) : 0,
      deltaY: mode === "pan" ? (i % 120 < 60 ? 8 : -8) : i % 40 < 20 ? -12 : 12,
      modifiers: mode === "pan" ? 0 : 2,
    });
    await sleep(16);
    if (i === 24) moved = before !== (await geometry());
  }
  assert(moved, "wheel gesture did not move or scale actual canvas items");
  const r = await b.eval("window.__fw.stop=true;({work:window.__fw.work.slice(2),intervals:window.__fw.intervals.slice(2)})");
  const sorted = [...r.intervals].sort((a, b) => a - b),
    vsync = sorted[Math.floor(sorted.length / 2)] || 16.7;
  return { ...r, vsync, dropped: r.intervals.filter((v) => v > Math.max(vsync, 16.6) * 1.5).length };
}
