import {
  run,
  items,
  request,
  assert,
  observe,
  evidence,
  p95,
  entry,
  output,
  start,
  stress,
  waitUntil,
  sleep,
  frameGesture,
  processRSS,
  FRAME_BUDGET,
  ROOT,
} from "./lib3/runtime.mjs";
import {
  shot,
  colorShare,
  differing,
  dominantColours,
  shareOf,
  rectOf,
  inkExtent,
  scrollEverything,
} from "./lib3/semantic.mjs";
import { randomInt } from "node:crypto";
import { join } from "node:path";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
// Accepted kind names per canonical kind: a small alias table in corpus3/manifest.json for
// specialised kinds whose reasonable names differ (a diff is a patch). Generic kinds are never
// aliases: a viewer that reports txt/json/code for a patch or run log did not specialise.
const ALIASES = JSON.parse(
  readFileSync(new URL("./corpus3/manifest.json", import.meta.url), "utf8"),
).kindAliases || {};
export const kindOk = (canonical, got) =>
  got === canonical || (ALIASES[canonical] || []).includes(got);
// Card content test: a shell with an empty pre/svg or an unloaded frame is a blank card.
export const CARD_CONTENT = `(e=>{const r=e.getBoundingClientRect();const q=e.querySelector('iframe,img,canvas,svg,video,audio,table,pre,article,[role=table],[role=grid],[role=log],[role=tree],ol,ul');if(!q)return false;const t=q.tagName.toLowerCase();if(t==='iframe'){try{const d=q.contentDocument;return !!d&&d.body&&(d.body.innerText.trim().length>0||d.body.children.length>0)}catch{return true}}if(t==='img')return q.complete&&q.naturalWidth>0;if(t==='video')return q.readyState>=1||!!q.poster;if(t==='audio')return !!q.src||!!q.querySelector('source');if(t==='canvas'){try{const c=document.createElement('canvas');c.width=16;c.height=16;c.getContext('2d').drawImage(q,0,0,16,16);const d=c.getContext('2d').getImageData(0,0,16,16).data;let v=new Set();for(let i=0;i<d.length;i+=4)v.add(d[i]+','+d[i+1]+','+d[i+2]+','+d[i+3]);return v.size>1}catch{return true}}if(t==='svg')return q.querySelectorAll('path,rect,circle,ellipse,line,polygon,polyline,text,image,g>*').length>=1;return q.textContent.trim().length>=3})`;
// Per-kind oracles over values the bench chose for this run (see lib3/media.mjs).
async function oracle(b, file, item, r, f, s) {
  const e = file.expect || {},
    first = await shot(b);
  for (const hex of e.colors || []) {
    const share = colorShare(first, hex);
    if (!file.kind.match(/^(gif|apng)$/))
      assert(
        share > 0.002,
        `viewer never shows this file's colour ${hex} (${share})`,
      );
  }
  if (e.animated || ["gif", "apng"].includes(file.kind)) {
    const seen = new Map((e.colors || []).map((c) => [c, 0]));
    const frames = [first];
    for (let n = 0; n < 7; n++) {
      await sleep(240);
      frames.push(await shot(b));
    }
    let moved = 0;
    for (const p of frames.slice(1))
      moved = Math.max(moved, differing(first, p));
    assert(moved > 40, "item is not live: pixels never change over 1.7 s");
    for (const p of frames)
      for (const c of seen.keys())
        seen.set(c, Math.max(seen.get(c), colorShare(p, c)));
    for (const [c, v] of seen)
      assert(v > 0.002, `colour ${c} from the file never shown (${v})`);
  }
  if (e.first) {
    const sampleAt = async (t) =>
      b.eval(
        `(async()=>{const v=document.querySelector('video');v.pause();v.currentTime=${t};await new Promise(r=>{v.onseeked=r;setTimeout(r,2500)});const c=document.createElement('canvas');c.width=8;c.height=8;c.getContext('2d').drawImage(v,0,0,8,8);const d=c.getContext('2d').getImageData(4,4,1,1).data;return[d[0],d[1],d[2]]})()`,
      );
    const near = (px, hex) =>
      [1, 3, 5].every(
        (i, k) => Math.abs(px[k] - parseInt(hex.slice(i, i + 2), 16)) <= 56,
      );
    const d = file.meta.duration;
    const a = await sampleAt(d * 0.25),
      z = await sampleAt(d * 0.75);
    assert(
      near(a, e.first),
      `video frame at 25% is ${a}, file says ${e.first}`,
    );
    assert(
      near(z, e.second),
      `video frame at 75% is ${z}, file says ${e.second}`,
    );
  }
  if (e.ramp !== undefined) {
    const rect = await rectOf(b, 'canvas,svg,[aria-label*="waveform" i]');
    assert(rect, "no waveform element");
    const p = await shot(b),
      early = inkExtent(p, rect, 0.15),
      late = inkExtent(p, rect, 0.85);
    assert(
      early > 0 && late >= early * 1.4,
      `waveform does not follow the file's amplitude ramp (early ${early}px, late ${late}px)`,
    );
  }
  if (file.meta.columns) {
    const k =
      Math.floor(file.meta.rows / 2) +
      randomInt(0, Math.ceil(file.meta.rows / 2));
    const label = ["parquet", "arrow"].includes(file.kind)
      ? String(
          file.kind === "parquet"
            ? (k * 31 + f.seed) % 100003
            : f.seed + k * 31,
        )
      : `orbit-${f.seed}-${k}`;
    let found = r.text.includes(label);
    for (const frac of [k / file.meta.rows, 0.5, 1]) {
      if (found) break;
      await scrollEverything(b, frac);
      found = (await b.eval("document.body.innerText")).includes(label);
    }
    assert(found, `row ${k} (${label}) of this file never shown`);
    const types = await b.eval(
      `[...document.querySelectorAll('th[data-type],[role=columnheader][data-type],[data-column-type]')].map(e=>e.dataset.type||e.dataset.columnType)`,
    );
    assert(
      types.some((t) => /int|num|float/i.test(t)),
      "no numeric column type: " + types,
    );
    if (file.meta.columns >= 4) {
      assert(
        types.some((t) => /str|text/i.test(t)),
        "no string column type",
      );
      assert(
        types.some((t) => /bool/i.test(t)),
        "no boolean column type",
      );
    }
    const drawn = await b.eval(
      `[...document.querySelectorAll('[data-distribution],svg[aria-label*="distribution" i],canvas[aria-label*="distribution" i]')].filter(e=>{const r=e.getBoundingClientRect();if(r.width<12||r.height<6)return false;if(e.tagName==='CANVAS')return true;return e.querySelectorAll('rect,path,circle,line,span,div').length>=2||e.textContent.trim().length>0}).length`,
    );
    assert(
      drawn >= file.meta.columns,
      `only ${drawn} drawn distributions for ${file.meta.columns} columns`,
    );
  }
  if (e.series) {
    const bars = await b.eval(
      `[...document.querySelectorAll('svg')].flatMap(s=>{const sr=s.getBoundingClientRect();return[...s.querySelectorAll('rect')].map(r=>r.getBoundingClientRect()).filter(r=>r.width>1&&r.height>1&&r.width<sr.width*0.5).map(r=>({x:r.x,h:r.height}))}).sort((a,b)=>a.x-b.x)`,
    );
    assert(
      bars.length >= e.series.length,
      `${bars.length} chart marks for ${e.series.length} data points`,
    );
    const hs = bars.slice(-e.series.length).map((x) => x.h),
      mean = (a) => a.reduce((x, y) => x + y, 0) / a.length,
      mh = mean(hs),
      ms = mean(e.series);
    const cov = hs.reduce((n, h, i) => n + (h - mh) * (e.series[i] - ms), 0);
    const sd = Math.sqrt(
      hs.reduce((n, h) => n + (h - mh) ** 2, 0) *
        e.series.reduce((n, v) => n + (v - ms) ** 2, 0),
    );
    assert(
      sd > 0 && cov / sd > 0.97,
      "mark heights do not follow the file's data",
    );
  }
  if (["pdf"].includes(file.kind)) {
    const rect = await rectOf(b, file.markers.selectors[0]);
    assert(rect, "no page element");
    const p = await shot(b);
    let ink = 0,
      light = 0,
      n = 0;
    for (let y = rect.y; y < rect.y + rect.h; y += 2)
      for (let x = rect.x; x < rect.x + rect.w; x += 2) {
        const i = (y * p.width + x) * 4,
          l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
        n++;
        if (l < 110) ink++;
        if (l > 200) light++;
      }
    assert(
      light / n > 0.3 && ink / n > 0.0015,
      `rendered page has no page-and-ink structure (ink ${ink / n}, light ${light / n})`,
    );
  }
  if (["ttf", "otf", "woff2"].includes(file.kind)) {
    // Outcome: some visible text is set in a loaded, non-generic FontFace, and its measured
    // advance width equals what the font file itself says (so no other font stands in), and
    // the specimen paints ink.
    const probe = await b.eval(
      `(()=>{const faces=[...document.fonts].filter(f=>f.status==='loaded'&&!/^(sans|serif|monospace|system-ui)/i.test(f.family)).map(f=>f.family.replace(/^["']|["']$/g,''));if(!faces.length)return{faces};for(const e of document.querySelectorAll('body *')){const own=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();if(own.length<8)continue;const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(r.width<20||r.height<8||s.visibility==='hidden'||s.display==='none'||+s.opacity===0)continue;const fam=s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g,'');if(!faces.includes(fam))continue;e.scrollIntoView({block:'center'});const text=own.slice(0,24),px=parseFloat(s.fontSize);const c=document.createElement('canvas').getContext('2d');c.font=px+'px "'+fam+'"';const q=e.getBoundingClientRect();window.__spec={x:Math.max(0,Math.round(q.x)),y:Math.max(0,Math.round(q.y)),w:Math.round(Math.min(q.right,innerWidth)-Math.max(0,q.x)),h:Math.round(Math.min(q.bottom,innerHeight)-Math.max(0,q.y))};return{faces,fam,text,px,measured:c.measureText(text).width}}return{faces}})()`,
    );
    assert(probe.faces.length, "no FontFace from the file is loaded");
    assert(
      probe.fam,
      "no visible text is set in the loaded font " + probe.faces,
    );
    try {
      const ot = createRequire(
        (process.env.NAPKIN_D3_TOOLS || join(ROOT, "bench/tools")) +
          "/package.json",
      )("opentype.js");
      const font = ot.parse(
        Uint8Array.from(readFileSync(join(f.folder, file.path))).buffer,
      );
      const want = font.getAdvanceWidth(probe.text, probe.px);
      assert(
        want > 0 && Math.abs(probe.measured - want) / want < 0.03,
        `text drawn in "${probe.fam}" measures ${probe.measured}px, the font file says ${want}px`,
      );
    } catch (e) {
      if (/measures/.test(e.message)) throw e;
    }
    await sleep(150);
    const rect = await b.eval("window.__spec"),
      p = await shot(b);
    let ink = 0,
      n = 0;
    const at = (x, y) => (y * p.width + x) * 4,
      bg = at(rect.x, rect.y);
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        n++;
        const i = at(x, y);
        if (
          Math.abs(p.data[i] - p.data[bg]) +
            Math.abs(p.data[i + 1] - p.data[bg + 1]) +
            Math.abs(p.data[i + 2] - p.data[bg + 2]) >
          120
        )
          ink++;
      }
    assert(n > 0 && ink / n > 0.01, "specimen text paints no glyph ink");
  }
  if (["gltf", "glb", "obj"].includes(file.kind)) {
    const rect = await rectOf(b, file.markers.selectors[0]);
    assert(rect, "no model canvas");
    const p0 = await shot(b);
    await sleep(700);
    const p1 = await shot(b);
    assert(
      differing(p0, p1, rect) > 20,
      "model does not turn (canvas static over 700 ms)",
    );
    assert(inkExtent(p1, rect, 0.5) > 8, "no model geometry drawn");
  }
  if (e.entry) {
    const clicked = await b.eval(
      `(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.includes(${JSON.stringify(e.entry.name)}));const t=els[0];if(!t)return null;const r=t.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    assert(clicked, "zip entry not listed");
    for (const type of ["mousePressed", "mouseReleased"])
      await b.send("Input.dispatchMouseEvent", {
        type,
        x: clicked.x,
        y: clicked.y,
        button: "left",
        clickCount: 1,
      });
    await sleep(300);
    assert(
      (await b.eval("document.body.innerText")).includes(e.entry.body),
      "opening a zip entry does not show its contents",
    );
  }
  if (e.head) {
    const t = (await b.eval("document.body.innerText"))
      .toLowerCase()
      .replace(/\s+/g, "");
    assert(t.includes(e.head), "hex view does not show this file's bytes");
  }
}
export async function measure() {
  return run("D1", async ({ book, f, s, browser }) => {
    let listed,
      error,
      rendered = 0;
    const paints = [];
    try {
      listed = await items(s);
    } catch (e) {
      error = e.message;
    }
    for (const file of f.files)
      await book.check(
        `viewer.${file.original}`,
        `kind ${file.kind}, semantic markers, content and pixel variance`,
        async () => {
          assert(!error, error);
          const item = listed.find((i) => i.path === file.path);
          assert(item, `/api/items omits ${file.path}`);
          assert(
            kindOk(file.kind, item.kind),
            `expected kind ${file.kind}, received ${item.kind}`,
          );
          assert(
            item.id &&
              item.mime &&
              item.bytes === statSync(join(f.folder, file.path)).size,
            "id, MIME and exact byte count required",
          );
          const b = await browser(),
            r = await observe(
              b,
              s.base + "/view/" + encodeURIComponent(item.id),
              file.markers,
            );
          assert(kindOk(file.kind, r.kind), `root data-napkin-kind is ${r.kind}`);
          for (const selector of file.markers.selectors)
            assert(
              await b.eval(
                `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'})`,
              ),
              "missing semantic content " + selector,
            );
          for (const text of file.markers.text)
            assert(
              r.text.includes(text),
              "missing file-derived content " + text,
            );
          for (const field of ["rows", "glyphs", "pages", "entries"])
            if (file.meta[field])
              assert(
                new RegExp(`(^|\\D)${file.meta[field]}(\\D|$)`).test(r.text),
                `visible ${field} count ${file.meta[field]} required`,
              );
          if (file.meta.columns) {
            const figures = await b.eval(
              `({typed:document.querySelectorAll('th[data-type],[role=columnheader][data-type],[data-column-type]').length,distributions:document.querySelectorAll('[data-distribution],svg[aria-label*="distribution" i],canvas[aria-label*="distribution" i]').length})`,
            );
            assert(
              figures.typed >= file.meta.columns &&
                figures.distributions >= file.meta.columns,
              "typed headers and distributions required for each column",
            );
          }
          if (["png", "jpg", "webp", "avif"].includes(file.kind)) {
            const reference = readFileSync(join(f.folder, file.path)).toString(
              "base64",
            );
            const pixels = await b.eval(
              `(async()=>{const expected=new Image();expected.src='data:'+${JSON.stringify(item.mime)}+';base64,'+${JSON.stringify(reference)};await expected.decode();const actual=document.querySelector('img,canvas');if(!actual)return null;if(actual instanceof HTMLImageElement)await actual.decode();const get=e=>{const c=document.createElement('canvas');c.width=160;c.height=100;c.getContext('2d').drawImage(e,0,0,160,100);return c.getContext('2d').getImageData(0,0,160,100).data};const a=get(expected),b=get(actual);let bad=0;for(let n=0;n<a.length;n+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(a[n+c]-b[n+c])))>12)bad++;return bad/16000})()`,
            );
            assert(
              pixels !== null && pixels < 0.02,
              "viewer pixels do not show this file (decoded image mismatch " +
                pixels +
                ")",
            );
          }
          if (
            file.meta.duration &&
            ["mp4", "webm", "mov", "wav", "mp3", "flac", "ogg"].includes(
              file.kind,
            )
          ) {
            const duration = await b.eval(
              `document.querySelector('video,audio')?.duration`,
            );
            assert(
              Math.abs(duration - file.meta.duration) < 0.15,
              `decoded duration ${duration}, expected ${file.meta.duration}`,
            );
          }
          await oracle(b, file, item, r, f, s);
          assert(
            r.variance > 20 && r.colors >= 8,
            `blank or generic render (variance ${r.variance}, colors ${r.colors})`,
          );
          assert(
            typeof r.paint === "number",
            "no first-contentful-paint entry",
          );
          paints.push(r.paint);
          rendered++;
          await evidence(b, "D1-" + file.original);
          return {
            ok: true,
            value: {
              kind: item.kind,
              paint: r.paint,
              variance: r.variance,
              colors: r.colors,
            },
          };
        },
        ["dream"],
      );
    await book.check(
      "coverage.beat",
      "25 kinds render",
      () => ({
        ok:
          new Set(
            f.files
              .filter(
                (x) =>
                  book.rows.find((r) => r.id === "viewer." + x.original)?.ok,
              )
              .map((x) => x.kind),
          ).size >= 25,
        value: rendered,
      }),
      ["beat"],
    );
    await book.check(
      "paint.p95",
      "all corpus items measured; first paint p95 < 150 ms",
      () => ({
        ok: paints.length === f.files.length && p95(paints) < 150,
        value: { samples: paints.length, p95: p95(paints) },
      }),
    );
    // Do not allocate multi-GB inputs until discovery works. Gates below still FAIL.
    let workload, ws, wb;
    try {
      assert(!error, error);
      workload = join(f.temp, "mixed");
      await stress(workload, { mixed: true, large: false, seed: f.seed });
      ws = await start(workload, join(f.temp, "mixed-state"));
      wb = await browser();
      const t = performance.now();
      await wb.goto(ws.base + "/");
      await waitUntil(async () => {
        const a = await items(ws);
        return a.length === 1000;
      }, 10000);
      await sleep(300);
      const cards = await wb.eval(
        `(()=>{const cards=[...document.querySelectorAll('[data-item-id]')];return{n:cards.length,blank:cards.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&!${CARD_CONTENT}(e)}).length}})()`,
      );
      const openMs = ws.ms + performance.now() - t;
      // Content oracle on visible cards: a card must show something FROM the file, not only its
      // name. For plain-text kinds the bench reads each visible file and requires a distinctive
      // word from its body (not part of its path) in the card's rendered text.
      const textKinds = new Set(["md", "txt", "csv", "tsv", "json", "jsonl", "code", "diff", "patch", "css", "tsx", "jsx", "html"]);
      const allItems = await items(ws);
      const visibleCards = await wb.eval(
        `JSON.stringify([...document.querySelectorAll('[data-item-id]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight}).map(e=>{let t=e.innerText||'';for(const f of e.querySelectorAll('iframe'))try{t+=' '+f.contentDocument.body.innerText}catch{}t+=' '+[...e.querySelectorAll('pre,table,article,ul,ol,[role=table],[role=grid],[role=log]')].map(x=>x.textContent).join(' ');return[e.dataset.itemId,t]}))`,
      );
      const byId = new Map(allItems.map((x) => [x.id, x]));
      let judged = 0, matched = 0;
      for (const [id, text] of JSON.parse(visibleCards)) {
        const it = byId.get(id);
        if (!it || !textKinds.has(it.kind)) continue;
        let body = "";
        try { body = readFileSync(join(workload, it.path), "utf8"); } catch { continue; }
        const words = [...new Set(body.match(/[A-Za-z][A-Za-z0-9_-]{5,}/g) || [])].filter((w) => !it.path.toLowerCase().includes(w.toLowerCase()));
        if (!words.length) continue;
        judged++;
        if (words.slice(0, 40).some((w) => text.includes(w))) matched++;
      }
      cards.judged = judged;
      cards.matched = matched;
      // Pixel oracle for every other kind: the colours that dominate the item's own /view render
      // must also appear in its canvas card. A card of "xxx" in a <pre> does not show them.
      const nonText = JSON.parse(
        await wb.eval(
          `JSON.stringify([...document.querySelectorAll('[data-item-id]')].map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.itemId,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),vis:r.width>20&&r.height>20&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}}).filter(r=>r.vis))`,
        ),
      ).filter((r) => byId.has(r.id) && !textKinds.has(byId.get(r.id).kind));
      const canvasShot = await shot(wb);
      let pjudged = 0, pmatched = 0;
      for (const r of nonText.slice(0, 10)) {
        await observe(wb, ws.base + "/view/" + encodeURIComponent(r.id));
        await sleep(250);
        const want = dominantColours(await shot(wb));
        if (want.length < 2) continue;
        pjudged++;
        const found = want.filter((c) => shareOf(canvasShot, r, c) >= 0.005).length;
        if (found >= Math.ceil(want.length / 2)) pmatched++;
      }
      await wb.goto(ws.base + "/");
      await sleep(500);
      cards.pixelJudged = pjudged;
      cards.pixelMatched = pmatched;
      await book.check(
        "mixed.open",
        "1000 items; complete visible cards (real content from the file, not just the name) < 2 s from CLI start",
        () => ({
          ok:
            openMs < 2000 &&
            cards.n > 0 &&
            cards.blank === 0 &&
            cards.judged >= 3 &&
            cards.matched >= Math.ceil(cards.judged * 0.8) &&
            cards.pixelJudged >= 3 &&
            cards.pixelMatched >= Math.ceil(cards.pixelJudged * 0.8),
          value: { ms: openMs, cards },
        }),
      );
      await book.check(
        "mixed.sample",
        "12 random items across the folder open alone with the right kind, real content, non-blank",
        async () => {
          const all = await items(ws);
          const pick = Array.from(
            { length: 12 },
            () => all[randomInt(0, all.length)],
          );
          const bad = [];
          for (const it of pick) {
            const r = await observe(
              wb,
              ws.base + "/view/" + encodeURIComponent(it.id),
            );
            if (r.kind !== it.kind || r.variance <= 20 || r.colors < 8)
              bad.push({
                path: it.path,
                kind: it.kind,
                shown: r.kind,
                variance: r.variance,
              });
          }
          return { ok: !bad.length, value: { sampled: pick.length, bad } };
        },
      );
      for (const mode of ["pan", "zoom"])
        await book.check(
          "mixed." + mode,
          "p95 frame < 16.7 ms; no blank cards after 300 ms",
          async () => {
            const samples = await frameGesture(wb, mode);
            await sleep(300);
            const visible = await wb.eval(
              `(()=>{const a=[...document.querySelectorAll('[data-item-id]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight});return{n:a.length,blank:a.filter(e=>!${CARD_CONTENT}(e)).length}})()`,
            );
            return {
              ok:
                samples.length >= 30 &&
                p95(samples) < FRAME_BUDGET &&
                visible.n > 0 &&
                !visible.blank,
              value: { p95: p95(samples), samples: samples.length, visible },
            };
          },
        );
    } catch (e) {
      for (const id of [
        "mixed.open",
        "mixed.sample",
        "mixed.pan",
        "mixed.zoom",
      ])
        if (!book.rows.some((r) => r.id === id))
          await book.fail(
            id,
            "1000 items; < 2 s open; frames < 16.7 ms; no blanks",
            e.message,
          );
    } finally {
      await ws?.stop();
    }
    let large;
    try {
      assert(!error, error);
      large = join(f.temp, "large");
      await stress(large, { mixed: false, large: true, seed: f.seed });
    } catch (e) {
      for (const id of ["large.video", "large.parquet"])
        await book.fail(
          id,
          "opens without reading whole file into memory",
          e.message,
        );
      return;
    }
    for (const [name, kind] of [
      ["large.mov", "mov"],
      ["large.parquet", "parquet"],
    ])
      await book.check(
        "large." + (kind === "mov" ? "video" : "parquet"),
        "real content, exact metadata; peak RSS increase < 60% of file bytes",
        async () => {
          const empty = join(f.temp, "memory-empty-" + kind);
          mkdirSync(empty);
          const calibration = await start(
            empty,
            join(f.temp, "calibration-state-" + kind),
          );
          let baseline;
          try {
            await sleep(100);
            baseline = calibration.rss();
          } finally {
            await calibration.stop();
          }
          const b = await browser();
          await b.goto("about:blank");
          await b.send("HeapProfiler.collectGarbage");
          const heapBytes = async () => {
            const h = await b.send("Runtime.getHeapUsage");
            return (
              h.usedSize +
              (h.backingStorageSize || 0) +
              (h.embedderHeapUsedSize || 0)
            );
          };
          const browserBaseline = await heapBytes();
          const browserProc = b.pid ? processRSS(b.pid) : 0;
          let browserPeak = browserBaseline,
            sampling = false,
            sampleError;
          const server = await start(
            large,
            join(f.temp, "large-state-" + kind),
          );
          let monitor;
          try {
            monitor = setInterval(async () => {
              if (sampling) return;
              sampling = true;
              try {
                browserPeak = Math.max(browserPeak, await heapBytes());
              } catch (e) {
                sampleError = e;
              } finally {
                sampling = false;
              }
            }, 10);
            const item = (await items(server)).find((x) => x.path === name);
            assert(
              item?.kind === kind,
              "large item not listed with correct kind",
            );
            const r = await observe(
              b,
              server.base + "/view/" + encodeURIComponent(item.id),
            );
            await sleep(500);
            assert(!sampleError, sampleError?.message);
            let seekMs;
            if (kind === "mov") {
              const target = 0.2 + randomInt(0, 70) / 100;
              seekMs = await b.eval(
                `(async()=>{const v=document.querySelector('video');const d=v.duration;const t=performance.now();v.currentTime=d*${target};await new Promise(r=>{v.onseeked=r;setTimeout(r,4000)});return Math.abs(v.currentTime-d*${target})<d*0.02&&v.readyState>=2?performance.now()-t:Infinity})()`,
              );
              assert(
                seekMs < 3000,
                "distant seek in the 2 GB video failed or took " +
                  seekMs +
                  " ms",
              );
            } else {
              const frac = 0.3 + randomInt(0, 60) / 100;
              await scrollEverything(b, frac);
              const txt = await b.eval("document.body.innerText");
              const nums = (txt.match(/\b\d{1,7}\b/g) || []).map(Number);
              assert(
                nums.some(
                  (n) => Math.abs(n - frac * 5_000_000) < 0.12 * 5_000_000,
                ),
                "scrolling to " +
                  frac +
                  " of 5 M rows does not show rows from there",
              );
            }
            assert(r.variance > 20, "large item is blank");
            const bytes = statSync(join(large, name)).size;
            if (kind === "mov")
              assert(
                await b.eval(
                  `document.querySelector('video')?.readyState>=2&&document.querySelector('video')?.duration>1`,
                ),
                "large video did not decode",
              );
            else
              assert(
                /5[,. ]?000[,. ]?000/.test(r.text),
                "5 M row count absent",
              );
            return {
              ok:
                server.peakRSS() - baseline < bytes * 0.6 &&
                browserPeak - browserBaseline < bytes * 0.6 &&
                (!b.pid || processRSS(b.pid) - browserProc < bytes * 0.6),
              value: {
                fileBytes: bytes,
                baseline,
                peak: server.peakRSS(),
                increase: server.peakRSS() - baseline,
                browserBaseline,
                browserPeak,
                browserIncrease: browserPeak - browserBaseline,
                browserProcessIncrease: b.pid
                  ? processRSS(b.pid) - browserProc
                  : null,
              },
            };
          } finally {
            clearInterval(monitor);
            await server.stop();
          }
        },
      );
  });
}
if (entry(import.meta.url)) output(await measure());
