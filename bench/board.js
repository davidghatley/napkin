import {
  run,
  request,
  assert,
  canonical,
  nonce,
  entry,
  output,
  git,
  snapshot,
  stress,
  start,
  items,
  p95,
  frameGesture,
  evidence,
  sleep,
} from "./lib3/runtime.mjs";
import { join } from "node:path";
const samePosted = (actual, expected) =>
  Array.isArray(expected)
    ? Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((e, n) => samePosted(actual[n], e))
    : expected && typeof expected === "object"
      ? actual &&
        Object.entries(expected).every(([k, v]) => samePosted(actual[k], v))
      : actual === expected;
export async function measure() {
  return run("D4", async ({ book, f, s, browser, restart }) => {
    let listed, error;
    try {
      listed = await items(s);
      await request(s, "/api/board");
    } catch (e) {
      error = e.message;
    }
    const name = "Orbit " + nonce(),
      groupId = nonce(),
      viewId = nonce();
    let expected;
    await book.check(
      "board.roundtrip",
      "nested groups, manual pin and saved view round-trip, including after restart",
      async () => {
        assert(!error, error);
        const ids = listed.slice(0, 8).map((x) => x.id);
        assert(ids.length === 8, "need eight listed items");
        expected = {
          arrange: { by: "kind" },
          groups: [
            {
              id: groupId,
              name,
              items: ids.slice(0, 4),
              pinned: true,
              groups: [
                { id: nonce(), name: "Detail " + nonce(), items: ids.slice(4) },
              ],
            },
          ],
          views: [
            {
              id: viewId,
              name: "Review " + nonce(),
              arrange: { by: "folder" },
              groups: [groupId],
            },
          ],
        };
        await request(s, "/api/board", expected);
        const got = await request(s, "/api/board");
        for (const key of ["arrange", "groups", "views"])
          assert(
            samePosted(got[key], expected[key]),
            "roundtrip differs: " + key,
          );
        s = await restart();
        const reopened = await request(s, "/api/board");
        for (const key of ["arrange", "groups", "views"])
          assert(
            samePosted(reopened[key], expected[key]),
            "restart lost " + key,
          );
        return { ok: true, value: { group: name, savedView: viewId } };
      },
    );
    for (const mode of [
      "kind",
      "folder",
      "run",
      "tag",
      "date",
      "status",
      "similarity",
      "meta.value",
    ])
      await book.check(
        "arrange." + mode,
        "same input → same rendered geometry; pinned items stay in place",
        async () => {
          assert(!error, error);
          const b = await browser();
          await b.goto(s.base + "/");
          const read = () =>
            b.eval(
              `JSON.stringify([...document.querySelectorAll('[data-item-id]')].map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.itemId,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}).sort((a,b)=>a.id.localeCompare(b.id)))`,
            );
          const before = JSON.parse(await read());
          const pins =
            expected?.groups?.filter((g) => g.pinned).flatMap((g) => g.items) ||
            [];
          const arrange = async (by) => {
            const state = await request(s, "/api/board");
            await request(s, "/api/board", { ...state, arrange: { by } });
            await sleep(250);
            const got = await request(s, "/api/board");
            assert(got.arrange?.by === by, "mode was ignored");
            return read();
          };
          const first = await arrange(mode);
          assert(JSON.parse(first).length > 0, "no rendered item geometry");
          for (const id of pins) {
            const a = before.find((x) => x.id === id),
              z = JSON.parse(first).find((x) => x.id === id);
            assert(
              a && z && a.x === z.x && a.y === z.y,
              "arrangement moved a manual pin",
            );
          }
          await arrange("folder");
          const second = await arrange(mode);
          assert(first === second, "same mode produced a different layout");
          await evidence(b, "D4-" + mode);
          return {
            ok: true,
            value: { mode, rendered: JSON.parse(first).length },
          };
        },
        [
          "dream",
          ...(["kind", "folder", "run", "tag", "date", "status"].includes(mode)
            ? ["beat"]
            : []),
        ],
      );
    await book.check(
      "folder.clean",
      "git status including ignored/untracked stays clean after organizing",
      () => {
        assert(!error, error);
        const status = git(
          f.folder,
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--ignored",
        );
        return {
          ok:
            status === "" &&
            canonical(snapshot(f.folder)) === canonical(f.initial),
          value: status || "clean",
        };
      },
    );
    await book.check(
      "thousand.animate",
      "1000 items rearrange at p95 frame <16.7 ms",
      async () => {
        assert(!error, error);
        const folder = join(f.temp, "board-1000");
        await stress(folder, { mixed: true, large: false, seed: f.seed });
        const server = await start(folder, join(f.temp, "board-1000-state"));
        try {
          assert(
            (await items(server)).length === 1000,
            "not all 1000 items listed",
          );
          const b = await browser();
          await b.goto(server.base + "/");
          await b.eval(
            `window.__boardFrames=[];window.__boardStop=false;requestAnimationFrame(function f(t){if(window.__boardAt)window.__boardFrames.push(t-window.__boardAt);window.__boardAt=t;if(!window.__boardStop)requestAnimationFrame(f)})`,
          );
          for (const mode of ["kind", "folder", "date", "kind"]) {
            await request(server, "/api/board", { arrange: { by: mode } });
            await sleep(220);
          }
          const samples = await b.eval(
            "window.__boardStop=true;window.__boardFrames",
          );
          return {
            ok: samples.length >= 30 && p95(samples) < 16.7,
            value: { p95: p95(samples), n: samples.length },
          };
        } finally {
          await server.stop();
        }
      },
    );
  });
}
if (entry(import.meta.url)) output(await measure());
