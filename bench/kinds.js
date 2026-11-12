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
} from "./lib3/runtime.mjs";
import { join } from "node:path";
import { readFileSync, statSync, mkdirSync } from "node:fs";
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
            item.kind === file.kind,
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
            );
          assert(r.kind === file.kind, `root data-napkin-kind is ${r.kind}`);
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
        `(()=>{const cards=[...document.querySelectorAll('[data-item-id]')];return{n:cards.length,blank:cards.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&!e.querySelector('iframe,img,canvas,svg,video,audio,table,pre,article')}).length}})()`,
      );
      await book.check(
        "mixed.open",
        "1000 items; complete visible cards < 2 s from CLI start",
        () => ({
          ok:
            ws.ms + performance.now() - t < 2000 &&
            cards.n > 0 &&
            cards.blank === 0,
          value: { ms: ws.ms + performance.now() - t, cards },
        }),
      );
      for (const mode of ["pan", "zoom"])
        await book.check(
          "mixed." + mode,
          "p95 frame < 16.7 ms; no blank cards after 300 ms",
          async () => {
            const samples = await frameGesture(wb, mode);
            await sleep(300);
            const visible = await wb.eval(
              `(()=>{const a=[...document.querySelectorAll('[data-item-id]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight});return{n:a.length,blank:a.filter(e=>!e.querySelector('iframe,img,canvas,svg,video,audio,table,pre,article')).length}})()`,
            );
            return {
              ok:
                samples.length >= 30 &&
                p95(samples) < 16.7 &&
                visible.n > 0 &&
                !visible.blank,
              value: { p95: p95(samples), samples: samples.length, visible },
            };
          },
        );
    } catch (e) {
      for (const id of ["mixed.open", "mixed.pan", "mixed.zoom"])
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
                browserPeak - browserBaseline < bytes * 0.6,
              value: {
                fileBytes: bytes,
                baseline,
                peak: server.peakRSS(),
                increase: server.peakRSS() - baseline,
                browserBaseline,
                browserPeak,
                browserIncrease: browserPeak - browserBaseline,
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
