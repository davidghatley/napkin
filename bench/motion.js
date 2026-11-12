import { scrubWalk } from "./lib3/pixels.mjs";
import {
  run,
  items,
  request,
  assert,
  entry,
  output,
  key,
  palette,
  p95,
  snapshot,
  canonical,
  nonce,
  evidence,
  sleep,
} from "./lib3/runtime.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export async function measure() {
  return run("D7", async ({ book, f, s: s0, browser, restart }) => {
    let s = s0;
    let listed, error;
    try {
      listed = await items(s);
    } catch (e) {
      error = e.message;
    }
    const latencies = [];
    for (const kind of [
      "css-animation",
      "waapi",
      "svg",
      "lottie",
      "gif",
      "apng",
      "mp4",
      "webm",
      "mov",
      "wav",
      "mp3",
      "flac",
      "ogg",
    ])
      await book.check(
        "timeline." + kind,
        "real timeline scrub; loop range; keyframe controls where editable",
        async () => {
          assert(!error, error);
          const file = f.files.find((x) => x.kind === kind),
            item = listed.find((x) => x.path === file.path);
          assert(item, "animated item missing");
          const b = await browser();
          await b.goto(s.base + "/view/" + encodeURIComponent(item.id));
          // Timeline is a normal accessible slider, not an in-page call to product functions.
          const selector =
            'input[type="range"][aria-label*="time" i],[role="slider"][aria-label*="time" i]';
          await b.waitFor(
            `!!document.querySelector(${JSON.stringify(selector)})`,
            1500,
          );
          // Reach it only by Tab. Never call focus(), click(), or mutate a value from evaluate.
          for (let n = 0; n < 80; n++) {
            if (
              await b.eval(
                `document.activeElement?.matches(${JSON.stringify(selector)})`,
              )
            )
              break;
            await key(b, "Tab");
          }
          assert(
            await b.eval(
              `document.activeElement?.matches(${JSON.stringify(selector)})`,
            ),
            "timeline unreachable by keyboard",
          );
          const preview = file.markers.selectors.at(-1);
          const before = await b.eval(
            `document.activeElement.getAttribute('aria-valuenow')??document.activeElement.value`,
          );
          const samples = await scrubWalk(b, { selector: preview, steps: 35 });
          const after = await b.eval(
            `document.activeElement.getAttribute('aria-valuenow')??document.activeElement.value`,
          );
          assert(
            before !== after || samples.length === 35,
            "timeline key did not change its value",
          );
          latencies.push(...samples);
          const schema = await request(
            s,
            "/api/controls/" + encodeURIComponent(item.id),
          );
          assert(
            schema.sections
              ?.flatMap((x) => x.controls)
              .some((c) => /loop|range/i.test(c.type + " " + c.label)),
            "loop-range instrument missing",
          );
          await evidence(b, "D7-" + kind);
          return {
            ok: p95(samples) < 16.7,
            value: { samples: samples.length, p95: p95(samples) },
          };
        },
        ["dream"],
      );
    await book.check(
      "scrub.p95",
      "all animated items; p95 scrub-to-frame <16.7 ms",
      () => ({
        ok: latencies.length === 13 * 35 && p95(latencies) < 16.7,
        value: { n: latencies.length, p95: p95(latencies) },
      }),
      ["dream"],
    );
    for (const kind of ["css-animation", "waapi", "svg"])
      await book.check(
        "keyframe." + kind,
        "random keyframe persists in real CSS/code; reopening and undo agree",
        async () => {
          assert(!error, error);
          const file = f.files.find((x) => x.kind === kind),
            item = listed.find((x) => x.path === file.path);
          assert(item, "item missing");
          const schema = await request(
              s,
              "/api/controls/" + encodeURIComponent(item.id),
            ),
            control = schema.sections
              ?.flatMap((x) => x.controls)
              .find((c) => /keyframe/i.test(c.type));
          assert(control, "keyframe instrument absent");
          assert(
            Array.isArray(control.value) && control.value.length >= 2,
            "keyframes must expose real frame records",
          );
          const before = snapshot(f.folder),
            value = structuredClone(control.value),
            target = 137 + (f.seed % 311);
          value[1] = { ...value[1], transform: `translateX(${target}px)` };
          const r = await request(s, "/api/control", {
            item: item.id,
            control: control.id,
            value,
            baseRevision: schema.revision,
          });
          assert(r.ok, "keyframe commit refused");
          const code = (t) =>
            t
              .replace(/\/\*[\s\S]*?\*\//g, "")
              .replace(/<!--[\s\S]*?-->/g, "")
              .replace(/(^|[^:])\/\/.*$/gm, "$1");
          assert(
            new RegExp(`translateX\\(\\s*${target}px\\s*\\)`).test(
              code(readFileSync(join(f.folder, file.path), "utf8")),
            ),
            "keyframe not written as live code (comments do not count)",
          );
          s = await restart();
          const b = await browser();
          const fresh = (await items(s)).find((x) => x.path === file.path);
          await b.goto(s.base + "/view/" + encodeURIComponent(fresh.id));
          if (kind !== "svg") {
            await sleep(300);
            const live = await b.eval(
              `document.getAnimations().some(a=>a.effect.getKeyframes().some(k=>String(k.transform).replace(/\\s/g,'').includes('translateX(${target}px)')))`,
            );
            assert(
              live,
              "the reopened item does not animate through the edited keyframe",
            );
          }
          const read = await request(
            s,
            "/api/controls/" + encodeURIComponent(item.id),
          );
          assert(
            canonical(
              read.sections
                .flatMap((x) => x.controls)
                .find((c) => c.id === control.id)?.value,
            ) === canonical(value),
            "reopened keyframe differs",
          );
          await request(s, "/api/undo", { item: fresh.id });
          assert(
            canonical(before) === canonical(snapshot(f.folder)),
            "keyframe undo differs",
          );
          return { ok: true, value: { target } };
        },
        ["dream"],
      );
    await book.check(
      "interface.motion",
      "interruptible UI transitions <200 ms; reduced motion disables nonessential motion",
      async () => {
        assert(!error, error);
        const b = await browser();
        await b.send("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-reduced-motion", value: "no-preference" },
          ],
        });
        await b.goto(s.base + "/");
        const sample = async () =>
          b.eval(
            `document.getAnimations().filter(a=>!a.effect?.target?.closest('[data-napkin-kind]')).map(a=>({duration:a.effect.getComputedTiming().duration,time:a.currentTime,state:a.playState}))`,
          );
        await key(b, "k", 2);
        const first = await sample();
        await key(b, "Escape");
        await key(b, "k", 2);
        const second = await sample();
        assert(
          first.length && second.length,
          "no observable interruptible interface transitions",
        );
        assert(
          [...first, ...second].every((a) => a.duration < 200),
          "interface transition reaches 200 ms",
        );
        await sleep(220);
        assert(
          (await sample()).every((x) => x.state !== "running"),
          "interrupted UI transition kept running",
        );
        // Interrupt it again and again: it must always settle, in the right final state.
        for (let n = 0; n < 6; n++) {
          await key(b, "k", 2);
          await sleep(30 + (n % 3) * 20);
          await key(b, "Escape");
          await sleep(25);
        }
        await sleep(260);
        assert(
          (await sample()).every((x) => x.state !== "running"),
          "repeatedly interrupted transitions did not settle",
        );
        assert(
          !(await b.eval(
            "!![...document.querySelectorAll('[role=dialog],[role=combobox]')].find(e=>e.getBoundingClientRect().width>0)",
          )),
          "the palette is still open after an even number of toggles",
        );
        // The same craft applies beyond the palette: moving cards and swapping panels animate too.
        const listedNow = await items(s);
        const target = listedNow.find((x) => x.kind === "html") || listedNow[0];
        await key(b, "k", 2);
        for (const ch of "Select " + target.path) await key(b, ch);
        await key(b, "Enter");
        await sleep(40);
        const swapAnims = await sample();
        assert(
          swapAnims.length > 0,
          "selecting an item animates nothing in the interface",
        );
        assert(
          swapAnims.every((a) => a.duration < 200),
          "panel swap reaches 200 ms",
        );
        await b.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        });
        await key(b, "Escape");
        await key(b, "k", 2);
        const reduced = await sample();
        for (const ch of "Arrange by kind") await key(b, ch);
        await key(b, "Enter");
        await sleep(30);
        const reducedMove = await sample();
        assert(
          reducedMove.every((a) => a.duration === 0 || a.state !== "running"),
          "cards still glide under prefers-reduced-motion",
        );
        assert(
          reduced.every((a) => a.duration === 0 || a.state !== "running"),
          "nonessential motion remains under prefers-reduced-motion",
        );
        return { ok: true, value: { normal: first.length, reduced } };
      },
      ["dream"],
    );
  });
}
if (entry(import.meta.url)) output(await measure());
