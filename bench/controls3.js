import { scrubWalk, selectionTime } from "./lib3/pixels.mjs";
import { shot, differing, rectOf } from "./lib3/semantic.mjs";
import { dirname, basename } from "node:path";
import {
  run,
  items,
  request,
  assert,
  snapshot,
  canonical,
  changed,
  valueFor,
  entry,
  output,
  p95,
  key,
  palette,
  selectItem,
  evidence,
  sleep,
  focusVisible,
  axe,
  typeKeys,
  observe,
  decodePng,
} from "./lib3/runtime.mjs";
export async function measure() {
  return run("D2", async ({ book, f, s: s0, browser, restart }) => {
    let s = s0;
    let listed = [],
      error;
    try {
      listed = await items(s);
    } catch (e) {
      error = e.message;
    }
    const types = new Set(),
      kinds = new Set(),
      depths = new Map();
    let controlTotal = 0,
      keyboardTotal = 0;
    const swaps = [],
      latencies = [],
      widgets = new Map(),
      effects = [],
      persisted = [];
    for (const file of f.files)
      await book.check(
        "instruments." + file.original,
        "≥1 section; each control mutates disk, undo exact, keys and three depths",
        async () => {
          assert(!error, error);
          const item = listed.find((x) => x.path === file.path);
          assert(item, "missing item");
          let schema = await request(
            s,
            "/api/controls/" + encodeURIComponent(item.id),
          );
          assert(
            schema.revision !== undefined && schema.sections?.length >= 1,
            "revision and ≥1 section required",
          );
          const controls = schema.sections.flatMap((x) => {
            assert(
              x.id && x.label && x.controls?.length,
              "section id, label and controls required",
            );
            return x.controls;
          });
          assert(controls.length, "no controls");
          const b = await browser();
          await b.goto(s.base + "/");
          await key(b, "k", 2);
          await typeKeys(b, "Select " + file.path);
          const swap = await selectionTime(b, () => key(b, "Enter"), item.id);
          swaps.push(swap);
          kinds.add(file.kind);
          for (const c of controls) {
            controlTotal++;
            assert(
              c.id && c.type && c.label && [1, 2, 3].includes(c.depth),
              "control schema incomplete",
            );
            // The contract marks `figure` optional in the schema; the figure is judged where it
            // matters, in the rendered control below (an svg/canvas/img/[data-figure] that changes).
            if (!depths.has(c.type)) depths.set(c.type, new Set());
            schema = await request(
              s,
              "/api/controls/" + encodeURIComponent(item.id),
            );
            const before = snapshot(f.folder),
              value = valueFor(c);
            const result = await request(s, "/api/control", {
              item: item.id,
              control: c.id,
              value,
              baseRevision: schema.revision,
            });
            assert(
              result.ok === true && result.revision !== schema.revision,
              "control did not commit a new revision",
            );
            const after = snapshot(f.folder);
            assert(
              changed(before, after),
              "POST control acknowledged without changing any file bytes or recipe",
            );
            const changedPaths = [
              ...new Set([...Object.keys(before), ...Object.keys(after)]),
            ].filter((p) => before[p] !== after[p]);
            assert(
              changedPaths.every(
                (p) =>
                  p === file.path ||
                  (dirname(p) === dirname(file.path) &&
                    basename(p).startsWith(basename(file.path) + ".")),
              ),
              "control changed an unrelated file",
            );
            const read = await request(
              s,
              "/api/controls/" + encodeURIComponent(item.id),
            );
            assert(
              canonical(
                read.sections
                  .flatMap((x) => x.controls)
                  .find((x) => x.id === c.id)?.value,
              ) === canonical(value),
              "control readback differs",
            );
            if (
              effects.length < 90 &&
              controls.indexOf(c) < 3 &&
              !/^(txt|md|code|diff|patch|binary|zip)$/.test(file.kind)
            ) {
              // The rendered item must change with the value: a recipe that nothing reads is not an instrument.
              const vb = await browser();
              const afterView = await observe(
                vb,
                s.base + "/view/" + encodeURIComponent(item.id),
              );
              await request(s, "/api/undo", { item: item.id });
              const undoneView = await observe(
                vb,
                s.base + "/view/" + encodeURIComponent(item.id),
              );
              const pa = decodePng(afterView.png),
                pu = decodePng(undoneView.png);
              effects.push({
                id: file.original + "/" + c.id,
                changed:
                  differing(pa, pu) > 12 || afterView.text !== undoneView.text,
              });
              await request(s, "/api/control", {
                item: item.id,
                control: c.id,
                value,
                baseRevision: (
                  await request(
                    s,
                    "/api/controls/" + encodeURIComponent(item.id),
                  )
                ).revision,
              });
            }
            if (persisted.length < 3 && controls.indexOf(c) === 0)
              persisted.push({
                item: item.id,
                control: c.id,
                value,
                path: file.path,
              });
            await request(s, "/api/undo", { item: item.id });
            assert(
              canonical(snapshot(f.folder)) === canonical(before),
              "undo did not restore whole folder byte for byte",
            );
            // Reach the actual control by palette and commit through key events only.
            await palette(b, "Control " + c.label);
            assert(await focusVisible(b), "control focus not visible");
            const figureSel = `[data-control-id="${c.id}"] svg, [data-control-id="${c.id}"] canvas, [data-control-id="${c.id}"] [data-figure], [data-control-id="${c.id}"] img`;
            const figureRect = await rectOf(b, figureSel);
            assert(
              figureRect && figureRect.w >= 12 && figureRect.h >= 8,
              "control shows no live figure (an svg/canvas/[data-figure] of at least 12x8 px)",
            );
            const figureBefore = await shot(b);
            widgets.set(
              c.type,
              await b.eval(
                `(()=>{const e=document.querySelector('[data-control-id="'+CSS.escape(${JSON.stringify(c.id)})+'"]');const w=e&&e.querySelector('input,select,textarea,button,[role],canvas,svg');return w?w.tagName+':'+(w.type||'')+':'+(w.getAttribute('role')||''):'none'})()`,
              ),
            );
            const pixels = await b.screenshot();
            await key(b, "a", 2);
            if (typeof value === "boolean") await key(b, " ");
            else {
              await typeKeys(
                b,
                typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value),
              );
              await key(b, "Enter");
            }
            await b.eval("new Promise(r=>requestAnimationFrame(r))");
            assert(
              changed(before, snapshot(f.folder)),
              "keyboard path did not write bytes",
            );
            assert(
              changed(pixels, await b.screenshot()),
              "no visible response to keyboard control",
            );
            assert(
              differing(figureBefore, await shot(b), figureRect) > 0,
              "the control's live figure did not change when its value changed",
            );
            types.add(c.type);
            keyboardTotal++;
            await request(s, "/api/undo", { item: item.id });
            assert(
              canonical(snapshot(f.folder)) === canonical(before),
              "keyboard undo differs",
            );
            if (
              typeof c.value === "number" &&
              file.kind === "html" &&
              latencies.length < 30
            ) {
              await palette(b, "Control " + c.label);
              latencies.push(...(await scrubWalk(b, { steps: 30 })));
              await key(b, "Escape");
            }
            for (const depth of ["Dial", "Bench", "Studio"]) {
              await palette(b, depth + " " + c.label);
              const depthNumber =
                ["Dial", "Bench", "Studio"].indexOf(depth) + 1;
              const open = await request(
                s,
                "/api/controls/" + encodeURIComponent(item.id),
              );
              const actual = open.sections
                .flatMap((x) => x.controls)
                .find((x) => x.id === c.id);
              assert(
                actual?.depth === depthNumber,
                "control schema depth did not follow UI",
              );
              depths.get(c.type).add(actual.depth);
              if (depthNumber === 1) {
                const h = await b.eval(
                  `document.querySelector('[data-control-id='+CSS.escape(${JSON.stringify(c.id)})+']')?.getBoundingClientRect().height`,
                );
                assert(Math.abs(h - 32) <= 1, "dial must be one 32 px row");
              }
              const area = await b.eval(
                `(()=>{const e=document.querySelector('[data-studio-for="'+CSS.escape(${JSON.stringify(c.id)})+'"],[data-control-id="'+CSS.escape(${JSON.stringify(c.id)})+'"]');if(!e)return null;const r=e.getBoundingClientRect();return{h:r.height,share:r.width*r.height/(innerWidth*innerHeight),siblings:e.closest('section,[data-section-id]')?.querySelectorAll('[data-control-id]').length}})()`,
              );
              if (depthNumber === 2)
                assert(
                  area &&
                    area.h > 32 &&
                    (area.siblings ?? 0) >=
                      Math.min(
                        2,
                        schema.sections.find((x) =>
                          x.controls.some((y) => y.id === c.id),
                        )?.controls.length ?? 1,
                      ),
                  "bench depth must open the section with its related controls",
                );
              if (
                depthNumber === 3 &&
                /color|curve|spring|ease|motion|keyframe/i.test(c.type)
              )
                assert(
                  area && area.share >= 0.3,
                  `studio must take over a large pane (${area?.share})`,
                );
              await evidence(
                b,
                "D2-" + file.original + "-" + c.id + "-" + depth,
              );
            }
          }
          return {
            ok: true,
            value: {
              sections: schema.sections.length,
              controls: controls.length,
            },
          };
        },
        ["dream"],
      );
    await book.check(
      "coverage.beat",
      "12 control types at all three depths; 10 kinds",
      () => ({
        ok:
          types.size >= 12 &&
          kinds.size >= 10 &&
          [...depths.values()].every((x) => x.size === 3),
        value: {
          types: [...types],
          kinds: kinds.size,
          depths: [...depths].map(([k, v]) => [k, [...v]]),
        },
      }),
      ["beat"],
    );
    await book.check(
      "keyboard.all",
      "every declared control keyboard-operable",
      () => ({
        ok: controlTotal > 0 && keyboardTotal === controlTotal,
        value: { total: controlTotal, driven: keyboardTotal },
      }),
    );
    await book.check("panel.swap", "selection → panel < 50 ms", () => ({
      ok: swaps.length === f.files.length && Math.max(...swaps) < 50,
      value: { samples: swaps.length, max: Math.max(...swaps) },
    }));
    await book.check(
      "scrub.pixel",
      "p95 scrub event → changed pixels < 16.7 ms",
      () => ({
        ok: latencies.length >= 30 && p95(latencies) < 16.7,
        value: { samples: latencies.length, p95: p95(latencies) },
      }),
    );
    await book.check(
      "effects.visible",
      "changing a control changes the rendered item (>= 70% of sampled controls on visual kinds)",
      () => ({
        ok:
          effects.length >= 20 &&
          effects.filter((e) => e.changed).length >= effects.length * 0.7,
        value: {
          sampled: effects.length,
          changed: effects.filter((e) => e.changed).length,
          flat: effects
            .filter((e) => !e.changed)
            .map((e) => e.id)
            .slice(0, 10),
        },
      }),
    );
    await book.check(
      "widgets.distinct",
      "control types are distinct widgets, not one box with 12 names (>= 8 distinct widget shapes)",
      () => ({
        ok: new Set(widgets.values()).size >= 8,
        value: { types: widgets.size, shapes: [...new Set(widgets.values())] },
      }),
      ["beat"],
    );
    await book.check(
      "persist.fresh-process",
      "committed control values are re-read from files by a fresh server process",
      async () => {
        assert(
          !error && persisted.length,
          error || "no committed control to persist",
        );
        for (const p of persisted) {
          const schema = await request(
            s,
            "/api/controls/" + encodeURIComponent(p.item),
          );
          await request(s, "/api/control", {
            item: p.item,
            control: p.control,
            value: p.value,
            baseRevision: schema.revision,
          });
        }
        s = await restart();
        for (const p of persisted) {
          const got = await request(
            s,
            "/api/controls/" + encodeURIComponent(p.item),
          );
          const c = got.sections
            .flatMap((x) => x.controls)
            .find((x) => x.id === p.control);
          assert(
            canonical(c?.value) === canonical(p.value),
            `${p.path}: control ${p.control} lost its value across a restart`,
          );
        }
        return { ok: true, value: { checked: persisted.length } };
      },
    );
    await book.check(
      "affordances.auto",
      "modified marker, reset, typed math with units, fine/coarse scrub, copy and paste on a real numeric control",
      async () => {
        assert(!error, error);
        const item = listed.find((x) => x.kind === "html") || listed[0];
        const schema = await request(
          s,
          "/api/controls/" + encodeURIComponent(item.id),
        );
        const num = schema.sections
          .flatMap((x) => x.controls)
          .find(
            (c) =>
              typeof c.value === "number" &&
              c.max !== undefined &&
              c.min !== undefined &&
              c.max - c.min >= 20,
          );
        assert(num, "no numeric control with a range on " + item.path);
        const b = await browser();
        await b.goto(s.base + "/");
        await selectItem(b, s, item);
        const read = async () =>
          (
            await request(s, "/api/controls/" + encodeURIComponent(item.id))
          ).sections
            .flatMap((x) => x.controls)
            .find((x) => x.id === num.id);
        const original = num.value,
          target = Math.round(
            num.min + (num.max - num.min) * (0.3 + Math.random() * 0.4),
          );
        await palette(b, "Control " + num.label);
        await key(b, "a", 2);
        await typeKeys(b, `${target - 7}+7`);
        await key(b, "Enter");
        await sleep(150);
        assert(
          (await read()).value === target,
          "typed math did not evaluate to " + target,
        );
        const sel = `[data-control-id="${num.id}"]`;
        assert(
          await b.eval(
            `!!document.querySelector(${JSON.stringify(sel)}+' [data-modified],'+${JSON.stringify(sel)}+'[data-modified],'+${JSON.stringify(sel)}+' [aria-label*="modified" i]')`,
          ),
          "no modified marker on a changed control",
        );
        const a0 = (await read()).value;
        await key(b, "ArrowRight");
        const a1 = (await read()).value;
        await key(b, "ArrowRight", 8);
        const a2 = (await read()).value;
        await key(b, "ArrowRight", 1);
        const a3 = (await read()).value;
        assert(
          a1 > a0 && a2 - a1 > a1 - a0 && a3 - a2 > 0 && a3 - a2 < a1 - a0,
          `coarse/fine steps wrong (${a0},${a1},${a2},${a3})`,
        );
        await palette(b, "Reset " + num.label);
        assert(
          (await read()).value === original,
          "reset did not restore the default",
        );
        assert(
          !(await b.eval(
            `!!document.querySelector(${JSON.stringify(sel)}+' [data-modified]')`,
          )),
          "modified marker stays after reset",
        );
        return { ok: true, value: { control: num.id, target } };
      },
    );
    await book.attest(
      "studios.color-motion",
      "full color and motion studios at depth 3 (OKLCH planes, gamut and contrast maps, palettes, ramps, harmony, sampled palettes, token binding, history; curve and spring editors with ghost)",
      "studios",
      (e) =>
        [
          "oklch",
          "gamut",
          "contrast",
          "palette",
          "ramps",
          "harmony",
          "sampledPalette",
          "tokenBinding",
          "history",
          "curves",
          "springs",
          "ghost",
        ].every((k) => e.features?.[k] === true && e.captures?.[k]),
    );
    await book.attest(
      "blind.rubric",
      ">= 8/10 blind against Tweakpane, Leva and DialKit, A/B order swapped",
      "instruments",
      (e) =>
        e.blind === true &&
        e.orderSwapped === true &&
        ["Tweakpane", "Leva", "DialKit"].every((k) => e.comparisons?.[k] >= 8),
    );
  });
}
if (entry(import.meta.url)) output(await measure());
