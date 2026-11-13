import {
  run,
  items,
  request,
  assert,
  entry,
  output,
  start,
  key,
  typeKeys,
  palette,
  axe,
  sleep,
  evidence,
  decodePng,
} from "./lib3/runtime.mjs";
import { CARD_CONTENT } from "./kinds.js";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
// D8 Craft. Automated half: cold start, light and dark, axe in every state a person meets.
// Judged half (two fresh critics >= 8/10 against the floor products, slop audit 0 tells) cannot
// be satisfied from the repository: it is lead-attested input, reported as pending until supplied.
const luminance = (png) => {
  const p = decodePng(png);
  let sum = 0;
  for (let i = 0; i < p.data.length; i += 16)
    sum += (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
  return sum / (p.data.length / 16);
};
export async function measure() {
  return run("D8", async ({ book, f, s, browser }) => {
    book.defaultTiers = ["dream"];
    let listed = [],
      error;
    try {
      listed = await items(s);
    } catch (e) {
      error = e.message;
    }
    await book.check(
      "cold.start",
      "CLI start to a canvas of >= 5 cards with real content in < 1 s (fresh process, populated folder)",
      async () => {
        assert(!error, error);
        const empty = join(f.temp, "cold-state");
        mkdirSync(empty, { recursive: true });
        const server = await start(f.folder, empty);
        try {
          const b = await browser();
          const t = performance.now();
          await b.send("Page.navigate", { url: server.base + "/" });
          await b.waitFor(
            `[...document.querySelectorAll('[data-item-id]')].filter(${CARD_CONTENT}).length>=5`,
            3000,
          );
          const total = server.ms + (performance.now() - t);
          return {
            ok: total < 1000,
            value: { server: server.ms, canvas: performance.now() - t, total },
          };
        } finally {
          await server.stop();
        }
      },
    );
    for (const scheme of ["light", "dark"]) {
      await book.check(
        `axe.${scheme}`,
        `0 axe violations in ${scheme}: canvas, palette, selected-item panel, studio, key map`,
        async () => {
          assert(!error, error);
          const b = await browser();
          await b.send("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-color-scheme", value: scheme }],
          });
          await b.goto(s.base + "/");
          await sleep(500);
          const cards = await b.eval(
            "document.querySelectorAll('[data-item-id]').length",
          );
          assert(
            cards >= 5,
            `axe on an empty canvas proves nothing (${cards} cards)`,
          );
          // Each state must really be open and non-trivial before it is scanned: scanning an
          // empty page or a no-op command proves nothing.
          const open = (selector, min, what) =>
            b.eval(
              `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>{const r=e.getBoundingClientRect();return r.width>40&&r.height>20});return e?e.querySelectorAll('*').length:0})()`,
            ).then((n) => assert(n >= min, `${what} is not open (${n} nodes; need >= ${min})`));
          const found = { canvas: await axe(b) };
          await key(b, "k", 2);
          await open("[role=dialog],[role=combobox],[data-palette]", 6, "the command palette");
          assert(
            (await b.eval("document.querySelectorAll('[role=option]').length")) >= 1,
            "the palette lists no options",
          );
          found.palette = await axe(b);
          await key(b, "Escape");
          const html = listed.find((x) => x.kind === "html");
          await palette(b, "Select " + html.path);
          await sleep(300);
          await open("[data-controls-for]", 8, "the selected-item panel");
          found.panel = await axe(b);
          const schema = await request(
            s,
            "/api/controls/" + encodeURIComponent(html.id),
          );
          const c = schema.sections.flatMap((x) => x.controls)[0];
          await palette(b, "Studio " + c.label);
          await sleep(300);
          await open("[data-studio-for]", 8, "the control studio");
          found.studio = await axe(b);
          await key(b, "Escape");
          await key(b, "?");
          await sleep(200);
          await open("[role=dialog]", 10, "the key map");
          found.keymap = await axe(b);
          await key(b, "Escape");
          const all = Object.values(found).flat();
          await evidence(b, "D8-" + scheme);
          return { ok: all.length === 0, value: { cards, found } };
        },
      );
    }
    await book.check(
      "themes.differ",
      "light and dark are real themes: the canvas is clearly darker in dark",
      async () => {
        assert(!error, error);
        const b = await browser();
        const lum = {};
        for (const scheme of ["light", "dark"]) {
          await b.send("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-color-scheme", value: scheme }],
          });
          await b.goto(s.base + "/");
          await sleep(500);
          assert(
            (await b.eval(
              "document.querySelectorAll('[data-item-id]').length",
            )) >= 5,
            "no populated canvas",
          );
          lum[scheme] = luminance(await b.screenshot());
        }
        return { ok: lum.light - lum.dark > 60, value: lum };
      },
    );
    await book.attest(
      "rubric.critics",
      "two fresh critics >= 8/10 blind against the floor products' screenshots, A/B swapped",
      "craft",
      (e) =>
        e.blind === true &&
        e.orderSwapped === true &&
        Array.isArray(e.critics) &&
        e.critics.length >= 2 &&
        new Set(e.critics.map((c) => c.id)).size >= 2 &&
        e.critics.every(
          (c) =>
            c.score >= 8 && /^[0-9a-f]{64}$/.test(c.screenshotsSha256 || ""),
        ),
    );
    await book.attest(
      "slop.audit",
      "slop audit reports 0 tells on canvas, panel, studio and key map",
      "slop",
      (e) =>
        e.tells === 0 &&
        /^[0-9a-f]{64}$/.test(e.reportSha256 || "") &&
        e.skill === "slop-audit",
    );
  });
}
if (entry(import.meta.url)) output(await measure());
