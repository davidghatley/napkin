#!/usr/bin/env node
// D1 differential fidelity: does napkin show (and serve) what the file actually holds?
//
// Every run a seeded generator (bench/lib3/fidelity-gen.mjs) writes ordinary and awkward files of
// each format family into a fresh folder, and a trusted reference implementation reads the same
// bytes back. The bench opens each file the way a person would (/view/<id>, scrolling, paging,
// clicking, typing into a filter) and compares what is on screen with the reference: exact cell
// text, the last row, the deepest node, mark geometry, colours, waveform envelope, frames, glyph
// coverage, archive entries. A missing reference makes its checks FAIL, never skip. Three canvas
// checks follow: a TSX module with no component export still gets a card, a folder holding only a
// plugin-registered kind shows content and Layers rows on first load, and an item focused through
// Layers + Enter takes pointer input inside its card.
//   node bench/fidelity3.js [--json] [--out DIR] [--only csv,json,...] [--seed N]
import {
  Book,
  start,
  items,
  assert,
  sleep,
  entry,
  output,
  key,
  typeKeys,
  waitUntil,
  ROOT,
} from "./lib3/runtime.mjs";
import { launchChromium } from "../test/helpers/cdp.js";
import { decodePng } from "./p0-lib.js";
import { FAMILIES, prng, cli, lib, TOOLS } from "./lib3/fidelity-gen.mjs";
// kinds.js imports this module's row helpers while it is still evaluating (top-level await), so
// importing it back statically would deadlock; measure() loads it when fidelity3 itself runs.
let kindOk, CARD_CONTENT;
import { fromHex } from "./lib3/media.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomInt } from "node:crypto";

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const ONLY = arg("--only")?.split(",");
const W = 1280,
  H = 900;
// Case ids each family is expected to produce: if generation or the reference fails, every one
// of them is reported as FAIL, so a broken reference can never shrink the total.
export const EXPECTED = {
  csv: ["csv.zeros", "csv.dupes", "csv.quotes", "csv.bom", "csv.utf16", "csv.latin1", "tsv.tabs", "csv.big", "tsv.big16"],
  json: ["json.deep", "json.wide", "json.bignum", "jsonl.rows"],
  arrow: ["arrow.file", "arrow.stream", "arrow.stream-in-.arrow"],
  parquet: ["parquet.groups"],
  sqlite: ["sqlite.tables"],
  markdown: ["md.gfm"],
  vegalite: ["vegalite.layered", "vegalite.stacked", "vegalite.faceted"],
  gltf: ["gltf.external", "glb.embedded"],
  lottie: ["lottie.nested"],
  pdf: ["pdf.pages"],
  audio: ["audio.wav", "audio.mp3", "audio.flac", "audio.ogg"],
  video: ["video.mp4", "video.webm"],
  fonts: ["font.coverage", "font.axes"],
  zip: ["zip.nested"],
  images: ["image.tall", "image.tiny", "image.alpha", "image.animated-gif", "image.animated-webp", "image.animated-apng"],
  sniff: ["sniff.png", "sniff.pdf", "sniff.zip", "sniff.sqlite", "sniff.mp4", "sniff.wav", "sniff.html"],
};
export const CANVAS = ["canvas.tsx-without-component", "canvas.plugin-only-folder", "canvas.layers-enter-interact"];

