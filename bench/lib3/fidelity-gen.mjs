// Seeded generators and trusted references for bench/fidelity3.js.
//
// Every file is made at bench time from a per-run seed (nothing is committed), and every expected
// value is read back from the written bytes by an independent reference implementation: csv-parse,
// JSON.parse with source text, apache-arrow, parquetjs-lite, the sqlite3 CLI, markdown-it,
// vega + vega-lite, ffmpeg/ffprobe, pdftocairo/pdfinfo, opentype.js, unzip, lottie-web (rendered in
// the bench's own Chromium). A missing reference throws: the family's checks FAIL, never skip.
import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { deflateSync, deflateRawSync, crc32 } from "node:zlib";
import { ROOT } from "./runtime.mjs";

export const TOOLS = process.env.NAPKIN_D3_TOOLS || join(ROOT, "bench/tools");
const req = createRequire(join(TOOLS, "package.json"));
// A reference library from bench/tools (devDependencies). Missing → loud failure.
export function lib(name) {
  try {
    return req(name);
  } catch (e) {
    throw Error(
      `reference missing: ${name} (run npm ci in bench/tools): ${e.message.split("\n")[0]}`,
    );
  }
}
export async function esm(name) {
  try {
    return await import(pathToFileURL(req.resolve(name)).href);
  } catch (e) {
    throw Error(
      `reference missing: ${name} (run npm ci in bench/tools): ${e.message.split("\n")[0]}`,
    );
  }
}
// A reference command-line tool. Missing → loud failure.
export function cli(name, args, opts = {}) {
  try {
    return execFileSync(name, args, {
      maxBuffer: 1 << 28,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    });
  } catch (e) {
    if (e.code === "ENOENT")
      throw Error(`reference missing: command-line tool ${name} is not installed`);
    throw Error(`${name} ${args.slice(0, 4).join(" ")}: ${String(e.stderr || e.message).slice(0, 300)}`);
  }
}

// ---------- seeded randomness ----------
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(next() * a.length)];
  const tok = (n = 5) =>
    Array.from({ length: n }, () => "abcdefghjkmnpqrstuvwxyz"[int(0, 22)]).join("");
  return { next, int, pick, tok };
}
const WORDS =
  "amber basil cedar delta ember fjord grove harbor indigo juniper kestrel lumen maple nectar orchid pebble quartz raven sable thistle umber violet willow xenon yarrow zephyr".split(
    " ",
  );

// ---------- small encoders ----------
export function png(w, h, pixel) {
  // pixel(x, y) -> [r, g, b, a]
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y),
        o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = p[0];
      raw[o + 1] = p[1];
      raw[o + 2] = p[2];
      raw[o + 3] = p[3] ?? 255;
    }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]),
      crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const DOS_DATE = ((2026 - 1980) << 9) | (3 << 5) | 14;
