import { scrubPixel, selectionTime } from "./lib3/pixels.mjs";
import { reviewEvidence } from "./lib3/reviews.mjs";
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
  evidence,
  sleep,
  focusVisible,
  axe,
  typeKeys,
} from "./lib3/runtime.mjs";
export async function measure() {
  return run("D2", async ({ book, f, s, browser }) => {
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
      latencies = [];
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
            assert(c.figure, "control has no live figure");
            types.add(c.type);
            if (!depths.has(c.type)) depths.set(c.type, new Set());
            depths.get(c.type).add(c.depth);
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
            await request(s, "/api/undo", { item: item.id });
            assert(
              canonical(snapshot(f.folder)) === canonical(before),
              "undo did not restore whole folder byte for byte",
            );
            // Reach the actual control by palette and commit through key events only.
            await palette(b, "Control " + c.label);
            assert(await focusVisible(b), "control focus not visible");
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
              for (let n = 0; n < 30; n++) {
                const ms = await scrubPixel(
                  b,
                  n % 2 ? "ArrowLeft" : "ArrowRight",
                );
                latencies.push(ms);
              }
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
      "studios.color-motion",
      "full color and motion studios at depth 3",
      () => {
        const e = reviewEvidence("studios");
        const required = [
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
        ];
        return {
          ok: required.every((k) => e.features?.[k] === true),
          value: e,
        };
      },
    );
    await book.check(
      "affordances",
      "live figures, modified dots, reset, scrubs, units/math, clipboard; no bare number boxes",
      () => {
        const e = reviewEvidence("affordances");
        return {
          ok: [
            "figures",
            "modified",
            "reset",
            "fineScrub",
            "coarseScrub",
            "units",
            "math",
            "copyPaste",
            "schemaOnly",
            "recipesDocumented",
          ].every((k) => e.features?.[k] === true),
          value: e,
        };
      },
    );
    await book.check(
      "blind.rubric",
      "≥8/10 against Tweakpane, Leva, DialKit",
      () => {
        const e = reviewEvidence("instruments");
        return {
          ok:
            e.blind === true &&
            ["Tweakpane", "Leva", "DialKit"].every(
              (k) => e.comparisons?.[k] >= 8,
            ),
          value: e,
        };
      },
    );
  });
}
if (entry(import.meta.url)) output(await measure());