// ---------- page helpers (run inside the page; passed by source) ----------
const inPage = (b, fn, ...args) => b.eval(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`);
function pageTables() {
  // A header's name is its own text; secondary lines (type, counts) sit in small/sub elements.
  // An empty column name therefore reads as "", not as the type line under it.
  const label = (e) => {
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (own) return own;
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      return n.parentElement.closest("small,sub,sup,figcaption,[class*=meta],[class*=type],[class*=stat]") ? "" : n.textContent.trim();
    }
    return (e.getAttribute("aria-label") || "").trim();
  };
  const text = (e) => (e.innerText ?? e.textContent ?? "").trim();
  const out = [];
  for (const t of document.querySelectorAll("table,[role=table],[role=grid],[role=treegrid]")) {
    const rows = [...t.querySelectorAll("tr,[role=row]")].filter(
      (r) => r.closest("table,[role=table],[role=grid],[role=treegrid]") === t,
    );
    let header = null;
    const body = [];
    for (const r of rows) {
      const cells = [...r.children].filter((c) =>
        c.matches("td,th,[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]"),
      );
      if (!cells.length) continue;
      if (!header && cells.every((c) => c.matches("th,[role=columnheader]"))) {
        header = cells.map(label);
        continue;
      }
      body.push(cells.map(text));
    }
    out.push({ header: header || [], rows: body });
  }
  return out;
}
function scrollAll(frac) {
  let moved = 0;
  for (const e of [document.scrollingElement, ...document.querySelectorAll("*")]) {
    if (!e) continue;
    const s = getComputedStyle(e);
    if (e.scrollHeight > e.clientHeight + 4 && (e === document.scrollingElement || /auto|scroll/.test(s.overflowY))) {
      const before = e.scrollTop;
      e.scrollTop = frac * (e.scrollHeight - e.clientHeight);
      e.dispatchEvent(new Event("scroll"));
      if (e.scrollTop !== before) moved++;
    }
  }
  return moved;
}
function clickables(re) {
  const rx = new RegExp(re, "i");
  return [...document.querySelectorAll("button,[role=button],a,[role=tab],[role=link]")]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || e.disabled || e.getAttribute("aria-disabled") === "true") return false;
      const name = [e.getAttribute("aria-label"), e.title, e.textContent].filter(Boolean).join(" ").trim();
      return rx.test(name);
    })
    .map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 40) };
    });
}
function largest(selector) {
  const all = [...document.querySelectorAll(selector)]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 8 && r.height > 8)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  if (!all.length) return null;
  const r = all[0].r;
  return {
    x: Math.max(0, Math.round(r.x)),
    y: Math.max(0, Math.round(r.y)),
    w: Math.round(Math.min(r.right, innerWidth) - Math.max(0, r.x)),
    h: Math.round(Math.min(r.bottom, innerHeight) - Math.max(0, r.y)),
    tag: all[0].e.tagName.toLowerCase(),
    full: { x: r.x, y: r.y, w: r.width, h: r.height },
    // For an SVG, the box its drawn shapes actually occupy (a viewBox may centre a narrower
    // drawing inside a wide element).
    drawn: (() => {
      if (all[0].e.tagName.toLowerCase() !== "svg") return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const e of all[0].e.querySelectorAll("rect,path,line,polyline,polygon,circle")) {
        const q = e.getBoundingClientRect();
        if (q.width <= 0 && q.height <= 0) continue;
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.right); y1 = Math.max(y1, q.bottom);
      }
      return x1 > x0 ? { x: Math.round(x0), y: Math.round(r.y), w: Math.round(x1 - x0), h: Math.round(r.height) } : null;
    })(),
  };
}

// ---------- person-like navigation ----------
async function click(b, x, y) {
  for (const type of ["mousePressed", "mouseReleased"])
    await b.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
async function clickName(b, re) {
  const c = await inPage(b, clickables, re);
  if (!c.length) return false;
  await click(b, c[0].x, c[0].y);
  await sleep(220);
  return true;
}
const text = (b) => b.eval("document.body.innerText");
// Text a person sees inside every frame (a page may be shown in a sandboxed iframe), read in an
// isolated world per frame so cross-origin sandboxing does not hide it.
async function framesText(b) {
  const { frameTree } = await b.send("Page.getFrameTree");
  const ids = [];
  const walkTree = (t) => (t.childFrames || []).forEach((c) => (ids.push(c.frame.id), walkTree(c)));
  walkTree(frameTree);
  const out = [];
  for (const frameId of ids) {
    try {
      const { executionContextId } = await b.send("Page.createIsolatedWorld", { frameId, worldName: "fidelity3" });
      const r = await b.send("Runtime.evaluate", { expression: "document.body?.innerText||''", contextId: executionContextId, returnByValue: true });
      out.push(r.result?.value || "");
    } catch {}
  }
  return out.join("\n");
}
async function open(b, s, item) {
  await b.goto(s.base + "/view/" + encodeURIComponent(item.id));
  await b.eval("document.fonts.ready");
  await b.eval("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  await sleep(450);
}
async function typeInto(b, selectorRe, value) {
  const at = await b.eval(
    `(()=>{const rx=new RegExp(${JSON.stringify(selectorRe)},'i');const e=[...document.querySelectorAll('input,[role=searchbox],[contenteditable=true]')].find(e=>{const r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0))return false;const n=[e.type,e.getAttribute('aria-label'),e.placeholder,e.name,e.id,e.title].filter(Boolean).join(' ');return rx.test(n)});if(!e)return false;e.focus();if('value' in e){e.select?.()}return true})()`,
  );
  if (!at) return false;
  await key(b, "a", 2);
  await key(b, "Backspace");
  await b.send("Input.insertText", { text: String(value) });
  await key(b, "Enter");
  await sleep(450);
  return true;
}
// Try what a person would try, in order, until `test()` holds. Returns the route or null.
const trace = process.env.NAPKIN_BENCH_TRACE ? (...a) => console.error("[f3]", ...a) : () => {};
async function reach(b, test, { needle, row, rows } = {}) {
  trace("reach", { needle, row });
  if (await test()) return "shown";
  for (const frac of [1, 0.5, 0]) {
    await inPage(b, scrollAll, frac);
    await sleep(200);
    if (await test()) return "scroll";
  }
  await b.eval("document.querySelector('[tabindex],table,[role=grid],main')?.focus?.()");
  for (const [k, m] of [["End", 0], ["End", 2]]) {
    await key(b, k, m);
    await sleep(250);
    if (await test()) return "key " + k;
  }
  if (needle !== undefined)
    for (const re of ["search|filter|find", "^text$|^$"])
      if (await typeInto(b, re, needle)) {
        if (await test()) return "filter";
        break;
      }
  if (row !== undefined)
    for (const v of [row + 1, row])
      if (await typeInto(b, "number|row|go ?to|jump", v)) if (await test()) return "go to row";
  trace("reach: last/next buttons");
  if (await clickName(b, "^(last|end|»|⇥|⏭)|last (page|rows)|jump to end")) if (await test()) return "last button";
  for (let n = 0; n < (rows ?? 40); n++) {
    if (!(await clickName(b, "^(next|more|show more|load more|show (next|entries|items|rows)|→|›|»)|next (page|rows)|show \\d+ more|more rows"))) break;
    if (await test()) return `next ×${n + 1}`;
  }
  return null;
}
async function expandAll(b, rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    const n = await b.eval(
      `(()=>{let n=0;for(const s of document.querySelectorAll('details:not([open])>summary')){s.click();if(++n>300)break}for(const e of document.querySelectorAll('[aria-expanded=false]')){if(e.getBoundingClientRect().width>0){e.click();if(++n>600)break}}for(const e of document.querySelectorAll('button,[role=button]')){const t=(e.getAttribute('aria-label')||e.textContent||'').trim();if(/^(show|load) (\\d+ )?(more|all|rest|next|entries|items|rows|children)|^more$|^…$|^\\.\\.\\.$/i.test(t)&&!e.disabled){e.click();if(++n>700)break}}return n})()`,
    );
    await sleep(120);
    if (!n) return i;
  }
  return rounds;
}

// ---------- cell comparison ----------
const NULLS = new Set(["", "∅", "null", "NULL", "—", "–", "-", "None", "nil", "(null)", "NaN"]);
const norm = (x) => String(x ?? "").replace(/[\s↵⏎␤]+/g, " ").trim();
export function cellEq(shown, ref, typed = false) {
  const s = norm(shown);
  if (ref === null || ref === undefined) return NULLS.has(s);
  const r = norm(ref);
  if (s === r) return true;
  if (r === "") return NULLS.has(s);
  const bare = s.replace(/[,    ]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(r) && !/^-?0\d/.test(r) && bare === r) return true;
  if (/^(true|false)$/i.test(r)) {
    const t = /^(true|✓|✔|yes)$/i.test(s),
      f = /^(false|✗|✘|×|no)$/i.test(s);
    return r.toLowerCase() === "true" ? t : f;
  }
  if (typed && /^-?\d+\.\d+(e-?\d+)?$/i.test(r) && Number(bare) === Number(r)) return true;
  if (typed && /^-?\d+\.0+$/.test(r) && bare === r.replace(/\.0+$/, "")) return true;
  return false;
}
const headerEq = (shown, ref) =>
  norm(shown) === norm(ref) ||
  (ref === "" && /^(\(?(blank|empty|unnamed|untitled|no name)\)?|column\s*\d+|col\s*\d+|_\d+)$/i.test(norm(shown)));
// Locate the reference header as a contiguous run in the shown header (extra columns such as a
// row number may come before it). Returns the offset or -1.
function align(shownHeader, refHeader) {
  for (let off = 0; off + refHeader.length <= shownHeader.length; off++)
    if (refHeader.every((h, i) => headerEq(shownHeader[off + i], h))) return off;
  return -1;
}
const bareKey = (x) => (/^[\d,.\u202f\u2009\u00a0 ]+$/.test(norm(x)) ? norm(x).replace(/[,\u202f\u2009\u00a0 ]/g, "") : norm(x));
export async function findRow(b, refHeader, keyValue) {
  const tables = await inPage(b, pageTables);
  for (const t of tables) {
    const off = align(t.header, refHeader);
    if (off < 0) continue;
    const row = t.rows.find((r) => bareKey(r[off]) === norm(keyValue));
    if (row) return { off, row, header: t.header };
  }
  return { tables: tables.map((t) => ({ header: t.header, n: t.rows.length })) };
}
async function shownKeys(b, refHeader, keyRe) {
  const tables = await inPage(b, pageTables),
    rx = new RegExp(keyRe.re);
  for (const t of tables) {
    const off = align(t.header, refHeader);
    if (off < 0) continue;
    return t.rows.map((r) => rx.exec(bareKey(r[off]))).filter(Boolean).map((m) => Number(m[1]) + (keyRe.offset || 0));
  }
  return [];
}
// Reach row `index` of a table: scroll proportionally and correct from the rows on screen, then
// the generic routes (End, filter by its key, go-to-row input, last/next buttons).
export async function seekRow(b, c, ref, index) {
  const keyValue = ref.cells[0],
    total = c.ref.total ?? ref.total;
  const has = async () => !!(await findRow(b, c.ref.header ?? ref.header, keyValue)).row;
  if (await has()) return "shown";
  let frac = total > 1 ? index / (total - 1) : 0,
    last = null;
  for (let i = 0; i < 12; i++) {
    trace("seekRow", index, "scroll", frac);
    const moved = await inPage(b, scrollAll, frac);
    await sleep(260);
    if (await has()) return "scroll";
    const keys = await shownKeys(b, c.ref.header ?? ref.header, c.keyRe);
    if (!keys.length || !moved) break;
    const lo = Math.min(...keys),
      hi = Math.max(...keys),
      sig = lo + ":" + hi;
    if (sig === last) break;
    last = sig;
    frac = Math.min(1, Math.max(0, frac + (index - (lo + hi) / 2) / Math.max(1, total - 1)));
  }
  return reach(b, has, { needle: keyValue, row: index, rows: 40 });
}
const groupRe = (n) => {
  const s = String(n),
    g = s.replace(/\B(?=(\d{3})+(?!\d))/g, "[,.    ]?");
  return new RegExp(`(^|[^\\d.,])${g}(?![\\d])`);
};

// ---------- family checks: each returns a value object or throws with what a person would see ----------
async function tableCase(b, s, item, c, { typed = false, meta = true } = {}) {
  await open(b, s, item);
  const failures = [],
    routes = {};
  const t = await text(b);
  if (c.ref.total !== undefined && !groupRe(c.ref.total).test(t))
    failures.push(`row count ${c.ref.total} not shown`);
  for (const ref of c.ref.rows) {
    const route = await seekRow(b, c, ref, ref.index);
    routes[ref.index] = route;
    if (!route) {
      const nearby = await shownKeys(b, c.ref.header, c.keyRe);
      failures.push(`row ${ref.index} (${ref.cells[0]}) of ${c.ref.total} never reachable (rows on screen ${nearby.length ? Math.min(...nearby) + "–" + Math.max(...nearby) : "none matched the file's header " + JSON.stringify(c.ref.header)})`);
      continue;
    }
    const f = await findRow(b, c.ref.header, ref.cells[0]);
    const shown = f.row.slice(f.off, f.off + ref.cells.length);
    const bad = ref.cells
      .map((v, i) => (cellEq(shown[i], v, typed) ? null : `${c.ref.header[i] || "(empty header)"}: file ${JSON.stringify(v)}, shown ${JSON.stringify(shown[i])}`))
      .filter(Boolean);
    if (bad.length) failures.push(`row ${ref.index}: ${bad.join("; ")}`);
  }
  // What an agent reads must be true too: a table preview in /api/items meta is compared
  // positionally with the reference's first row.
  const preview = item.meta?.table;
  if (meta && preview?.rows?.length && c.ref.rows[0]?.index === 0) {
    const names = (preview.columns || []).map((x) => x.name ?? x);
    if (names.length && names.join("\u0001") !== c.ref.header.join("\u0001"))
      failures.push(`served meta columns ${JSON.stringify(names)}, file ${JSON.stringify(c.ref.header)}`);
    const row = preview.rows[0],
      cells = Array.isArray(row) ? row : c.ref.header.map((h) => row[h]);
    const bad = c.ref.rows[0].cells.map((v, i) => (cellEq(cells[i] === null ? null : String(cells[i]), v, typed) ? null : `${c.ref.header[i] || "(empty)"} ${JSON.stringify(v)}→${JSON.stringify(cells[i])}`)).filter(Boolean);
    if (bad.length) failures.push(`served meta row 0: ${bad.join("; ")}`);
  }
  assert(!failures.length, failures.join(" | "));
  return { rows: c.ref.rows.map((r) => r.index), total: c.ref.total, routes };
}
const keyRes = {
  csv: (c) => ({ re: `^${c.ref.rows[0].cells[0].replace(/\d+$/, "")}(\\d+)$` }),
};
async function jsonCase(b, s, item, c) {
  await open(b, s, item);
  const failures = [];
  await expandAll(b);
  for (const needle of c.ref.find || []) {
    const has = async () => {
      await expandAll(b, 4);
      return (await text(b)).includes(needle);
    };
    const route = await reach(b, has, { needle });
    if (!route) failures.push(`value ${needle} never reachable`);
  }
  for (const lit of c.ref.exact || []) {
    const has = async () => norm(await text(b)).includes(lit);
    const route = await reach(b, has, { needle: lit });
    if (!route) {
      const nums = (norm(await text(b)).match(/-?\d[\d.e+-]{12,}/g) || []).slice(0, 6);
      failures.push(`number ${lit} not shown exactly (numbers on screen: ${nums.join(", ") || "none"})`);
    }
  }
  if (c.ref.count !== undefined && !groupRe(c.ref.count).test(await text(b)))
    failures.push(`element count ${c.ref.count} not shown`);
  assert(!failures.length, failures.join(" | "));
  return { found: [...(c.ref.find || []), ...(c.ref.exact || [])] };
}
async function sqliteCase(b, s, item, c) {
  await open(b, s, item);
  const failures = [],
    seen = {};
  const t0 = await text(b);
  for (const table of c.ref.tables)
    if (!t0.includes(table.name)) failures.push(`table ${table.name} not listed`);
  for (const table of c.ref.tables) {
    // A person picks the table: a <select>, a tab/button/list entry with its name.
    const picked = await b.eval(
      `(()=>{const n=${JSON.stringify(table.name)};for(const s of document.querySelectorAll('select')){const o=[...s.options].find(o=>o.textContent.trim()===n||o.value===n);if(o){s.value=o.value;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return 'select'}}const e=[...document.querySelectorAll('button,[role=tab],[role=option],[role=treeitem],a,li')].find(e=>e.textContent.trim()===n&&e.getBoundingClientRect().width>0);if(e){e.click();return 'click'}return null})()`,
    );
    await sleep(500);
    if (!picked) {
      failures.push(`no way to open table ${table.name}`);
      continue;
    }
    const sub = {
      ref: { header: table.header, total: table.total, rows: table.rows },
      keyRe: table.name === "tags" ? { re: "^tag-[a-z]+-(\\d+)$" } : { re: "^(\\d+)$", offset: -1 },
    };
    if (!groupRe(table.total).test(await text(b))) failures.push(`${table.name}: row count ${table.total} not shown`);
    for (const ref of table.rows) {
      const route = await seekRow(b, sub, ref, ref.index);
      if (!route) {
        failures.push(`${table.name} row ${ref.index} of ${table.total} never reachable`);
        continue;
      }
      const f = await findRow(b, table.header, ref.cells[0]);
      const shown = f.row.slice(f.off, f.off + ref.cells.length);
      const bad = ref.cells.map((v, i) => (cellEq(shown[i], v, true) ? null : `${table.header[i]}: file ${JSON.stringify(v)}, shown ${JSON.stringify(shown[i])}`)).filter(Boolean);
      if (bad.length) failures.push(`${table.name} row ${ref.index}: ${bad.join("; ")}`);
      seen[table.name] = (seen[table.name] || 0) + 1;
    }
  }
  assert(!failures.length, failures.join(" | "));
  return { tables: c.ref.tables.map((t) => `${t.name}:${t.total}`), seen };
}
async function markdownCase(b, s, item, c) {
  await open(b, s, item);
  const r = await b.eval(
    `(async()=>{const cells=[...document.querySelectorAll('table th,table td,[role=columnheader],[role=cell],[role=gridcell]')].map(e=>e.textContent.replace(/\\s+/g,' ').trim());const boxes=[...document.querySelectorAll('input[type=checkbox],[role=checkbox]')].map(e=>e.checked??(e.getAttribute('aria-checked')==='true'));const pres=[...document.querySelectorAll('pre')].map(e=>e.textContent);const imgs=[];for(const i of document.images){try{await i.decode()}catch{}imgs.push({w:i.naturalWidth,h:i.naturalHeight,src:i.getAttribute('src')})}return{cells,boxes,pres,imgs,text:document.body.innerText}})()`,
  );
  const failures = [];
  const want = c.ref.cells.map(norm);
  const at = r.cells.findIndex((x, i) => want.every((w, k) => r.cells[i + k] === w));
  if (at < 0) failures.push(`table not rendered as a table (cells shown: ${r.cells.length}; literal pipes on screen: ${/\|\s*-{3}/.test(r.text)})`);
  const tasks = c.ref.tasks.map((x) => x.done);
  if (r.boxes.length < tasks.length || !tasks.every((d, i) => r.boxes[i] === d))
    failures.push(`task list: file ${JSON.stringify(tasks)}, checkboxes ${JSON.stringify(r.boxes)}${/\[[ xX]\]/.test(r.text) ? " (literal [x] on screen)" : ""}`);
  if (!r.pres.some((p) => norm(p) === norm(c.ref.code))) failures.push("fenced code block not shown verbatim in a pre");
  const [iw, ih] = c.ref.imageSize;
  if (!r.imgs.some((i) => i.w === iw && i.h === ih)) failures.push(`relative image (${iw}×${ih}) not loaded: ${JSON.stringify(r.imgs)}`);
  else {
    const p = decodePng(await b.screenshot());
    for (const col of c.ref.colours) if (share(p, col) < 0.0008) failures.push(`image colour ${col} not on screen`);
  }
  assert(!failures.length, failures.join(" | "));
  return { cells: want.length, tasks: tasks.length, image: `${iw}×${ih}` };
}
function chartShapes() {
  const svgs = [...document.querySelectorAll("svg")]
    .map((s) => ({ s, r: s.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 120 && r.height > 80)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  if (!svgs.length) return null;
  const { s, r: sr } = svgs[0];
  const out = { rects: [], symbols: [], lines: [], w: sr.width, h: sr.height };
  for (const e of s.querySelectorAll("rect,circle,ellipse,path,polyline,line,polygon")) {
    if (e.closest("defs,clipPath,mask,marker")) continue;
    // Point marks may be hollow (vega-lite's default point is stroked, not filled); invisible
    // hit targets (no fill, no stroke) are not marks.
    const st = getComputedStyle(e);
    if (st.display === "none" || st.visibility === "hidden" || +st.opacity === 0) continue;
    const r = e.getBoundingClientRect(),
      fill = st.fill && st.fill !== "none" && !/rgba\(.*, 0\)/.test(st.fill),
      stroke = st.stroke && st.stroke !== "none" && parseFloat(st.strokeWidth) > 0;
    const t = e.tagName.toLowerCase();
    const box = { x: r.x - sr.x, y: r.y - sr.y, w: r.width, h: r.height };
    if (t === "rect" && fill && box.w >= 1 && box.h >= 0.5 && box.w < sr.width * 0.6 && box.h < sr.height * 0.9) out.rects.push(box);
    else if ((t === "circle" || t === "ellipse" || t === "path") && (fill || stroke) && box.w >= 2 && box.w <= 30 && box.h >= 2 && box.h <= 30 && Math.abs(box.w - box.h) < 4) out.symbols.push({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
    else if ((t === "path" || t === "polyline") && stroke && !fill && box.w > 40) out.lines.push(box);
  }
  return out;
}
const corr = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n,
    mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let c = 0,
    va = 0,
    vb = 0;
  for (let i = 0; i < n; i++) {
    c += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va && vb ? c / Math.sqrt(va * vb) : 0;
};
function columns(rects) {
  const sorted = [...rects].sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
  const cols = [];
  for (const r of sorted) {
    const cx = r.x + r.w / 2,
      last = cols.at(-1);
    if (last && Math.abs(last.cx - cx) < 1.5) last.segs.push(r.h);
    else cols.push({ cx, segs: [r.h] });
  }
  return cols.map((c) => ({ cx: c.cx, n: c.segs.length, total: c.segs.reduce((a, b) => a + b, 0) }));
}
async function vegaCase(b, s, item, c) {
  await open(b, s, item);
  await sleep(300);
  const shapes = await inPage(b, chartShapes);
  assert(shapes, "no chart drawn (no SVG at chart size)");
  const ref = c.ref;
  if (ref.spec === "layered") {
    const failures = [];
    if (shapes.symbols.length !== ref.symbol) failures.push(`${shapes.symbols.length} point marks, reference ${ref.symbol}`);
    if (shapes.lines.length < ref.line) failures.push(`${shapes.lines.length} line marks, reference ${ref.line}`);
    const ps = [...shapes.symbols].sort((a, b) => a.x - b.x).map((p) => p.y),
      rs = [...ref.symbols].sort((a, b) => a.x - b.x).map((p) => p.y);
    const k = corr(ps, rs);
    if (shapes.symbols.length === ref.symbol && k < 0.98) failures.push(`point positions do not follow the reference (r=${k.toFixed(3)})`);
    assert(!failures.length, failures.join(" | "));
    return { points: shapes.symbols.length, lines: shapes.lines.length, r: k };
  }
  const want = columns(ref.rect),
    got = columns(shapes.rects);
  let best = null;
  for (let off = 0; off + want.length <= got.length; off++) {
    const win = got.slice(off, off + want.length);
    if (!win.every((g, i) => g.n === want[i].n)) continue;
    const k = corr(win.map((x) => x.total), want.map((x) => x.total));
    if (!best || k > best.k) best = { off, k };
  }
  assert(
    best && best.k > 0.98,
    `${ref.spec}: reference has ${ref.rect.length} bars in ${want.length} columns (${want.map((x) => x.n).join("/")} segments); shown ${shapes.rects.length} bars in ${got.length} columns (${got.map((x) => x.n).join("/")})${best ? `, heights r=${best.k.toFixed(3)}` : ""}`,
  );
  return { bars: ref.rect.length, columns: want.length, r: best.k };
}
// Pixel classes by hue, robust to shading and scaling.
const CLASS = {
  red: (r, g, b) => r > 140 && g < 100 && b < 100 && r - g > 80,
  green: (r, g, b) => g > 120 && r < 110 && b < 130 && g - r > 60,
  blue: (r, g, b) => b > 150 && r < 120 && g < 150 && b - r > 70,
  yellow: (r, g, b) => r > 180 && g > 150 && b < 110,
};
function mask(p, rect, f) {
  const m = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) {
      const i = ((rect.y + y) * p.width + rect.x + x) * 4;
      if (f(p.data[i], p.data[i + 1], p.data[i + 2])) m[y * rect.w + x] = 1;
    }
  return m;
}
function components(m, w, h, min = 25) {
  const seen = new Uint8Array(m.length),
    out = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || seen[s]) continue;
    let n = 0,
      sx = 0,
      sy = 0;
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const q = st.pop(),
        x = q % w,
        y = (q / w) | 0;
      n++, (sx += x), (sy += y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx,
          ny = y + dy,
          k = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[k] && !seen[k]) (seen[k] = 1), st.push(k);
      }
    }
    if (n >= min) out.push({ n, x: sx / n, y: sy / n });
  }
  return out;
}
async function modelCase(b, s, item, c) {
  await open(b, s, item);
  await sleep(900);
  const rect = await inPage(b, largest, "canvas");
  assert(rect, "no model canvas");
  let last;
  for (let n = 0; n < 4; n++) {
    const p = decodePng(await b.screenshot());
    const area = rect.w * rect.h;
    const reds = components(mask(p, rect, CLASS.red), rect.w, rect.h).sort((a, b) => a.y - b.y);
    const green = mask(p, rect, CLASS.green).reduce((a, x) => a + x, 0);
    const blue = mask(p, rect, CLASS.blue).reduce((a, x) => a + x, 0) / area,
      yellow = mask(p, rect, CLASS.yellow).reduce((a, x) => a + x, 0) / area;
    const gaps = reds.slice(1).map((r, i) => r.y - reds[i].y);
    const meanRed = reds.reduce((a, r) => a + r.n, 0) / Math.max(1, reds.length);
    const v = {
      instances: reds.length,
      spacing: gaps.map((g) => Math.round(g)),
      greenToRed: +(green / Math.max(1, meanRed)).toFixed(2),
      texture: [+blue.toFixed(4), +yellow.toFixed(4)],
    };
    last = v;
    const problems = [];
    if (reds.length !== c.ref.reds) problems.push(`${reds.length} instances of the red mesh drawn, file places ${c.ref.reds}`);
    else if (Math.max(...gaps) > Math.min(...gaps) * 1.35) problems.push(`instance spacing ${v.spacing} is not even; the file spaces them ${c.ref.redSpacing} apart`);
    if (v.greenToRed < c.ref.greenScale ** 2 * 0.55) problems.push(`scaled node area ratio ${v.greenToRed}, file scale ${c.ref.greenScale} (area ≈ ${(c.ref.greenScale ** 2).toFixed(2)}×)`);
    if (blue < 0.0015 || yellow < 0.0015) problems.push(`texture colours missing (blue ${v.texture[0]}, yellow ${v.texture[1]})`);
    if (!problems.length) return v;
    last.problems = problems;
    await sleep(350);
  }
  throw Error(last.problems.join(" | "));
}
function share(p, hexColour, tol = 36, rect = null) {
  const [r, g, bl] = fromHex(hexColour);
  const x0 = rect?.x ?? 0,
    y0 = rect?.y ?? 0,
    x1 = rect ? rect.x + rect.w : p.width,
    y1 = rect ? rect.y + rect.h : p.height;
  let n = 0,
    t = 0;
  for (let y = y0; y < y1; y += 1)
    for (let x = x0; x < x1; x += 1) {
      const i = (y * p.width + x) * 4;
      t++;
      if (Math.abs(p.data[i] - r) <= tol && Math.abs(p.data[i + 1] - g) <= tol && Math.abs(p.data[i + 2] - bl) <= tol) n++;
    }
  return n / Math.max(1, t);
}
async function lottieReference(b, c) {
  // Ground truth: lottie-web itself, with the image asset inlined, in a blank page.
  const src = readFileSync(join(TOOLS, "node_modules/lottie-web/build/player/lottie.min.js"), "utf8");
  const data = structuredClone(c.ref.data);
  data.assets[0] = { ...data.assets[0], u: "", p: "data:image/png;base64," + c.ref.asset, e: 1 };
  // The Lottie spec gives "st" (start time) a default of 0; lottie-web itself skips a layer
  // without it, so the reference gets the spec default written in. The product gets the file as is.
  for (const l of [...data.layers, ...data.assets.flatMap((x) => x.layers || [])]) l.st ??= 0;
  await b.goto("about:blank");
  await b.eval(src.replace(/^\s*/, "") + ";void 0");
  await b.eval(
    `(async()=>{document.body.style.margin='0';document.body.style.background='#fff';const d=document.createElement('div');d.style.cssText='width:480px;height:360px';document.body.appendChild(d);const a=lottie.loadAnimation({container:d,renderer:'svg',loop:false,autoplay:false,animationData:${JSON.stringify(data)}});await new Promise(r=>{a.addEventListener('DOMLoaded',r);setTimeout(r,2000)});a.goToAndStop(10,true);await new Promise(r=>setTimeout(r,300))})()`,
  );
  const p = decodePng(await b.screenshot()),
    rect = { x: 0, y: 0, w: 480, h: 360 };
  return c.ref.colours.map((col) => share(p, col, 30, rect));
}
async function lottieCase(b, s, item, c) {
  let reference;
  try {
    reference = await lottieReference(b, c);
  } catch (e) {
    throw Error("reference missing: lottie-web render failed: " + e.message);
  }
  reference.forEach((v, i) => assert(v > 0.01, `reference lottie-web render lacks ${c.ref.names[i]} colour; generator broken`));
  await open(b, s, item);
  await sleep(700);
  const p = decodePng(await b.screenshot()),
    stage = (await inPage(b, largest, "svg,canvas")) || { x: 0, y: 0, w: W, h: H };
  const shown = c.ref.colours.map((col) => share(p, col, 30, stage));
  const failures = shown
    .map((v, i) => (v < Math.min(0.004, reference[i] * 0.15) ? `${c.ref.names[i]} not drawn (colour ${c.ref.colours[i]} covers ${(v * 100).toFixed(2)}% of the stage; reference ${(reference[i] * 100).toFixed(2)}%)` : null))
    .filter(Boolean);
  assert(!failures.length, failures.join(" | "));
  return { reference: reference.map((x) => +x.toFixed(4)), shown: shown.map((x) => +x.toFixed(4)) };
}
async function pdfCase(b, s, item, c) {
  await open(b, s, item);
  await sleep(600);
  const failures = [];
  const t = await text(b);
  if (!groupRe(c.ref.pages).test(t) || !/page/i.test(t)) failures.push(`page count ${c.ref.pages} not shown`);
  const seen = [];
  const pageShows = async (k) => {
    const p = decodePng(await b.screenshot());
    return share(p, c.ref.blocks[k].block, 34) > 0.01;
  };
  for (let k = 0; k < c.ref.pages; k++) {
    let ok = await pageShows(k);
    if (!ok && k > 0) {
      const route = await (async () => {
        if (await clickName(b, "^(next|→|›)|next page")) {
          await sleep(500);
          if (await pageShows(k)) return "next";
        }
        await b.eval("document.querySelector('[tabindex],canvas,embed,main')?.focus?.()");
        await key(b, "PageDown");
        await sleep(500);
        if (await pageShows(k)) return "PageDown";
        await inPage(b, scrollAll, k / (c.ref.pages - 1));
        await sleep(500);
        if (await pageShows(k)) return "scroll";
        return null;
      })();
      ok = !!route;
    }
    seen.push(ok);
    if (!ok) failures.push(`page ${k + 1}'s content (colour ${c.ref.blocks[k].block} from the reference raster) never shown`);
    else {
      // Text: wherever the reference raster has dark text ink, the shown page must be dark too.
      const view = (await inPage(b, largest, "canvas,img,embed,object,iframe,svg,[data-page],.page")) || null;
      if (view) {
        const ink = await textInk(b, view, c, k);
        if (ink < 0.35) failures.push(`page ${k + 1}: reference text ink not found on the shown page (${(ink * 100).toFixed(0)}% overlap)`);
      }
    }
  }
  assert(!failures.length, failures.join(" | "));
  return { pages: c.ref.pages, seen };
}
async function textInk(b, view, c, k) {
  const tmp = mkdtempSync(join(tmpdir(), "napkin-f3-pdf-"));
  try {
    cli("pdftocairo", ["-png", "-f", String(k + 1), "-l", String(k + 1), "-scale-to-x", String(Math.round(view.full?.w ?? view.w)), "-scale-to-y", "-1", c.abs, join(tmp, "p")]);
    const file = (await import("node:fs")).readdirSync(tmp)[0];
    const ref = decodePng(readFileSync(join(tmp, file)));
    const p = decodePng(await b.screenshot());
    // The shown page may be scaled to the element height instead: fit the reference into the box.
    // Use the element's whole box (it may extend past the viewport); only on-screen ink counts.
    const box = view.full ?? view;
    const scale = Math.min(box.w / ref.width, box.h / ref.height) || 1;
    const ox = box.x + (box.w - ref.width * scale) / 2,
      oy = box.y + (box.h - ref.height * scale) / 2;
    let n = 0,
      hit = 0;
    for (let y = 0; y < ref.height; y += 2)
      for (let x = 0; x < ref.width; x += 2) {
        const i = (y * ref.width + x) * 4;
        if (ref.data[i] + ref.data[i + 1] + ref.data[i + 2] > 150) continue;
        const sx = Math.round(ox + x * scale),
          sy = Math.round(oy + y * scale);
        if (sx < 0 || sy < 0 || sx >= p.width || sy >= p.height) continue;
        n++;
        let dark = false;
        for (let dy = -2; dy <= 2 && !dark; dy++)
          for (let dx = -2; dx <= 2 && !dark; dx++) {
            const j = (Math.min(p.height - 1, Math.max(0, sy + dy)) * p.width + Math.min(p.width - 1, Math.max(0, sx + dx))) * 4;
            if (p.data[j] + p.data[j + 1] + p.data[j + 2] < 300) dark = true;
          }
        if (dark) hit++;
      }
    return n ? hit / n : 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
async function audioCase(b, s, item, c) {
  await open(b, s, item);
  await sleep(900);
  const duration = await b.eval("document.querySelector('audio,video')?.duration");
  const failures = [];
  if (!(Math.abs(duration - c.ref.duration) < 0.15)) failures.push(`playable duration ${duration}, file ${c.ref.duration}`);
  const rect = await inPage(b, largest, '[aria-label*="waveform" i],svg.waveform,canvas,svg');
  if (!rect) failures.push("no waveform");
  else {
    const p = decodePng(await b.screenshot());
    const { inkExtent } = await import("./lib3/semantic.mjs");
    // Sample across the drawn waveform, not the element: an SVG may centre a narrower drawing.
    // Background is read from the element's rim, so keep its vertical extent.
    const drawn = rect.drawn && rect.drawn.w > rect.w * 0.2 ? { ...rect, x: Math.max(rect.x, rect.drawn.x), w: Math.min(rect.drawn.w, rect.w) } : rect;
    const shown = c.ref.envelope.map((_, i) => inkExtent(p, drawn, (i + 0.5) / c.ref.envelope.length, Math.max(1, Math.round(drawn.w / c.ref.envelope.length / 5))));
    const k = corr(shown, c.ref.envelope);
    if (!(k > 0.9)) failures.push(`waveform does not follow the decoded samples (r=${k.toFixed(3)}; shown ${shown.join(",")})`);
  }
  assert(!failures.length, failures.join(" | "));
  return { duration };
}
async function videoCase(b, s, item, c) {
  await open(b, s, item);
  const ok = await b.eval("!!document.querySelector('video')");
  assert(ok, "no video element");
  const failures = [];
  for (const f of c.ref.frames) {
    const px = await b.eval(
      `(async()=>{const v=document.querySelector('video');v.pause();v.currentTime=${f.t};await new Promise(r=>{v.onseeked=r;setTimeout(r,2500)});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const c=document.createElement('canvas');c.width=16;c.height=16;c.getContext('2d').drawImage(v,0,0,16,16);const d=c.getContext('2d').getImageData(8,8,1,1).data;return[d[0],d[1],d[2]]})()`,
    );
    if (![0, 1, 2].every((i) => Math.abs(px[i] - f.rgb[i]) <= 48)) failures.push(`frame at ${f.t.toFixed(2)} s is rgb(${px}), reference rgb(${f.rgb})`);
  }
  // And on screen, not only in the decoder: the frame at the last time is visible.
  const p = decodePng(await b.screenshot());
  const last = c.ref.frames.at(-1).rgb;
  const hexLast = "#" + last.map((v) => v.toString(16).padStart(2, "0")).join("");
  if (share(p, hexLast, 48) < 0.01) failures.push("seeked frame not visible on screen");
  assert(!failures.length, failures.join(" | "));
  return { frames: c.ref.frames.length };
}
async function fontCase(b, s, item, c) {
  await open(b, s, item);
  await expandAll(b, 3);
  const failures = [];
  const t = await text(b);
  if (c.ref.chars) {
    const counts = [c.ref.glyphs, c.ref.chars.length];
    if (!counts.some((n) => new RegExp(`(^|\\D)${n}\\s*(glyph|char)`, "i").test(t))) failures.push(`glyph count (${c.ref.glyphs} glyphs, ${c.ref.chars.length} characters) not shown`);
    const missing = c.ref.chars.filter((ch) => !t.includes(ch));
    if (missing.length) failures.push(`covered characters not shown: ${missing.join(" ")}`);
    const fake = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((ch) => !c.ref.chars.includes(ch));
    const specimenOnly = await b.eval(`[...document.fonts].some(f=>f.status==='loaded'&&!/^(sans|serif|monospace|system-ui)/i.test(f.family))`);
    if (!specimenOnly) failures.push("the font file is not loaded as a FontFace");
    void fake;
  }
  if (c.ref.axes) {
    const names = { wght: "weight", wdth: "width", opsz: "optical size", slnt: "slant", ital: "italic" };
    for (const a of c.ref.axes) {
      const has = new RegExp(`${a.tag}|${names[a.tag] || a.tag}`, "i").test(t) && [a.min, a.max].every((v) => groupRe(v).test(t));
      if (!has) failures.push(`axis ${a.tag} ${a.min}–${a.max} not shown`);
    }
    const sliders = await b.eval(`document.querySelectorAll('input[type=range],[role=slider]').length`);
    if (sliders < c.ref.axes.length) failures.push(`${sliders} axis controls for ${c.ref.axes.length} axes`);
  }
  assert(!failures.length, failures.join(" | "));
  return c.ref.axes ? { axes: c.ref.axes.map((a) => `${a.tag} ${a.min}–${a.max}`) } : { glyphs: c.ref.glyphs, chars: c.ref.chars.length };
}
async function zipCase(b, s, item, c) {
  await open(b, s, item);
  const failures = [];
  await expandAll(b, 6);
  const t = await text(b);
  const files = c.ref.files.filter((f) => !f.path.endsWith("/"));
  for (const f of files) {
    const base = f.path.split("/").pop();
    if (!t.includes(base)) failures.push(`entry ${f.path} not listed`);
  }
  for (const dirName of ["src", "app", "core", "docs", "media"]) if (!t.includes(dirName)) failures.push(`folder ${dirName} not shown`);
  const L = c.ref.large;
  const human = [L.size / 1e6, L.size / 2 ** 20].map((v) => v.toFixed(1));
  if (!groupRe(L.size).test(t) && !human.some((h) => t.includes(h))) failures.push(`large entry size ${L.size} bytes not shown`);
  for (const entryRef of [c.ref.deep, c.ref.tail]) {
    const base = entryRef.path.split("/").pop();
    const at = await b.eval(
      `(()=>{const n=${JSON.stringify(base)};const e=[...document.querySelectorAll('button,a,[role=treeitem],[role=option],li,span')].filter(e=>e.textContent.includes(n)&&e.getBoundingClientRect().width>0).sort((a,b)=>a.textContent.length-b.textContent.length)[0];if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+Math.min(r.width/2,40),y:r.y+r.height/2}})()`,
    );
    if (!at) {
      failures.push(`cannot open ${entryRef.path}`);
      continue;
    }
    await click(b, at.x, at.y);
    await sleep(500);
    if (!(await text(b)).includes(entryRef.text)) failures.push(`opening ${entryRef.path} does not show its contents`);
  }
  assert(!failures.length, failures.join(" | "));
  return { entries: c.ref.files.length };
}
async function imageCase(b, s, item, c) {
  await open(b, s, item);
  const failures = [];
  const t = await text(b);
  if (!new RegExp(`(^|\\D)${c.ref.w}\\s*[×x✕]\\s*${c.ref.h}(\\D|$)`).test(t)) failures.push(`size ${c.ref.w} × ${c.ref.h} not shown`);
  if (c.ref.animated) {
    const best = c.ref.colours.map(() => 0);
    for (let n = 0; n < 10; n++) {
      const p = decodePng(await b.screenshot());
      c.ref.colours.forEach((col, i) => (best[i] = Math.max(best[i], share(p, col))));
      await sleep(180);
    }
    best.forEach((v, i) => v < 0.004 && failures.push(`frame ${i + 1} (colour ${c.ref.colours[i]}) never shown in 1.8 s`));
  } else {
    const p = decodePng(await b.screenshot());
    const min = c.id === "image.tall" ? 0.0006 : 0.004;
    for (const col of c.ref.colours) {
      const v = share(p, col);
      if (v < min) failures.push(`colour ${col} covers ${(v * 100).toFixed(3)}% of the view (a ${c.ref.w}×${c.ref.h} image must be visible)`);
    }
    if (c.ref.hidden && share(p, c.ref.hidden, 30) > 0.0005) failures.push(`fully transparent pixels drawn as their colour ${c.ref.hidden}`);
  }
  assert(!failures.length, failures.join(" | "));
  return { size: `${c.ref.w}×${c.ref.h}` };
}
async function sniffCase(b, s, item, c) {
  assert(kindOk(c.kind, item.kind), `${c.path} holds ${c.kind} bytes; listed as ${item.kind}`);
  await open(b, s, item);
  const r = await b.eval(`({kind:document.querySelector('[data-napkin-kind]')?.dataset.napkinKind,text:document.body.innerText})`);
  r.text += "\n" + (await framesText(b));
  assert(kindOk(c.kind, r.kind), `view root kind ${r.kind}`);
  if (c.ref.text) {
    // Rendered, not listed as source: the markup is not shown as text, and the page's own red
    // paragraph is drawn (a sandboxed frame's text cannot be read, its pixels can).
    assert(!r.text.includes("<h1>"), "sniffed HTML shown as source text");
    const red = share(decodePng(await b.screenshot()), c.ref.colour ?? "#c03030", 30);
    assert(r.text.includes(c.ref.text) || red > 0.0001, `sniffed HTML not rendered as a page (its text is not shown and its red paragraph covers ${(red * 100).toFixed(3)}% of the view)`);
  }
  return { kind: item.kind };
}
const CHECKS = {
  csv: async (b, s, i, c) => {
    if (!c.alt) return tableCase(b, s, i, { ...c, keyRe: keyRes.csv(c) });
    // TSV: pass on either the literal or the quoted reading; fail only if both fail.
    const errs = [];
    for (const [name, ref] of [["literal (IANA)", c.ref], ["quoted (Excel/pandas)", c.alt]]) {
      const cc = { ...c, ref };
      try {
        return { reading: name, ...(await tableCase(b, s, i, { ...cc, keyRe: keyRes.csv(cc) })) };
      } catch (e) {
        errs.push(`${name} reading: ${e.message}`);
      }
    }
    throw Error(errs.join(" || "));
  },
  json: jsonCase,
  arrow: (b, s, i, c) => tableCase(b, s, i, { ...c, keyRe: keyRes.csv(c) }, { typed: true }),
  parquet: (b, s, i, c) => tableCase(b, s, i, { ...c, keyRe: keyRes.csv(c) }, { typed: true }),
  sqlite: sqliteCase,
  markdown: markdownCase,
  vegalite: vegaCase,
  gltf: modelCase,
  lottie: lottieCase,
  pdf: pdfCase,
  audio: audioCase,
  video: videoCase,
  fonts: fontCase,
  zip: zipCase,
  images: imageCase,
  sniff: sniffCase,
};
const TARGET = {
  csv: "every sampled row (first, random, last; row-group/batch edges) reachable; header and cells exactly as the reference parser reads the bytes",
  json: "deepest node and last array element reachable; numbers exactly as written",
  arrow: "rows of every record batch exact (dictionary values, nulls, int64) as apache-arrow reads them",
  parquet: "rows at row-group boundaries and EOF exact as parquetjs-lite reads them",
  sqlite: "every table listed and openable; sampled rows exact as the sqlite3 CLI reads them",
  markdown: "tables, task checkboxes, verbatim code and the relative image as markdown-it reads them",
  vegalite: "mark counts and geometry match the vega reference scenegraph",
  gltf: "instances, node transforms and texture colours drawn as the file states",
  lottie: "nested precomp, relative image asset and a layer without st all drawn, as lottie-web draws them",
  pdf: "page count; each page reachable with the reference raster's colours and text ink",
  audio: "playable duration and waveform envelope follow the samples ffmpeg decodes",
  video: "frames at four times match the frames ffmpeg extracts",
  fonts: "glyph count, covered characters, variable axes with ranges",
  zip: "nested entries listed and openable; large entry size exact",
  images: "size shown; pixels visible; alpha respected; every animation frame shown",
  sniff: "kind decided by the bytes when the extension is wrong or missing",
};

// ---------- canvas checks ----------
async function canvasCards(b) {
  const cards = JSON.parse(
    await b.eval(
      `JSON.stringify([...document.querySelectorAll('[data-item-id]')].map(e=>{let t=e.innerText||'';for(const f of e.querySelectorAll('iframe'))try{t+=' '+f.contentDocument.body.innerText}catch{}const r=e.getBoundingClientRect();return{id:e.dataset.itemId,text:t,content:${CARD_CONTENT}(e),r:{x:r.x,y:r.y,w:r.width,h:r.height}}}))`,
    ),
  );
  // Sandboxed card frames cannot be read from the page; read each in its own isolated world.
  for (const card of cards) card.text += " " + (await cardFramesText(b, card.id));
  return cards;
}
async function cardFramesText(b, id) {
  const out = [];
  for (let i = 0; ; i++) {
    const { result } = await b.send("Runtime.evaluate", {
      expression: `document.querySelector('[data-item-id="'+CSS.escape(${JSON.stringify(id)})+'"]')?.querySelectorAll('iframe')[${i}]`,
    });
    if (!result?.objectId) break;
    try {
      const { node } = await b.send("DOM.describeNode", { objectId: result.objectId });
      if (!node.frameId) continue;
      const { executionContextId } = await b.send("Page.createIsolatedWorld", { frameId: node.frameId, worldName: "fidelity3" });
      const r = await b.send("Runtime.evaluate", { expression: "document.body?.innerText||''", contextId: executionContextId, returnByValue: true });
      out.push(r.result?.value || "");
    } catch {}
  }
  return out.join(" ");
}
async function openLayers(b) {
  const visible = () => b.eval(`[...document.querySelectorAll('[role=tree]')].some(t=>t.getBoundingClientRect().width>0)`);
  if (await visible()) return true;
  await clickName(b, "^layers$");
  await sleep(300);
  return visible();
}
async function layerRows(b) {
  return b.eval(`[...document.querySelectorAll('[role=tree] [role=treeitem]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent.trim())`);
}
async function outShot(b, name) {
  const i = process.argv.indexOf("--out");
  if (i < 0 || !b) return;
  mkdirSync(process.argv[i + 1], { recursive: true });
  writeFileSync(join(process.argv[i + 1], `F3-${name}.png`), await b.screenshot());
}
async function canvasChecks(book, temp, r, ownBrowser) {
  const t = r.tok(4);
  // 1 and 3 share one folder: an ordinary TSX module, a component, and a long CSV.
  const folder = join(temp, "canvas"),
    state = join(temp, "canvas-state");
  mkdirSync(folder);
  writeFileSync(join(folder, `config-${t}.tsx`), `export const config = { title: "ordinary module ${t}", retries: 3 };\nexport type Mode = "a" | "b";\n`);
  writeFileSync(join(folder, `Badge-${t}.tsx`), `export default function Badge() {\n  return <span style={{ padding: 8, background: "#e8f0ff", color: "#123" }}>badge ${t}</span>;\n}\n`);
  const csvRows = Array.from({ length: 400 }, (_, i) => `c${t}${i},${i},${WORD(r)}`);
  writeFileSync(join(folder, `log-${t}.csv`), ["id,seq,word", ...csvRows].join("\n") + "\n");
  let s, b;
  try {
    s = await start(folder, state);
    b = await ownBrowser();
    await b.goto(s.base + "/");
    await waitUntil(() => b.eval("document.querySelectorAll('[data-item-id]').length>0"), 10000).catch(() => {});
    await sleep(1500);
    const listed = await items(s);
    await book.check(
      "fidelity3." + CANVAS[0],
      "a TSX file with no component export still gets a canvas card showing its source",
      async () => {
        const it = listed.find((x) => x.path === `config-${t}.tsx`);
        assert(it, "/api/items omits the TSX module");
        const cards = await canvasCards(b);
        const card = cards.find((x) => x.id === it.id);
        assert(card, `no canvas card for ${it.path} (${cards.length} cards: ${cards.map((x) => x.id).join(", ")})`);
        assert(card.text.includes(`ordinary module ${t}`), "the card does not show the module's source");
        return { ok: true, value: { id: it.id } };
      },
      ["dream"],
    );
    await book.check(
      "fidelity3." + CANVAS[2],
      "select a card through Layers, press Enter: the card is on screen, opaque, hit-testable, and pointer input scrolls its own content",
      async () => {
        const it = listed.find((x) => x.path === `log-${t}.csv`);
        assert(it, "/api/items omits the CSV");
        assert(await openLayers(b), "no Layers tree on screen");
        const rows = await layerRows(b);
        const at = await b.eval(
          `(()=>{const e=[...document.querySelectorAll('[role=tree] [role=treeitem]')].find(e=>e.textContent.includes(${JSON.stringify(`log-${t}.csv`)})&&e.getBoundingClientRect().width>0);if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+Math.min(40,r.width/2),y:r.y+r.height/2}})()`,
        );
        assert(at, `no Layers row for log-${t}.csv (rows: ${rows.slice(0, 8).join(" / ")})`);
        await click(b, at.x, at.y);
        await sleep(200);
        await key(b, "Enter");
        await sleep(900);
        const st = await b.eval(
          `(()=>{const e=document.querySelector('[data-item-id="'+CSS.escape(${JSON.stringify(it.id)})+'"]');if(!e)return null;const r=e.getBoundingClientRect();let o=1;for(let n=e;n;n=n.parentElement)o*=+getComputedStyle(n).opacity;const cx=r.x+r.width/2,cy=r.y+r.height/2;const hit=document.elementFromPoint(cx,cy);return{r:{x:r.x,y:r.y,w:r.width,h:r.height},opacity:o,onScreen:r.width>40&&r.height>40&&r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:!!hit&&(e.contains(hit)||hit===e),cx,cy}})()`,
        );
        assert(st, "card missing after Enter");
        assert(st.onScreen, `card not fully on screen after Enter (${JSON.stringify(st.r)})`);
        assert(st.opacity > 0.98, `card opacity ${st.opacity.toFixed(2)} after Enter`);
        assert(st.hit, "the pointer at the card's centre hits something else");
        const before = (await canvasCards(b)).find((x) => x.id === it.id);
        const keysIn = (txt) => (txt.match(new RegExp(`c${t}(\\d+)`, "g")) || []).map((x) => Number(x.slice(1 + t.length)));
        const maxBefore = Math.max(-1, ...keysIn(before.text));
        for (let n = 0; n < 6; n++) {
          await b.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: st.cx, y: st.cy + 20, deltaX: 0, deltaY: 400 });
          await sleep(120);
        }
        await sleep(500);
        let after = (await canvasCards(b)).find((x) => x.id === it.id);
        let how = "wheel";
        if (Math.max(-1, ...keysIn(after.text)) <= maxBefore) {
          const next = await b.eval(
            `(()=>{const e=document.querySelector('[data-item-id="'+CSS.escape(${JSON.stringify(it.id)})+'"]');const docs=[{d:document,ox:0,oy:0,root:e}];for(const f of e.querySelectorAll('iframe')){try{const r=f.getBoundingClientRect();docs.push({d:f.contentDocument,ox:r.x,oy:r.y,root:f.contentDocument.body})}catch{}}for(const {ox,oy,root} of docs){const b=[...root.querySelectorAll('button,[role=button]')].find(x=>/next|→|more/i.test((x.getAttribute('aria-label')||'')+x.textContent)&&x.getBoundingClientRect().width>0);if(b){const r=b.getBoundingClientRect();return{x:ox+r.x+r.width/2,y:oy+r.y+r.height/2}}}return null})()`,
          );
          if (next) {
            await click(b, next.x, next.y);
            await sleep(600);
            after = (await canvasCards(b)).find((x) => x.id === it.id);
            how = "click next";
          }
        }
        await outShot(b, "canvas.layers-enter-interact");
        const maxAfter = Math.max(-1, ...keysIn(after.text));
        const shift = Math.round(Math.hypot(after.r.x - st.r.x, after.r.y - st.r.y));
        assert(maxAfter > maxBefore, `pointer input inside the focused card does not move its rows (last row shown ${maxBefore} → ${maxAfter}; ${how}${shift >= 3 ? `, the canvas moved the card ${shift} px instead` : ""})`);
        assert(Math.abs(after.r.x - st.r.x) < 3 && Math.abs(after.r.y - st.r.y) < 3, "the canvas moved instead of the card's content");
        return { ok: true, value: { route: how, rows: [maxBefore, maxAfter], opacity: st.opacity } };
      },
      ["dream"],
    );
  } catch (e) {
    for (const id of [CANVAS[0], CANVAS[2]]) if (!book.rows.some((x) => x.id === "fidelity3." + id)) await book.fail("fidelity3." + id, "canvas check", e.message, ["dream"]);
  } finally {
    await s?.stop();
  }
  // 2: a folder that holds only a plugin-registered kind.
  const pfolder = join(temp, "plugin"),
    pstate = join(temp, "plugin-state"),
    plugin = join(temp, "fidelity-note.mjs");
  mkdirSync(pfolder);
  writeFileSync(
    plugin,
    `export default function install({ registerKind }) {\n  registerKind({\n    id: 'fidelity-note', family: 'note', mime: 'text/plain', extensions: ['.fnote'],\n    detect: (c) => c.ext === '.fnote',\n    metadata: (c) => ({ excerpt: c.text.slice(0, 120) }),\n    viewer: (c) => '<html data-napkin-kind="fidelity-note"><body><article style="font:16px sans-serif;padding:12px;background:#fff8e0;color:#332">' + c.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</article></body></html>',\n    controls: (c) => [{ id: 'note', label: 'Note', controls: [{ id: 'text', type: 'textarea', label: 'Text', value: c.text, depth: 2, figure: { type: 'value' } }] }],\n    apply: (c, control, value) => ({ source: value }),\n  });\n}\n`,
  );
  const notes = [0, 1].map((i) => ({ name: `field-${t}-${i}.fnote`, token: `note${t}${r.tok(5)}` }));
  for (const n of notes) writeFileSync(join(pfolder, n.name), `Field note ${n.token}: water level steady.\n`);
  let ps;
  try {
    await book.check(
      "fidelity3." + CANVAS[1],
      "a folder of only a plugin kind: first load shows each card's own content and a Layers row per file, no interaction needed",
      async () => {
        ps = await start(pfolder, pstate, { NAPKIN_KIND_PLUGINS: plugin });
        const listed = await items(ps);
        for (const n of notes) assert(listed.find((x) => x.path === n.name)?.kind === "fidelity-note", `${n.name} not listed as the plugin kind (${JSON.stringify(listed.map((x) => x.kind))})`);
        b = await ownBrowser();
        await b.goto(ps.base + "/");
        await waitUntil(() => b.eval("document.querySelectorAll('[data-item-id]').length>0"), 8000).catch(() => {});
        await sleep(2000);
        const cards = await canvasCards(b);
        await outShot(b, "canvas.plugin-only-folder");
        for (const n of notes) {
          const card = cards.find((x) => x.id === listed.find((y) => y.path === n.name).id);
          assert(card, `no card for ${n.name}`);
          // The plugin's viewer draws the note on #fff8e0; its text may sit in a sandboxed frame.
          const p = decodePng(await b.screenshot());
          const rect = { x: Math.max(0, Math.round(card.r.x)), y: Math.max(0, Math.round(card.r.y)), w: Math.round(Math.min(card.r.w, W - Math.max(0, card.r.x))), h: Math.round(Math.min(card.r.h, H - Math.max(0, card.r.y))) };
          const paper = rect.w > 0 && rect.h > 0 ? share(p, "#fff8e0", 22, rect) : 0;
          assert(card.text.includes(n.token) || paper > 0.15, `card for ${n.name} does not show the file's content on first load (shows: ${card.text.replace(/\s+/g, " ").slice(0, 80)}; plugin viewer's paper colour covers ${(paper * 100).toFixed(1)}% of the card)`);
        }
        assert(await openLayers(b), "no Layers tree on screen");
        const rows = await layerRows(b);
        for (const n of notes) assert(rows.some((x) => x.includes(n.name)), `no Layers row for ${n.name} (rows: ${rows.join(" / ") || "none"})`);
        return { ok: true, value: { cards: notes.length, layers: rows.length } };
      },
      ["dream"],
    );
  } finally {
    await ps?.stop();
  }
}
const WORD = (r) => ["amber", "basil", "cedar", "delta", "ember", "fjord"][r.int(0, 5)];