export function zip(entries) {
  // entries: [name, Buffer|null (directory), deflate?]
  const files = [],
    central = [];
  let offset = 0;
  for (const [name, data, deflate] of entries) {
    const n = Buffer.from(name),
      body = data ? (deflate ? deflateRawSync(data) : data) : Buffer.alloc(0),
      crc = data ? crc32(data) >>> 0 : 0,
      size = data ? data.length : 0,
      method = data && deflate ? 8 : 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(0x6000, 10);
    h.writeUInt16LE(DOS_DATE, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(n.length, 26);
    files.push(h, n, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(0x6000, 12);
    c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(data ? 0 : 0x10, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, cd, end]);
}
function pdf(pages) {
  // pages: [{bg:[r,g,b], block:[r,g,b], text}] → a valid multi-page PDF (Helvetica, US Letter)
  const objs = [];
  const add = (s) => (objs.push(s), objs.length);
  const catalog = add(""),
    pagesObj = add(""),
    font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  const f = (c) => c.map((v) => (v / 255).toFixed(3)).join(" ");
  for (const p of pages) {
    const body = `${f(p.bg)} rg 0 0 612 792 re f\n${f(p.block)} rg 72 360 468 220 re f\n0 0 0 rg BT /F1 30 Tf 72 680 Td (${p.text}) Tj ET\n0 0 0 rg BT /F1 18 Tf 72 640 Td (${p.text} second line of text) Tj ET`;
    const content = add(`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
// Distinct saturated colours, far from greys and from each other.
function colours(r, n) {
  const base = [
    [230, 40, 40],
    [30, 170, 60],
    [40, 80, 230],
    [240, 200, 20],
    [200, 40, 200],
    [20, 190, 200],
    [250, 120, 20],
    [120, 40, 220],
  ];
  const start = r.int(0, base.length - 1);
  return Array.from({ length: n }, (_, i) => base[(start + i * 3) % base.length]);
}

// ---------- reference table readers ----------
function csvRecords(text, delimiter) {
  const { parse } = lib("csv-parse/sync");
  return parse(text, {
    delimiter,
    relax_column_count: true,
    bom: true,
    ...(delimiter === "\t" ? { quote: false } : {}),
  });
}
// The quoted TSV reading, as Excel and Python csv (dialect excel-tab, non-strict, which pandas
// follows) read it: a quote opens a field only at its start; inside, "" is a quote and a lone
// quote ends quoting while the following characters stay in the field. Checked against
// Python 3.12 csv.reader on the generated files when this was written.
function excelTabRecords(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = [];
  let rec = [], f = "", st = "start", any = false;
  const endField = () => { rec.push(f); f = ""; any = true; st = "start"; };
  const endRec = () => { if (any || f) { rec.push(f); out.push(rec); } rec = []; f = ""; any = false; st = "start"; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nl = ch === "\n" || ch === "\r";
    if (nl && ch === "\r" && text[i + 1] === "\n" && st !== "q") i++;
    if (st === "q") {
      if (ch === "\"") st = "qq";
      else f += ch;
    } else if (st === "qq" && ch === "\"") {
      f += ch; st = "q";
    } else if (ch === "\t") endField();
    else if (nl) endRec();
    else if (st === "start" && ch === "\"") st = "q";
    else { f += ch; st = "f"; }
  }
  if (st !== "start" || f || any) endRec();
  return out;
}
function tsvQuotedRef(text) {
  const [header, ...rows] = excelTabRecords(text),
    n = rows.length;
  const idx = [...new Set([0, Math.floor(n / 2), n - 1])].filter((i) => i >= 0 && i < n);
  return { header, rows: idx.map((i) => ({ index: i, cells: rows[i] })), total: n };
}
function decodeBytes(buf, encoding) {
  if (encoding === "utf-16le") return new TextDecoder("utf-16le").decode(buf);
  if (encoding === "latin1") return new TextDecoder("windows-1252").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}
function sampleRows(r, total, extra = []) {
  const s = new Set([0, total - 1, r.int(1, Math.max(1, total - 2)), ...extra]);
  return [...s].filter((x) => x >= 0 && x < total).sort((a, b) => a - b);
}

// ---------- families ----------
// Each returns cases: { id, family, path, kind, ref } after writing files under dir.
export const FAMILIES = {
  async csv(dir, r) {
    const t = r.tok(4),
      cases = [];
    const write = (name, kind, text, { encoding = "utf-8", bom = false } = {}) => {
      let bytes;
      if (encoding === "utf-16le")
        bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
      else if (encoding === "latin1") bytes = Buffer.from(text, "latin1");
      else bytes = Buffer.from((bom ? "﻿" : "") + text, "utf8");
      writeFileSync(join(dir, name), bytes);
      // Reference: decode the written bytes, then csv-parse.
      const records = csvRecords(
        decodeBytes(readFileSync(join(dir, name)), encoding),
        kind === "tsv" ? "\t" : ",",
      );
      const [header, ...rows] = records;
      cases.push({
        id: `${kind}.${name.split("-")[0]}`,
        family: "csv",
        path: name,
        kind,
        bytes: bytes.length,
        ref: { header, rows: sampleRows(r, rows.length).map((i) => ({ index: i, cells: rows[i] })), total: rows.length },
        // TSV has two accepted readings: literal quotes (IANA text/tab-separated-values) and
        // quoted fields (Excel, pandas). A viewer passes if it matches either one in full.
        ...(kind === "tsv" ? { alt: tsvQuotedRef(decodeBytes(readFileSync(join(dir, name)), encoding)) } : {}),
      });
    };
    const lines = (h, rows, sep = ",", eol = "\n") =>
      [h, ...rows].map((x) => x.join(sep)).join(eol) + eol;
    {
      const rows = Array.from({ length: 60 + r.int(0, 30) }, (_, k) => [
        `z${t}${k}`,
        String(r.int(1, 999)).padStart(5, "0"),
        (2n ** 53n + BigInt(2 * r.int(1, 1e6) + 1)).toString(),
        `${r.int(1, 999)}.${r.pick(["50", "10", "05", "00"])}`,
        r.pick(WORDS),
      ]);
      write(`zeros-${t}.csv`, "csv", lines(["id", "code", "big", "amount", "label"], rows));
    }
    {
      const rows = Array.from({ length: 40 + r.int(0, 20) }, (_, k) => [
        `d${t}${k}`,
        String(r.int(100, 499)),
        String(r.int(500, 999)),
        r.pick(WORDS),
        r.pick(WORDS) + "-" + k,
      ]);
      write(`dupes-${t}.csv`, "csv", lines(["id", "value", "value", "", "note"], rows));
    }
    {
      const q = (s) => `"${s.replaceAll('"', '""')}"`;
      const rows = Array.from({ length: 30 + r.int(0, 20) }, (_, k) => [
        `q${t}${k}`,
        q(
          r.pick([
            `${r.pick(WORDS)}, ${r.pick(WORDS)}`,
            `say "${r.pick(WORDS)}" twice`,
            `line one ${k}\nline two ${r.pick(WORDS)}`,
            `${r.pick(WORDS)}`,
          ]),
        ),
        String(r.int(1, 99)),
      ]);
      write(`quotes-${t}.csv`, "csv", lines(["id", "text", "qty"], rows, ",", "\r\n"));
    }
    const cities = ["Zürich", "São Paulo", "Kraków", "Malmö", "Reykjavík", "Ærøskøbing"];
    {
      const rows = Array.from({ length: 30 }, (_, k) => [
        `b${t}${k}`,
        r.pick([...cities, "東京", "Αθήνα", "pizza 🍕"]),
        String(r.int(1, 999)),
      ]);
      write(`bom-${t}.csv`, "csv", lines(["id", "city", "qty"], rows), { bom: true });
      write(`utf16-${t}.csv`, "csv", lines(["id", "city", "qty"], rows.map((x) => [x[0].replace("b", "u"), ...x.slice(1)])), {
        encoding: "utf-16le",
      });
    }
    {
      const rows = Array.from({ length: 30 }, (_, k) => [
        `l${t}${k}`,
        r.pick([...cities.slice(0, 2), "Malmö", "café", "Señor", "Ærøskøbing"]),
        String(r.int(1, 999)),
      ]);
      write(`latin1-${t}.csv`, "csv", lines(["id", "place", "qty"], rows), { encoding: "latin1" });
    }
    {
      const rows = Array.from({ length: 40 }, (_, k) => [
        `t${t}${k}`,
        r.pick(WORDS),
        r.pick([`a 5" screen`, `it's ${r.pick(WORDS)}`, `${r.pick(WORDS)}, ${r.pick(WORDS)}`, `"${r.pick(WORDS)}`]),
      ]);
      write(`tabs-${t}.tsv`, "tsv", lines(["id", "name", "note"], rows, "\t"));
    }
    {
      // > 8 MiB: the last row must still be reachable and exact.
      const out = ["id,seq,payload,score"];
      let n = 0,
        size = 0;
      while (size < 8.6 * 1024 * 1024) {
        const line = `g${t}${n},${n},${r.pick(WORDS)}-${r.pick(WORDS)}-${r.tok(18)},${r.int(0, 99999) / 100}`;
        out.push(line);
        size += line.length + 1;
        n++;
      }
      write(`big-${t}.csv`, "csv", out.join("\n") + "\n");
    }
    {
      const out = ["id\tcity\tseq"];
      let n = 0,
        size = 0;
      while (size < 8.6 * 1024 * 1024) {
        const line = `w${t}${n}\t${r.pick(cities)} ${r.tok(12)}\t${n}`;
        out.push(line);
        size += line.length * 2 + 2;
        n++;
      }
      write(`big16-${t}.tsv`, "tsv", out.join("\n") + "\n", { encoding: "utf-16le" });
    }
    return cases;
  },

  async json(dir, r) {
    const t = r.tok(4),
      cases = [];
    // Reference: JSON.parse with source text, so a number is compared with its literal in the file.
    const parseRaw = (text) =>
      JSON.parse(text, (k, v, ctx) =>
        typeof v === "number" ? { __raw: ctx.source } : v,
      );
    {
      const depth = 24 + r.int(0, 10),
        leaf = `deep${t}${r.tok(4)}`;
      let v = { leaf, n: r.int(1, 9) };
      for (let d = 0; d < depth; d++) v = { [`level${d}`]: v };
      const text = JSON.stringify(v, null, 1);
      writeFileSync(join(dir, `deep-${t}.json`), text);
      let cur = parseRaw(readFileSync(join(dir, `deep-${t}.json`), "utf8"));
      while (!cur.leaf) cur = Object.values(cur)[0];
      cases.push({ id: "json.deep", family: "json", path: `deep-${t}.json`, kind: "json", ref: { find: [cur.leaf] } });
    }
    {
      const n = 1200 + r.int(0, 600);
      const text = JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, tag: `w${t}x${i}` })) });
      writeFileSync(join(dir, `wide-${t}.json`), text);
      const back = parseRaw(readFileSync(join(dir, `wide-${t}.json`), "utf8"));
      const items = back.items,
        mid = r.int(250, items.length - 2);
      cases.push({
        id: "json.wide",
        family: "json",
        path: `wide-${t}.json`,
        kind: "json",
        ref: { find: [items.at(-1).tag, items[mid].tag], count: items.length },
      });
    }
    {
      const big = `${r.int(1, 9)}${Array.from({ length: 19 }, () => r.int(0, 9)).join("")}`;
      const unsafe = (2n ** 53n + BigInt(2 * r.int(1, 5000) + 1)).toString();
      const text = `{"id":"n${t}","big":${big},"unsafe":${unsafe},"neg":-${unsafe},"precise":0.1000000000000000055511151231257827,"small":1e-7,"list":[${unsafe},${big}]}`;
      writeFileSync(join(dir, `bignum-${t}.json`), text);
      const back = parseRaw(readFileSync(join(dir, `bignum-${t}.json`), "utf8"));
      cases.push({
        id: "json.bignum",
        family: "json",
        path: `bignum-${t}.json`,
        kind: "json",
        ref: { exact: [back.big.__raw, back.unsafe.__raw, back.neg.__raw, back.precise.__raw] },
      });
    }
    {
      const n = 2500 + r.int(0, 500),
        lines = [];
      for (let i = 0; i < n; i++)
        lines.push(`{"id":"j${t}y${i}","n":${(2n ** 53n + BigInt(2 * i + 1)).toString()},"w":"${r.pick(WORDS)}"}`);
      writeFileSync(join(dir, `rows-${t}.jsonl`), lines.join("\n") + "\n");
      const back = readFileSync(join(dir, `rows-${t}.jsonl`), "utf8")
        .split("\n")
        .filter(Boolean)
        .map(parseRaw);
      const last = back.at(-1);
      cases.push({
        id: "jsonl.rows",
        family: "json",
        path: `rows-${t}.jsonl`,
        kind: "jsonl",
        ref: { find: [last.id], exact: [last.n.__raw], count: back.length, keyed: { key: last.id, value: last.n.__raw } },
      });
    }
    return cases;
  },

  async arrow(dir, r) {
    const A = lib("apache-arrow"),
      t = r.tok(4),
      cases = [];
    const cities = ["Aspen", "Denver", "Boise", "Tulsa", "Fargo"];
    const batch = (n, off) =>
      new A.Table({
        id: A.vectorFromArray(Array.from({ length: n }, (_, i) => `a${t}${off + i}`), new A.Utf8()),
        city: A.vectorFromArray(
          Array.from({ length: n }, (_, i) => cities[(off + i) * 7 % cities.length]),
          new A.Dictionary(new A.Utf8(), new A.Int32()),
        ),
        value: A.vectorFromArray(Array.from({ length: n }, (_, i) => ((off + i) * 37) % 1000), new A.Int32()),
        score: A.vectorFromArray(
          Array.from({ length: n }, (_, i) => ((off + i) % 5 === 2 ? null : ((off + i) * 13) / 4)),
          new A.Float64(),
        ),
        big: A.vectorFromArray(
          Array.from({ length: n }, (_, i) => 2n ** 53n + BigInt(2 * (off + i) + 1)),
          new A.Int64(),
        ),
        ok: A.vectorFromArray(Array.from({ length: n }, (_, i) => (off + i) % 3 === 0), new A.Bool()),
      });
    const sizes = [300 + r.int(0, 100), 250 + r.int(0, 100), 200 + r.int(0, 100)];
    const whole = batch(sizes[0] + sizes[1] + sizes[2], 0),
      table = new A.Table([
        ...whole.slice(0, sizes[0]).batches,
        ...whole.slice(sizes[0], sizes[0] + sizes[1]).batches,
        ...whole.slice(sizes[0] + sizes[1]).batches,
      ]);
    for (const [name, format] of [
      [`dict-${t}.arrow`, "file"],
      [`stream-${t}.arrows`, "stream"],
      [`streamext-${t}.arrow`, "stream"],
    ]) {
      writeFileSync(join(dir, name), A.tableToIPC(table, format));
      const back = A.tableFromIPC(readFileSync(join(dir, name)));
      const fields = back.schema.fields.map((f) => f.name);
      const rows = back.toArray();
      const firstBatchEnd = back.batches[0].numRows;
      const picks = sampleRows(r, back.numRows, [firstBatchEnd, firstBatchEnd - 1]);
      const fmt = (v) => (v === null || v === undefined ? null : typeof v === "bigint" ? v.toString() : String(v));
      cases.push({
        id: `arrow.${format}${name.startsWith("streamext") ? "-in-.arrow" : ""}`,
        family: "arrow",
        path: name,
        kind: "arrow",
        ref: {
          header: fields,
          total: back.numRows,
          batches: back.batches.length,
          rows: picks.map((i) => ({ index: i, cells: fields.map((f) => fmt(rows[i][f])) })),
        },
      });
    }
    return cases;
  },

  async parquet(dir, r) {
    const PQ = lib("parquetjs-lite"),
      t = r.tok(4);
    const name = `groups-${t}.parquet`,
      group = 700 + r.int(0, 300),
      total = group * 3 + r.int(10, group - 10);
    const schema = new PQ.ParquetSchema({
      id: { type: "UTF8" },
      n: { type: "INT64" },
      x: { type: "DOUBLE" },
      ok: { type: "BOOLEAN" },
      note: { type: "UTF8", optional: true },
    });
    const w = await PQ.ParquetWriter.openFile(schema, join(dir, name), { rowGroupSize: group });
    for (let i = 0; i < total; i++)
      await w.appendRow({
        id: `p${t}${i}`,
        n: i * 1000003,
        x: i / 8,
        ok: i % 3 === 1,
        ...(i % 4 === 3 ? {} : { note: `${WORDS[i % WORDS.length]}-${i}` }),
      });
    await w.close();
    const reader = await PQ.ParquetReader.openFile(join(dir, name)),
      cur = reader.getCursor(),
      rows = [];
    for (let x; (x = await cur.next()); ) rows.push(x);
    const groups = reader.metadata.row_groups.map((g) => Number(g.num_rows));
    await reader.close();
    const header = ["id", "n", "x", "ok", "note"],
      bounds = [groups[0] - 1, groups[0], groups[0] + groups[1], total - 1];
    const fmt = (v) => (v === null || v === undefined ? null : String(v));
    return [
      {
        id: "parquet.groups",
        family: "parquet",
        path: name,
        kind: "parquet",
        ref: {
          header,
          total: rows.length,
          groups,
          rows: sampleRows(r, rows.length, bounds).map((i) => ({ index: i, cells: header.map((h) => fmt(rows[i][h])) })),
        },
      },
    ];
  },

  async sqlite(dir, r) {
    const t = r.tok(4),
      name = `shop-${t}.sqlite`;
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(dir, name));
    const nOrders = 900 + r.int(0, 400);
    try {
      db.exec(
        "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, credit REAL, note TEXT);" +
          "CREATE TABLE orders(id INTEGER PRIMARY KEY, customer INTEGER, total REAL, code TEXT, big INTEGER);" +
          "CREATE TABLE tags(tag TEXT, weight INTEGER);",
      );
      const c = db.prepare("INSERT INTO customers VALUES(?,?,?,?)");
      for (let i = 1; i <= 40; i++) c.run(i, `${r.pick(WORDS)}-${t}${i}`, i * 2.5, i % 3 ? `note ${i}` : null);
      const o = db.prepare("INSERT INTO orders VALUES(?,?,?,?,?)");
      db.exec("BEGIN");
      for (let i = 1; i <= nOrders; i++)
        o.run(i, (i % 40) + 1, i * 1.125, String(i % 1000).padStart(6, "0"), 2n ** 53n + BigInt(2 * i + 1));
      db.exec("COMMIT");
      const g = db.prepare("INSERT INTO tags VALUES(?,?)");
      for (let i = 0; i < 7; i++) g.run(`tag-${t}-${i}`, i % 2 ? null : i);
    } finally {
      db.close();
    }
    // Reference: the sqlite3 CLI (exact integers as text, NULL as null).
    const q = (sql) => JSON.parse(cli("sqlite3", ["-readonly", "-json", join(dir, name), sql]).toString() || "[]");
    const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((x) => x.name);
    const ref = { tables: [] };
    for (const table of tables) {
      const count = q(`SELECT count(*) AS n FROM "${table}"`)[0].n;
      const cols = q(`SELECT name FROM pragma_table_info('${table}')`).map((x) => x.name);
      const text = (i) =>
        q(`SELECT ${cols.map((c) => `quote("${c}") AS "${c}"`).join(",")} FROM "${table}" LIMIT 1 OFFSET ${i}`)[0];
      const picks = sampleRows(r, count);
      ref.tables.push({
        name: table,
        total: count,
        header: cols,
        rows: picks.map((i) => {
          const row = text(i);
          return {
            index: i,
            cells: cols.map((c) => (row[c] === "NULL" ? null : String(row[c]).replace(/^'(.*)'$/s, "$1").replaceAll("''", "'"))),
          };
        }),
      });
    }
    return [{ id: "sqlite.tables", family: "sqlite", path: name, kind: "sqlite", ref }];
  },

  async markdown(dir, r) {
    const MD = lib("markdown-it"),
      t = r.tok(4),
      name = `notes-${t}.md`;
    mkdirSync(join(dir, `img-${t}`), { recursive: true });
    const [c1, c2] = colours(r, 2);
    const iw = 120 + r.int(0, 40),
      ih = 60 + r.int(0, 20);
    writeFileSync(join(dir, `img-${t}`, "chart.png"), png(iw, ih, (x) => (x < iw / 2 ? c1 : c2)));
    const rows = Array.from({ length: 4 }, (_, i) => [`${r.pick(WORDS)}${t}${i}`, String(r.int(10, 99)), r.pick(WORDS)]);
    const tasks = Array.from({ length: 5 }, (_, i) => ({ done: r.next() < 0.5, text: `task ${r.pick(WORDS)} ${i}` }));
    const code = `const answer${t} = ${r.int(10, 99)};\nconsole.log(answer${t} * 2);`;
    const src = [
      `# Field notes ${t}`,
      "",
      `Some *emphasis*, **strong text** and \`inline${t}\` code.`,
      "",
      "| name | count | colour |",
      "|:-----|------:|--------|",
      ...rows.map((x) => `| ${x.join(" | ")} |`),
      "",
      ...tasks.map((x) => `- [${x.done ? "x" : " "}] ${x.text}`),
      "",
      "```js",
      code,
      "```",
      "",
      `![chart ${t}](img-${t}/chart.png)`,
      "",
    ].join("\n");
    writeFileSync(join(dir, name), src);
    // Reference: markdown-it tokens (tables, fences, images). GFM task items are not in
    // CommonMark core; they are derived from the list items markdown-it found.
    const md = new MD(),
      tokens = md.parse(readFileSync(join(dir, name), "utf8"), {});
    const cells = [],
      images = [],
      items = [];
    let fence = null;
    for (let i = 0; i < tokens.length; i++) {
      const k = tokens[i];
      if ((k.type === "th_open" || k.type === "td_open") && tokens[i + 1]?.type === "inline") cells.push(tokens[i + 1].content);
      if (k.type === "fence") fence = k.content.replace(/\n$/, "");
      if (k.type === "inline") {
        for (const c of k.children || []) if (c.type === "image") images.push({ src: c.attrGet("src"), alt: c.content });
        if (tokens[i - 2]?.type === "list_item_open") {
          const m = /^\[([ xX])\]\s+(.*)$/.exec(k.content);
          if (m) items.push({ done: m[1] !== " ", text: m[2] });
        }
      }
    }
    return [
      {
        id: "md.gfm",
        family: "markdown",
        path: name,
        kind: "md",
        ref: { cells, tasks: items, code: fence, images, imageSize: [iw, ih], colours: [hex(c1), hex(c2)] },
      },
    ];
  },

  async vegalite(dir, r) {
    const vl = await esm("vega-lite"),
      vega = await esm("vega"),
      t = r.tok(4),
      cases = [];
    const cats = ["north", "south", "east", "west", "inland"].slice(0, 4 + r.int(0, 1));
    const series = ["alpha", "beta", "gamma"];
    const specs = {
      layered: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values: Array.from({ length: 10 + r.int(0, 4) }, (_, i) => ({ step: i, level: r.int(5, 95) })) },
        layer: [
          { mark: "line", encoding: { x: { field: "step", type: "quantitative" }, y: { field: "level", type: "quantitative" } } },
          { mark: "point", encoding: { x: { field: "step", type: "quantitative" }, y: { field: "level", type: "quantitative" } } },
        ],
      },
      stacked: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values: cats.flatMap((c) => series.map((s) => ({ region: c, series: s, amount: r.int(3, 40) }))) },
        mark: "bar",
        encoding: {
          x: { field: "region", type: "nominal" },
          y: { field: "amount", type: "quantitative", aggregate: "sum" },
          color: { field: "series", type: "nominal" },
        },
      },
      faceted: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        // Panels differ in scale (x1, x2, x3...), so a viewer that gives each panel its own y
        // scale (vega-lite shares one by default) draws visibly wrong heights.
        data: { values: series.flatMap((s, k) => cats.map((c) => ({ panel: s, region: c, amount: r.int(3, 40) * (k + 1) }))) },
        facet: { column: { field: "panel", type: "nominal" } },
        spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "amount", type: "quantitative" } } },
      },
    };
    for (const [k, spec] of Object.entries(specs)) {
      const name = `${k}-${t}.vl.json`;
      writeFileSync(join(dir, name), JSON.stringify(spec, null, 1));
      // Reference: vega-lite → vega → scenegraph (renderer none): the marks and their geometry.
      const view = new vega.View(vega.parse(vl.compile(JSON.parse(readFileSync(join(dir, name), "utf8"))).spec), { renderer: "none" });
      await view.runAsync();
      const marks = { rect: [], symbol: 0, symbols: [], line: 0, cells: 0 };
      const rec = (node, ox = 0, oy = 0, inCell = false) => {
        if (node.marktype) {
          if (node.marktype === "group" && node.role === "cell") marks.cells += node.items.length;
          if (node.role === "mark" && node.marktype === "line") marks.line += node.items.length ? 1 : 0;
          for (const it of node.items) {
            if (node.role === "mark" && node.marktype === "rect")
              marks.rect.push({ x: ox + it.x, y: oy + Math.min(it.y, it.y2 ?? it.y + it.height), w: it.width ?? 0, h: Math.abs((it.y2 ?? it.y + it.height) - it.y) });
            if (node.role === "mark" && node.marktype === "symbol") marks.symbol++, marks.symbols.push({ x: ox + it.x, y: oy + it.y });
            if (it.items) for (const c of it.items) rec(c, ox + (it.x || 0), oy + (it.y || 0), inCell || node.role === "cell");
          }
        } else if (node.items) for (const c of node.items) rec(c, ox, oy, inCell);
      };
      rec(view.scenegraph().root);
      view.finalize();
      cases.push({ id: `vegalite.${k}`, family: "vegalite", path: name, kind: "vega-lite", ref: { spec: k, ...marks } });
    }
    return cases;
  },

  async gltf(dir, r) {
    const t = r.tok(4);
    const [red, green] = [
      [225, 30, 30],
      [30, 200, 60],
    ];
    const tex = [
      [40, 70, 240],
      [250, 210, 30],
    ];
    // Geometry: a unit cube (24 vertices) and a quad with UVs.
    const P = [],
      N = [],
      I = [];
    const faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    for (const [n, u, v] of faces) {
      const b = P.length / 3;
      for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        P.push(...[0, 1, 2].map((k) => 0.5 * (n[k] + a * u[k] + c * v[k])));
        N.push(...n);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const QP = [-1, -0.6, 0, 1, -0.6, 0, 1, 0.6, 0, -1, 0.6, 0],
      QT = [0, 1, 1, 1, 1, 0, 0, 0],
      QI = [0, 1, 2, 0, 2, 3];
    const parts = [new Float32Array(P), new Float32Array(N), new Uint16Array(I), new Float32Array(QP), new Float32Array(QT), new Uint16Array(QI)];
    const views = [],
      chunks = [];
    let len = 0;
    for (const a of parts) {
      const b = Buffer.from(a.buffer);
      views.push({ buffer: 0, byteOffset: len, byteLength: b.length });
      chunks.push(b, Buffer.alloc((4 - (b.length % 4)) % 4));
      len += b.length + ((4 - (b.length % 4)) % 4);
    }
    const texPng = png(8, 8, (x, y) => ((x >> 1) + (y >> 1)) % 2 ? tex[0] : tex[1]);
    const bin = Buffer.concat(chunks);
    const acc = (view, type, count, comp, mm) => ({ bufferView: view, componentType: comp, count, type, ...(mm || {}) });
    const doc = (embed) => {
      const g = {
        asset: { version: "2.0", generator: "napkin fidelity bench" },
        extensionsUsed: ["KHR_materials_unlit"],
        scene: 0,
        scenes: [{ nodes: [0, 1, 2, 3, 4] }],
        nodes: [
          { mesh: 0, translation: [0, -2.4, 0], name: "red-a" },
          { mesh: 0, translation: [0, 0, 0], name: "red-b" },
          { mesh: 0, translation: [0, 2.4, 0], name: "red-c" },
          { mesh: 1, translation: [0, -5.6, 0], scale: [1.7, 1.7, 1.7], name: "green-big" },
          { mesh: 2, translation: [0, 5.4, 0], scale: [1.4, 1.4, 1.4], name: "textured" },
        ],
        meshes: [
          { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] },
          { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 1 }] },
          { primitives: [{ attributes: { POSITION: 3, TEXCOORD_0: 4 }, indices: 5, material: 2 }] },
        ],
        materials: [
          { pbrMetallicRoughness: { baseColorFactor: [...red.map((c) => (c / 255) ** 2.2), 1], metallicFactor: 0 }, doubleSided: true, extensions: { KHR_materials_unlit: {} } },
          { pbrMetallicRoughness: { baseColorFactor: [...green.map((c) => (c / 255) ** 2.2), 1], metallicFactor: 0 }, doubleSided: true, extensions: { KHR_materials_unlit: {} } },
          { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 }, doubleSided: true, extensions: { KHR_materials_unlit: {} } },
        ],
        textures: [{ source: 0, sampler: 0 }],
        samplers: [{ magFilter: 9728, minFilter: 9728 }],
        accessors: [
          acc(0, "VEC3", 24, 5126, { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }),
          acc(1, "VEC3", 24, 5126),
          acc(2, "SCALAR", 36, 5123),
          acc(3, "VEC3", 4, 5126, { min: [-1, -0.6, 0], max: [1, 0.6, 0] }),
          acc(4, "VEC2", 4, 5126),
          acc(5, "SCALAR", 6, 5123),
        ],
        bufferViews: views.map((v) => ({ ...v })),
        buffers: [{ byteLength: bin.length }],
      };
      if (embed) {
        g.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: texPng.length });
        g.buffers[0].byteLength = bin.length + texPng.length + ((4 - (texPng.length % 4)) % 4);
        g.images = [{ bufferView: g.bufferViews.length - 1, mimeType: "image/png" }];
      } else {
        g.buffers[0].uri = `scene-${t}.bin`;
        g.images = [{ uri: `tex-${t}/check.png` }];
      }
      return g;
    };
    writeFileSync(join(dir, `scene-${t}.bin`), bin);
    mkdirSync(join(dir, `tex-${t}`), { recursive: true });
    writeFileSync(join(dir, `tex-${t}`, "check.png"), texPng);
    writeFileSync(join(dir, `scene-${t}.gltf`), JSON.stringify(doc(false)));
    {
      const json = Buffer.from(JSON.stringify(doc(true)));
      const jpad = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
      const body = Buffer.concat([bin, texPng, Buffer.alloc((4 - (texPng.length % 4)) % 4)]);
      const h = Buffer.alloc(12),
        jh = Buffer.alloc(8),
        bh = Buffer.alloc(8);
      h.write("glTF", 0);
      h.writeUInt32LE(2, 4);
      h.writeUInt32LE(12 + 8 + jpad.length + 8 + body.length, 8);
      jh.writeUInt32LE(jpad.length, 0);
      jh.write("JSON", 4);
      bh.writeUInt32LE(body.length, 0);
      bh.write("BIN\0", 4);
      writeFileSync(join(dir, `scene-${t}.glb`), Buffer.concat([h, jh, jpad, bh, body]));
    }
    // Reference: what the file states (validated by re-reading it): three instances of the red
    // mesh stacked on the vertical axis 2.4 apart, a green cube scaled 1.7, a textured quad.
    const back = JSON.parse(readFileSync(join(dir, `scene-${t}.gltf`), "utf8"));
    const reds = back.nodes.filter((n) => n.mesh === 0).map((n) => n.translation[1]);
    const ref = { reds: reds.length, redSpacing: reds[1] - reds[0], greenScale: back.nodes[3].scale[0], colours: { red, green, tex } };
    return [
      { id: "gltf.external", family: "gltf", path: `scene-${t}.gltf`, kind: "gltf", ref },
      { id: "glb.embedded", family: "gltf", path: `scene-${t}.glb`, kind: "glb", ref },
    ];
  },

  async lottie(dir, r) {
    const t = r.tok(4),
      [c1, c2, c3] = colours(r, 3);
    mkdirSync(join(dir, `anim-${t}`, "images"), { recursive: true });
    writeFileSync(join(dir, `anim-${t}`, "images", "swatch.png"), png(100, 100, () => c2));
    const k = (v) => ({ a: 0, k: v });
    const ks = (x, y) => ({ o: k(100), r: k(0), p: k([x, y, 0]), a: k([0, 0, 0]), s: k([100, 100, 100]) });
    const fill = (c) => ({ ty: "fl", c: k([...c.map((v) => v / 255), 1]), o: k(100), r: 1 });
    const tr = { ty: "tr", p: k([0, 0]), a: k([0, 0]), s: k([100, 100]), r: k(0), o: k(100) };
    const anim = {
      v: "5.7.4",
      fr: 30,
      ip: 0,
      op: 60,
      w: 480,
      h: 360,
      nm: `fidelity ${t}`,
      ddd: 0,
      assets: [
        { id: "img_0", w: 100, h: 100, u: "images/", p: "swatch.png", e: 0 },
        {
          id: "comp_inner",
          layers: [
            { ddd: 0, ind: 1, ty: 4, nm: "inner box", sr: 1, ks: ks(60, 60), ao: 0, ip: 0, op: 60, st: 0, bm: 0, shapes: [{ ty: "gr", it: [{ ty: "rc", d: 1, p: k([0, 0]), s: k([110, 110]), r: k(8) }, fill(c1), tr] }] },
          ],
        },
        {
          id: "comp_outer",
          layers: [{ ddd: 0, ind: 1, ty: 0, nm: "inner precomp", refId: "comp_inner", sr: 1, ks: ks(10, 10), ao: 0, w: 200, h: 200, ip: 0, op: 60, st: 0, bm: 0 }],
        },
      ],
      layers: [
        { ddd: 0, ind: 1, ty: 0, nm: "outer precomp", refId: "comp_outer", sr: 1, ks: ks(20, 40), ao: 0, w: 220, h: 220, ip: 0, op: 60, st: 0, bm: 0 },
        { ddd: 0, ind: 2, ty: 2, nm: "image", refId: "img_0", sr: 1, ks: ks(220, 60), ao: 0, ip: 0, op: 60, st: 0, bm: 0 },
        // No "st" and no "bm": optional per the format; the ellipse must still draw.
        { ddd: 0, ind: 3, ty: 4, nm: "loose ellipse", sr: 1, ks: ks(380, 260), ao: 0, ip: 0, op: 60, shapes: [{ ty: "gr", it: [{ ty: "el", d: 1, p: k([0, 0]), s: k([120, 120]) }, fill(c3), tr] }] },
      ],
    };
    const name = `anim-${t}/scene.lottie.json`;
    writeFileSync(join(dir, name), JSON.stringify(anim));
    return [
      {
        id: "lottie.nested",
        family: "lottie",
        path: name,
        kind: "lottie",
        ref: { colours: [hex(c1), hex(c2), hex(c3)], names: ["nested precomp", "relative image asset", "layer without st"], data: anim, asset: readFileSync(join(dir, `anim-${t}`, "images", "swatch.png")).toString("base64") },
      },
    ];
  },

  async pdf(dir, r) {
    const t = r.tok(4),
      n = 3 + r.int(0, 2),
      cs = colours(r, n + 1);
    const pages = Array.from({ length: n }, (_, i) => ({
      bg: cs[i].map((v) => Math.round(255 - (255 - v) * 0.35)),
      block: cs[i],
      text: `Page ${i + 1} ${t.toUpperCase()}`,
    }));
    const name = `pages-${t}.pdf`;
    writeFileSync(join(dir, name), pdf(pages));
    // Reference: pdfinfo page count; pdftocairo rasterises each page; the block colour of each
    // page is read from the reference raster, not from the generator.
    const info = cli("pdfinfo", [join(dir, name)]).toString();
    const count = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    const out = join(dir, `.ref-${t}`);
    mkdirSync(out);
    cli("pdftocairo", ["-png", "-r", "18", join(dir, name), join(out, "p")]);
    const { decodePng } = await import("../p0-lib.js");
    const { readdirSync, rmSync } = await import("node:fs");
    const blocks = readdirSync(out)
      .sort()
      .map((f) => {
        const p = decodePng(readFileSync(join(out, f)));
        const at = (fx, fy) => {
          const i = (Math.floor(fy * p.height) * p.width + Math.floor(fx * p.width)) * 4;
          return [p.data[i], p.data[i + 1], p.data[i + 2]];
        };
        return { block: hex(at(0.5, 0.4)), bg: hex(at(0.04, 0.96)) };
      });
    rmSync(out, { recursive: true, force: true });
    return [{ id: "pdf.pages", family: "pdf", path: name, kind: "pdf", ref: { pages: count, blocks, texts: pages.map((p) => p.text) } }];
  },

  async audio(dir, r) {
    const t = r.tok(4),
      rate = 22050,
      seconds = 4,
      segs = 16;
    const levels = Array.from({ length: segs }, () => r.pick([0.04, 0.25, 0.5, 0.95]));
    levels[r.int(0, 3)] = 0.04;
    levels[r.int(8, 15)] = 0.95;
    const samples = new Int16Array(rate * seconds);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.floor((i / samples.length) * segs);
      samples[i] = Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * levels[s] * 32000);
    }
    const wav = Buffer.alloc(44 + samples.length * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + samples.length * 2, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples.length * 2, 40);
    Buffer.from(samples.buffer).copy(wav, 44);
    const cases = [];
    writeFileSync(join(dir, `tone-${t}.wav`), wav);
    for (const [ext, args] of [
      ["mp3", ["-c:a", "libmp3lame", "-b:a", "96k"]],
      ["flac", ["-c:a", "flac"]],
      ["ogg", ["-c:a", "libvorbis", "-q:a", "3"]],
    ])
      cli("ffmpeg", ["-v", "error", "-y", "-i", join(dir, `tone-${t}.wav`), ...args, join(dir, `tone-${t}.${ext}`)]);
    for (const ext of ["wav", "mp3", "flac", "ogg"]) {
      // Reference: ffmpeg decodes the written file; peak per sixteenth of the duration.
      const pcm = cli("ffmpeg", ["-v", "error", "-i", join(dir, `tone-${t}.${ext}`), "-f", "s16le", "-ac", "1", "-ar", "8000", "-"]);
      const a = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
      const duration = Number(cli("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, `tone-${t}.${ext}`)]).toString().trim());
      const env = Array.from({ length: segs }, (_, s) => {
        let m = 0;
        const lo = Math.floor(((s + 0.2) / segs) * a.length),
          hi = Math.floor(((s + 0.8) / segs) * a.length);
        for (let i = lo; i < hi; i++) m = Math.max(m, Math.abs(a[i]));
        return m / 32768;
      });
      cases.push({ id: `audio.${ext}`, family: "audio", path: `tone-${t}.${ext}`, kind: ext, ref: { envelope: env, duration } });
    }
    return cases;
  },

  async video(dir, r) {
    const t = r.tok(4),
      cs = colours(r, 4),
      cases = [];
    const filter = cs.map((c, i) => `color=c=${hex(c).replace("#", "0x")}:s=320x240:d=1:r=25[v${i}]`).join(";") + ";" + cs.map((_, i) => `[v${i}]`).join("") + `concat=n=${cs.length}:v=1:a=0[out]`;
    for (const [ext, args] of [
      ["mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]],
      ["webm", ["-c:v", "libvpx-vp9", "-b:v", "200k", "-deadline", "realtime"]],
    ]) {
      const name = `clips-${t}.${ext}`;
      cli("ffmpeg", ["-v", "error", "-y", "-filter_complex", filter, "-map", "[out]", ...args, join(dir, name)]);
      // Reference: ffmpeg extracts the frame at each time; centre pixel.
      const times = [0.5, 1.5, 2.5, 3.5].map((x) => x + (r.next() - 0.5) * 0.3);
      const frames = times.map((tt) => {
        const px = cli("ffmpeg", ["-v", "error", "-ss", String(tt), "-i", join(dir, name), "-frames:v", "1", "-vf", "crop=8:8:156:116,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        return { t: tt, rgb: [px[0], px[1], px[2]] };
      });
      const duration = Number(cli("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, name)]).toString().trim());
      cases.push({ id: `video.${ext}`, family: "video", path: name, kind: ext, ref: { frames, duration } });
    }
    return cases;
  },

  async fonts(dir, r) {
    const ot = lib("opentype.js"),
      t = r.tok(4),
      cases = [];
    // Static font made with opentype.js; coverage is a seeded set including non-ASCII glyphs.
    const pool = [..."ABCDEFGHJKLMNPRSTUVWXYZabdeghkmnqrstuvwxyz0123456789", ..."ßÆØÅéñ", ..."ΩΣΔλπ", ..."ЖЯДфщ", "€", "№"];
    const chosen = [...new Set(Array.from({ length: 28 }, () => r.pick(pool)))];
    const glyphs = [new ot.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 600, path: new ot.Path() })];
    for (const ch of chosen) {
      const p = new ot.Path(),
        w = 420 + r.int(0, 300);
      p.moveTo(60, 0);
      p.lineTo(w - 60, 0);
      p.lineTo(w - 60, 700);
      p.lineTo(60, 700);
      p.close();
      p.moveTo(140, 120);
      p.lineTo(140, 580);
      p.lineTo(w - 140, 580);
      p.lineTo(w - 140, 120);
      p.close();
      glyphs.push(new ot.Glyph({ name: "u" + ch.codePointAt(0).toString(16), unicode: ch.codePointAt(0), advanceWidth: w, path: p }));
    }
    const family = `Fidelity${t}`;
    const font = new ot.Font({ familyName: family, styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
    writeFileSync(join(dir, `coverage-${t}.otf`), Buffer.from(font.toArrayBuffer()));
    {
      const back = ot.parse(Uint8Array.from(readFileSync(join(dir, `coverage-${t}.otf`))).buffer);
      const chars = Object.keys(back.tables.cmap.glyphIndexMap).map(Number).filter((c) => c > 32).map((c) => String.fromCodePoint(c));
      cases.push({ id: "font.coverage", family: "fonts", path: `coverage-${t}.otf`, kind: "otf", ref: { glyphs: back.numGlyphs, chars, family } });
    }
    // Variable font: no free writer can make one at bench time, so an installed variable font is
    // copied in. Reference: the fvar table read from the bytes, cross-checked with fc-scan.
    const list = cli("fc-list", [":variable=True", "file"]).toString().split("\n").map((x) => x.replace(/:\s*$/, "").trim()).filter((x) => /\.(ttf|otf)$/i.test(x)).sort();
    if (!list.length) throw Error("reference missing: no installed variable TTF/OTF (fc-list :variable=True) to copy into the bench folder");
    const src = list[0];
    copyFileSync(src, join(dir, `axes-${t}.ttf`));
    const buf = readFileSync(join(dir, `axes-${t}.ttf`));
    const n = buf.readUInt16BE(4);
    let fvar = -1;
    for (let i = 0; i < n; i++) if (buf.toString("latin1", 12 + i * 16, 16 + i * 16) === "fvar") fvar = buf.readUInt32BE(12 + i * 16 + 8);
    if (fvar < 0) throw Error("variable font has no fvar table: " + src);
    const axesOff = fvar + buf.readUInt16BE(fvar + 4),
      count = buf.readUInt16BE(fvar + 8),
      size = buf.readUInt16BE(fvar + 10);
    const fx = (o) => buf.readInt32BE(o) / 65536;
    const axes = Array.from({ length: count }, (_, i) => {
      const o = axesOff + i * size;
      return { tag: buf.toString("latin1", o, o + 4), min: fx(o + 4), def: fx(o + 8), max: fx(o + 12) };
    });
    const scan = cli("fc-scan", ["--format", "%{variable}", join(dir, `axes-${t}.ttf`)]).toString();
    if (!/True/i.test(scan)) throw Error("fc-scan does not see a variable font in " + src);
    cases.push({ id: "font.axes", family: "fonts", path: `axes-${t}.ttf`, kind: "ttf", ref: { axes } });
    return cases;
  },

  async zip(dir, r) {
    const t = r.tok(4),
      name = `bundle-${t}.zip`;
    const deep = `deep-${t}-${r.tok(4)}`,
      tail = `tail-${t}-${r.tok(4)}`;
    const bigSize = 18 * 1024 * 1024 + r.int(0, 1024 * 1024);
    const big = Buffer.alloc(bigSize);
    for (let i = 0; i < bigSize; i += 4096) big.write(`block ${i} ${t}\n`, i);
    const entries = [
      ["src/", null],
      ["src/app/", null],
      ["src/app/core/", null],
      [`src/app/core/${deep}.txt`, Buffer.from(`The deepest file says ${deep} inside.\n`), true],
      ["docs/", null],
      ["docs/readme.md", Buffer.from(`# Bundle ${t}\n\nNested folders and a large entry.\n`), true],
      ["media/", null],
      ["media/large.bin", big, false],
      [`media/${tail}.txt`, Buffer.from(`After the large entry: ${tail}.\n`), true],
    ];
    writeFileSync(join(dir, name), zip(entries));
    // Reference: unzip lists entries and sizes and extracts contents.
    const listing = cli("unzip", ["-Z", "-l", join(dir, name)]).toString();
    const files = [];
    for (const line of listing.split("\n")) {
      const m = /^[-d]\S+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(line.trim());
      if (m) files.push({ path: m[2], size: Number(m[1]) });
    }
    const content = (p) => cli("unzip", ["-p", join(dir, name), p]).toString();
    return [
      {
        id: "zip.nested",
        family: "zip",
        path: name,
        kind: "zip",
        ref: {
          files,
          deep: { path: `src/app/core/${deep}.txt`, text: content(`src/app/core/${deep}.txt`).trim() },
          tail: { path: `media/${tail}.txt`, text: content(`media/${tail}.txt`).trim() },
          large: files.find((f) => f.path === "media/large.bin"),
        },
      },
    ];
  },

  async images(dir, r) {
    const t = r.tok(4),
      [a, b, c] = colours(r, 3),
      cases = [];
    const add = (id, name, kind, ref) => cases.push({ id, family: "images", path: name, kind, ref });
    const probe = (name) => {
      const out = cli("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", join(dir, name)]).toString();
      const s = JSON.parse(out).streams[0];
      return { w: s.width, h: s.height, frames: Number(s.nb_read_frames || 1) };
    };
    {
      const w = 3,
        h = 600 + r.int(0, 400);
      writeFileSync(join(dir, `tall-${t}.png`), png(w, h, (x, y) => (y < h / 2 ? a : b)));
      add("image.tall", `tall-${t}.png`, "png", { ...probe(`tall-${t}.png`), colours: [hex(a), hex(b)] });
    }
    {
      const w = 7,
        h = 5;
      writeFileSync(join(dir, `tiny-${t}.png`), png(w, h, (x, y) => ((x + y) % 2 ? a : c)));
      add("image.tiny", `tiny-${t}.png`, "png", { ...probe(`tiny-${t}.png`), colours: [hex(a), hex(c)] });
    }
    {
      // Transparent pixels carry a loud colour at alpha 0: a viewer that drops alpha shows it.
      writeFileSync(join(dir, `alpha-${t}.png`), png(200, 120, (x) => (x < 100 ? [...a, 255] : [255, 0, 255, 0])));
      add("image.alpha", `alpha-${t}.png`, "png", { ...probe(`alpha-${t}.png`), colours: [hex(a)], hidden: "#ff00ff" });
    }
    {
      const tmp = join(dir, `.frames-${t}`);
      mkdirSync(tmp);
      [a, b, c].forEach((col, i) => writeFileSync(join(tmp, `f${i}.png`), png(160, 100, () => col)));
      for (const [ext, kind, args] of [
        ["gif", "gif", ["-loop", "0"]],
        ["webp", "webp", ["-c:v", "libwebp_anim", "-loop", "0", "-lossless", "1"]],
        ["apng", "apng", ["-f", "apng", "-plays", "0"]],
      ]) {
        const name = `anim-${t}.${ext}`;
        cli("ffmpeg", ["-v", "error", "-y", "-framerate", "3", "-i", join(tmp, "f%d.png"), ...args, join(dir, name)]);
        add(`image.animated-${ext}`, name, kind, { ...probe(name), colours: [hex(a), hex(b), hex(c)], animated: true });
      }
      execFileSync("rm", ["-rf", tmp]);
    }
    return cases;
  },

  async sniff(dir, r, made) {
    // Wrong or missing extensions: the bytes decide. Sources are files other families made.
    const t = r.tok(4),
      cases = [];
    const from = (family, kind) => made.find((m) => m.family === family && m.kind === kind);
    const copies = [
      [from("images", "png"), `photo-${t}`, "png"],
      [from("pdf", "pdf"), `report-${t}.dat`, "pdf"],
      [from("zip", "zip"), `archive-${t}.txt`, "zip"],
      [from("sqlite", "sqlite"), `store-${t}.db`, "sqlite"],
      [from("video", "mp4"), `clip-${t}.bin`, "mp4"],
      [from("audio", "wav"), `sound-${t}`, "wav"],
    ];
    for (const [src, name, kind] of copies) {
      if (!src) throw Error("sniff source missing for " + kind);
      copyFileSync(join(dir, src.path), join(dir, name));
      cases.push({ id: `sniff.${kind}`, family: "sniff", path: name, kind, ref: { source: src.path } });
    }
    writeFileSync(join(dir, `page-${t}.bin`), `<!doctype html><html><head><title>Sniffed ${t}</title></head><body><h1>Sniffed page ${t}</h1><p style="color:#c03030">rendered, not shown as text</p></body></html>`);
    cases.push({ id: "sniff.html", family: "sniff", path: `page-${t}.bin`, kind: "html", ref: { text: `Sniffed page ${t}` } });
    return cases;
  },
};
export { hex };