// ---------- main ----------
export async function measure() {
  ({ kindOk, CARD_CONTENT } = await import("./kinds.js"));
  const book = new Book("D1");
  book.defaultTiers = ["dream"];
  const temp = mkdtempSync(join(tmpdir(), "napkin-f3-")),
    folder = join(temp, "work"),
    state = join(temp, "state");
  mkdirSync(folder);
  const seed = Number(arg("--seed")) || randomInt(1000, 900000),
    r = prng(seed);
  let s, b;
  const browsers = [];
  const ownBrowser = async () => {
    const x = await launchChromium({ width: W, height: H });
    await x.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    browsers.push(x);
    return x;
  };
  const t0 = performance.now();
  try {
    const made = [],
      genErrors = {};
    for (const [family, gen] of Object.entries(FAMILIES)) {
      // Sniff cases copy files made by other families, so --only sniff generates them all.
      if (ONLY && !ONLY.includes(family) && !ONLY.includes("sniff")) continue;
      try {
        const cases = await gen(folder, r, made);
        for (const c of cases) c.abs = join(folder, c.path);
        made.push(...cases);
      } catch (e) {
        genErrors[family] = e.message;
      }
    }
    const genMs = performance.now() - t0;
    s = await start(folder, state);
    const listed = await items(s);
    b = await ownBrowser();
    for (const [family, ids] of Object.entries(EXPECTED)) {
      if (ONLY && !ONLY.includes(family)) continue;
      for (const id of ids) {
        const c = made.find((m) => m.id === id);
        await book.check(`fidelity3.${id}`, TARGET[family], async () => {
          assert(!genErrors[family], genErrors[family]);
          assert(c, `generator made no case ${id}`);
          const item = listed.find((x) => x.path === c.path);
          assert(item, `/api/items omits ${c.path}`);
          if (family !== "sniff") assert(kindOk(c.kind, item.kind), `listed as ${item.kind}, the bytes are ${c.kind}`);
          try {
            return { ok: true, value: await CHECKS[family](b, s, item, c) };
          } finally {
            const i = process.argv.indexOf("--out");
            if (i > 0) {
              mkdirSync(process.argv[i + 1], { recursive: true });
              writeFileSync(join(process.argv[i + 1], `F3-${id}.png`), await b.screenshot());
            }
          }
        });
      }
    }
    await s.stop();
    s = null;
    if (!ONLY || ONLY.includes("canvas")) await canvasChecks(book, temp, r, ownBrowser);
    book.rows.push({ id: "fidelity3.meta", ok: true, value: { seed, generateMs: Math.round(genMs), totalMs: Math.round(performance.now() - t0) }, target: "run facts (not a gate)", tiers: [] });
  } catch (e) {
    await book.fail("fidelity3.harness", "measurement completes", e.stack || e.message, ["dream"]);
  } finally {
    for (const x of browsers) await x.close().catch(() => {});
    await s?.stop();
    rmSync(temp, { recursive: true, force: true });
  }
  return book.result();
}
if (entry(import.meta.url)) output(await measure());
