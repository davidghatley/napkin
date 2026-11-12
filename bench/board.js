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
  sleep,
  evidence,
  FRAME_BUDGET,
} from "./lib3/runtime.mjs";
import { CARD_CONTENT } from "./kinds.js";
import { join } from "node:path";
import { mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";

const samePosted = (actual, expected) =>
  Array.isArray(expected)
    ? Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((e, n) => samePosted(actual[n], e))
    : expected && typeof expected === "object"
      ? actual &&
        Object.entries(expected).every(([k, v]) => samePosted(actual[k], v))
      : actual === expected;
// Items per top-level group (descendants flattened), as sorted id lists.
const flatten = (g) => [
  ...(g.items || []),
  ...(g.groups || []).flatMap(flatten),
];
const partitionOf = (board) =>
  (board.groups || [])
    .map((g) => flatten(g).sort())
    .filter((x) => x.length)
    .sort((a, b) => a[0].localeCompare(b[0]));
const geometry = (b, ids) =>
  b
    .eval(
      `JSON.stringify(Object.fromEntries([...document.querySelectorAll('[data-item-id]')].filter(e=>${ids ? `new Set(${JSON.stringify(ids)}).has(e.dataset.itemId)` : "true"}).map(e=>{const r=e.getBoundingClientRect();return[e.dataset.itemId,{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width}]})))`,
    )
    .then(JSON.parse);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Mean intra-group vs inter-group centre distance. Cohesion is "clearly smaller inside".
function cohesion(geo, parts) {
  const intra = [],
    inter = [];
  const where = new Map(parts.flatMap((p, i) => p.map((id) => [id, i])));
  const ids = [...where.keys()].filter((id) => geo[id]);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      (where.get(ids[i]) === where.get(ids[j]) ? intra : inter).push(
        dist(geo[ids[i]], geo[ids[j]]),
      );
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return {
    n: ids.length,
    ratio: mean(intra) / (mean(inter) || 1),
  };
}
// Centres of tracked cards every frame during a transition.
async function film(b, ids, trigger, ms = 900) {
  await b.eval(
    `(()=>{const ids=new Set(${JSON.stringify(ids)});window.__film={frames:[],times:[],count:[],stop:false};let last=performance.now();requestAnimationFrame(function f(t){const m={};for(const e of document.querySelectorAll('[data-item-id]')){if(ids.has(e.dataset.itemId)){const r=e.getBoundingClientRect();m[e.dataset.itemId]=[r.x+r.width/2,r.y+r.height/2]}}window.__film.frames.push(m);window.__film.times.push(t-last);window.__film.count.push(Object.keys(m).length);last=t;if(!window.__film.stop)requestAnimationFrame(f)})})()`,
  );
  await sleep(120);
  await trigger();
  await sleep(ms);
  return b.eval("window.__film.stop=true;window.__film");
}
function judgeFilm(film, ids, minMove = 30) {
  const last = film.frames.at(-1);
  let moved = 0,
    smooth = 0;
  for (const id of ids) {
    const a = film.frames.find((m) => m[id])?.[id],
      z = last[id];
    if (!a || !z) continue;
    const total = Math.hypot(z[0] - a[0], z[1] - a[1]);
    if (total < minMove) continue;
    moved++;
    let mid = 0;
    for (const m of film.frames) {
      if (!m[id]) continue;
      const d = Math.hypot(m[id][0] - a[0], m[id][1] - a[1]);
      if (d > total * 0.08 && d < total * 0.92) mid++;
    }
    if (mid >= 3) smooth++;
  }
  const startCount = Math.max(0, ...film.count.slice(0, 3));
  const dropped = film.count
    .slice(5)
    .filter((n) => startCount > 0 && n < startCount * 0.5).length;
  return {
    tracked: ids.length,
    moved,
    smooth,
    dropped,
    frames: film.frames.length,
  };
}
export async function measure() {
  return run("D4", async ({ book, f, browser }) => {
    let error;
    const folder = join(f.temp, "board-small");
    const names = ["a", "b", "c"].map((x) => x + nonce().slice(0, 4));
    const years = [
      2018 + randomInt(0, 2),
      2021 + randomInt(0, 2),
      2024 + randomInt(0, 2),
    ];
    const specs = [];
    // Kind, folder and age are three different cuts of the same items (a Latin square), so a
    // layout keyed on the wrong attribute cannot satisfy the right one.
    const N = 9 + 3 * randomInt(0, 3);
    try {
      mkdirSync(folder, { recursive: true });
      for (const d of names) mkdirSync(join(folder, d));
      for (let i = 0; i < N; i++) {
        const k = i % 3,
          d = (i + Math.floor(i / 3)) % 3,
          y = Math.floor(i / 3) % 3,
          tag = (i + 2 * Math.floor(i / 3)) % 3;
        const base = `item-${nonce()}`;
        const path = join(
          names[d],
          k === 0 ? base + ".md" : k === 1 ? base + ".csv" : base + ".svg",
        );
        const body =
          k === 0
            ? `---\ntags: [tag${tag}]\nstatus: s${(i * 2 + 1) % 3}\n---\n# ${base}\n`
            : k === 1
              ? `id,label\n1,${base}\n`
              : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#${nonce().slice(0, 6)}"/></svg>`;
        writeFileSync(join(folder, path), body);
        const when = new Date(Date.UTC(years[y], 3, 5 + randomInt(0, 20), 12));
        utimesSync(join(folder, path), when, when);
        specs.push({
          path,
          kind: ["md", "csv", "svg"][k],
          dir: names[d],
          year: y,
          tag: k === 0 ? tag : null,
        });
      }
      // Visual clusters: reddish and bluish noise images (same kind, so only appearance separates them).
      for (const [cluster, colour, count] of [
        ["warm", "0xd03a2c", 4],
        ["cool", "0x2c4fd0", 5],
      ])
        for (let i = 0; i < count; i++) {
          const path = `${cluster}-${nonce()}.png`;
          execFileSync("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            `color=c=${colour}:s=96x64,noise=alls=${randomInt(10, 24)}:allf=t+u:all_seed=${randomInt(1, 9999)}`,
            "-frames:v",
            "1",
            join(folder, path),
          ]);
          specs.push({ path, kind: "png", cluster });
        }
      git(folder, "init", "-q");
      git(folder, "add", ...specs.map((x) => x.path));
      git(folder, "commit", "-qm", "board corpus");
    } catch (e) {
      error = e.message;
    }
    const initialSnap = error ? null : snapshot(folder);
    let server,
      listed = [];
    try {
      assert(!error, error);
      server = await start(folder, join(f.temp, "board-small-state"));
      listed = await items(server);
      for (const x of specs) x.id = listed.find((i) => i.path === x.path)?.id;
      assert(
        specs.every((x) => x.id),
        "a seeded file is not listed by /api/items",
      );
      await request(server, "/api/board");
    } catch (e) {
      error = e.message;
    }
    const ids = (pred) => specs.filter(pred).map((x) => x.id);
    const parts = (key) => {
      const m = new Map();
      for (const x of specs.filter(
        (x) => x[key] !== undefined && x[key] !== null,
      ))
        m.set(x[key], [...(m.get(x[key]) || []), x.id]);
      return [...m.values()].map((a) => a.sort());
    };
    let b;
    try {
      b = error ? null : await browser();
    } catch (e) {
      error = e.message;
    }
    const arrange = async (by) => {
      const state = await request(server, "/api/board");
      await request(server, "/api/board", { ...state, arrange: { by } });
      await sleep(900);
      const got = await request(server, "/api/board");
      assert(got.arrange?.by === by, "mode was ignored: " + by);
      return got;
    };
    const homes = (board) => {
      const home = new Map();
      partitionOf(board).forEach((g, i) => g.forEach((id) => home.set(id, i)));
      return home;
    };
    // A group-by mode must produce exactly the groups the seeded data implies.
    let lastLayout = null;
    const relLayout = (g) => {
      const ids = Object.keys(g).sort(),
        o = g[ids[0]],
        w = g[ids[0]].w;
      return Object.fromEntries(
        ids.map((id) => [id, [(g[id].x - o.x) / w, (g[id].y - o.y) / w]]),
      );
    };
    const exact = (name, expected) => async () => {
      assert(!error, error);
      await b.goto(server.base + "/");
      const got = await arrange(name);
      const universe = new Set(expected.flat());
      const actual = partitionOf(got)
        .map((g) => g.filter((id) => universe.has(id)))
        .filter((g) => g.length);
      const want = expected
        .map((g) => [...g].sort())
        .sort((a, c) => a[0].localeCompare(c[0]));
      assert(
        canonical(actual) === canonical(want),
        `groups differ from the seeded ${name} partition: got ${actual.length} groups, expected ${want.length}`,
      );
      const c = cohesion(await geometry(b, [...universe]), want);
      assert(
        c.n >= universe.size * 0.9,
        `only ${c.n} of ${universe.size} items rendered`,
      );
      assert(
        c.ratio < 0.6,
        `items of one group are not placed together (intra/inter ${c.ratio.toFixed(2)})`,
      );
      const layout = relLayout(await geometry(b));
      if (lastLayout) {
        const moved = Object.keys(layout).filter(
          (id) =>
            lastLayout[id] &&
            Math.hypot(
              layout[id][0] - lastLayout[id][0],
              layout[id][1] - lastLayout[id][1],
            ) > 0.25,
        ).length;
        assert(
          moved >= Object.keys(layout).length * 0.4,
          `the layout barely changed from the previous mode (${moved} of ${Object.keys(layout).length} moved)`,
        );
      }
      lastLayout = layout;
      await evidence(b, "D4-" + name);
      return {
        ok: true,
        value: { groups: want.length, cohesion: +c.ratio.toFixed(2) },
      };
    };
    for (const [mode, key] of [
      ["kind", "kind"],
      ["folder", "dir"],
      ["date", "year"],
    ])
      await book.check(
        `arrange.${mode}`,
        "groups equal the seeded partition; group members are placed together",
        async () => exact(mode, parts(key))(),
        ["dream", "beat"],
      );
    await book.check(
      "arrange.similarity",
      "visual clusters land in separate pure groups and are placed together",
      async () => {
        assert(!error, error);
        await b.goto(server.base + "/");
        const got = await arrange("similarity");
        const images = specs.filter((x) => x.cluster);
        const ofImage = new Map(images.map((x) => [x.id, x.cluster]));
        const groups = partitionOf(got)
          .map((g) => g.filter((id) => ofImage.has(id)))
          .filter((g) => g.length);
        assert(
          groups.length >= 2,
          "similarity did not split warm from cool images",
        );
        for (const g of groups)
          assert(
            new Set(g.map((id) => ofImage.get(id))).size === 1,
            "a similarity group mixes warm and cool images",
          );
        const c = cohesion(
          await geometry(
            b,
            images.map((x) => x.id),
          ),
          [ids((x) => x.cluster === "warm"), ids((x) => x.cluster === "cool")],
        );
        assert(
          c.ratio < 0.6,
          `warm and cool images are not placed apart (ratio ${c.ratio.toFixed(2)})`,
        );
        return {
          ok: true,
          value: { groups: groups.length, cohesion: +c.ratio.toFixed(2) },
        };
      },
      ["dream"],
    );
    await book.check(
      "arrange.tag",
      "items sharing a front-matter tag share a group; different tags do not",
      async () => {
        assert(!error, error);
        const home = homes(await arrange("tag"));
        const md = specs.filter((x) => x.tag !== null);
        for (const x of md)
          assert(home.has(x.id), "tagged item missing from every group");
        for (const x of md)
          for (const y of md)
            assert(
              (home.get(x.id) === home.get(y.id)) === (x.tag === y.tag),
              "tag partition wrong",
            );
        return { ok: true, value: { tagged: md.length } };
      },
      ["dream", "beat"],
    );
    await book.check(
      "arrange.status",
      "status front matter splits items into groups",
      async () => {
        assert(!error, error);
        const home = homes(await arrange("status"));
        const md = specs.filter((x) => x.tag !== null);
        const groups = new Set(md.map((x) => home.get(x.id)));
        assert(!groups.has(undefined), "item missing from every group");
        assert(
          groups.size >= 2,
          "status produced one group for items with different statuses",
        );
        return { ok: true, value: { groups: groups.size } };
      },
      ["dream", "beat"],
    );
    await book.check(
      "arrange.run",
      "two agent runs' artifacts land in two groups",
      async () => {
        assert(!error, error);
        const make = async (n) => {
          const r = await request(server, "/api/runs", {
            name: "Run " + nonce(),
          });
          const id = r.id ?? r.run?.id;
          assert(id, "no run id");
          const out = [];
          for (let i = 0; i < n; i++) {
            const path = `run-${id}-${nonce()}.txt`;
            await request(
              server,
              `/api/runs/${encodeURIComponent(id)}/artifacts`,
              {
                path,
                content: "x " + nonce(),
                encoding: "utf8",
                kind: "txt",
              },
            );
            out.push(path);
          }
          return out;
        };
        const [r1, r2] = [await make(3), await make(3)];
        const now = await items(server);
        const idOf = (p) => now.find((i) => i.path === p)?.id;
        const home = homes(await arrange("run"));
        for (const p of r1)
          for (const q of r2)
            assert(
              home.get(idOf(p)) !== undefined &&
                home.get(idOf(p)) !== home.get(idOf(q)),
              "two runs share a group",
            );
        for (const p of r1.slice(1))
          assert(
            home.get(idOf(p)) === home.get(idOf(r1[0])),
            "one run split across groups",
          );
        return { ok: true, value: { runs: 2 } };
      },
      ["dream", "beat"],
    );
    await book.check(
      "arrange.meta",
      "any data column becomes a grouping (CSV 'label' column)",
      async () => {
        assert(!error, error);
        const home = homes(await arrange("meta.label"));
        const csv = specs.filter((x) => x.kind === "csv");
        assert(
          csv.every((x) => home.has(x.id)),
          "csv items missing from groups",
        );
        assert(
          new Set(csv.map((x) => home.get(x.id))).size === csv.length,
          "distinct column values did not give distinct groups",
        );
        return { ok: true, value: { distinct: csv.length } };
      },
      ["dream"],
    );
    await book.check(
      "arrange.deterministic",
      "same mode from a different starting mode gives the same layout",
      async () => {
        assert(!error, error);
        await b.goto(server.base + "/");
        const norm = (g) => {
          const v = Object.values(g),
            mx = Math.min(...v.map((p) => p.x)),
            my = Math.min(...v.map((p) => p.y));
          return Object.fromEntries(
            Object.entries(g).map(([k, p]) => [
              k,
              [Math.round(p.x - mx), Math.round(p.y - my)],
            ]),
          );
        };
        await arrange("folder");
        const a = norm(await geometry(b));
        await arrange("date");
        await arrange("folder");
        const c = norm(await geometry(b));
        assert(
          Object.keys(a).length > 0 && canonical(a) === canonical(c),
          "layout differs between identical arranges",
        );
        return { ok: true, value: { items: Object.keys(a).length } };
      },
    );
    await book.check(
      "pins.survive",
      "pinned items keep their place while the rest rearrange",
      async () => {
        assert(!error, error);
        const pin = specs
          .filter((x) => x.kind !== "png")
          .slice(0, 2)
          .map((x) => x.id);
        const free = specs.map((x) => x.id).filter((id) => !pin.includes(id));
        await request(server, "/api/board", {
          arrange: { by: "kind" },
          groups: [
            {
              id: nonce(),
              name: "Pinned " + nonce(),
              items: pin,
              pinned: true,
            },
          ],
          views: [],
        });
        await sleep(900);
        await b.goto(server.base + "/");
        await sleep(300);
        const rel = async () => {
          const g = await geometry(b);
          assert(g[pin[0]] && g[pin[1]], "pinned items are not rendered");
          const w = g[pin[0]].w;
          return {
            pair: [
              (g[pin[1]].x - g[pin[0]].x) / w,
              (g[pin[1]].y - g[pin[0]].y) / w,
            ],
            free: Object.fromEntries(
              free
                .filter((id) => g[id])
                .map((id) => [
                  id,
                  [(g[id].x - g[pin[0]].x) / w, (g[id].y - g[pin[0]].y) / w],
                ]),
            ),
          };
        };
        let before = await rel(),
          movedTotal = 0;
        for (const mode of ["folder", "date", "kind"]) {
          const state = await request(server, "/api/board");
          await request(server, "/api/board", {
            ...state,
            arrange: { by: mode },
          });
          await sleep(900);
          const now = await rel();
          assert(
            Math.hypot(
              now.pair[0] - before.pair[0],
              now.pair[1] - before.pair[1],
            ) < 0.05,
            "pinned items moved relative to each other",
          );
          const moved = Object.keys(before.free).filter(
            (id) =>
              now.free[id] &&
              Math.hypot(
                now.free[id][0] - before.free[id][0],
                now.free[id][1] - before.free[id][1],
              ) > 0.25,
          ).length;
          movedTotal += moved;
          assert(
            moved >= free.length * 0.3,
            `only ${moved} of ${free.length} unpinned items moved on ${mode}`,
          );
          before = now;
        }
        return { ok: true, value: { pinned: 2, movedTotal } };
      },
      ["dream", "beat"],
    );
    await book.check(
      "transition.smooth",
      "items glide between layouts: intermediate positions, none vanish",
      async () => {
        assert(!error, error);
        await request(server, "/api/board", {
          arrange: { by: "kind" },
          groups: [],
          views: [],
        });
        await b.goto(server.base + "/");
        await sleep(900);
        const all = specs.map((x) => x.id);
        const filmed = await film(b, all, () =>
          request(server, "/api/board", {
            arrange: { by: "folder" },
            groups: [],
            views: [],
          }),
        );
        const j = judgeFilm(filmed, all);
        return {
          ok:
            j.moved >= all.length * 0.4 &&
            j.smooth >= j.moved * 0.6 &&
            j.dropped === 0,
          value: j,
        };
      },
      ["dream"],
    );
    await book.check(
      "roundtrip",
      "nested groups, manual pin and saved view round-trip, including after restart",
      async () => {
        assert(!error, error);
        const ids6 = specs.slice(0, 6).map((x) => x.id),
          groupId = nonce();
        const expected = {
          arrange: { by: "kind" },
          groups: [
            {
              id: groupId,
              name: "Orbit " + nonce(),
              items: ids6.slice(0, 3),
              pinned: true,
              groups: [
                {
                  id: nonce(),
                  name: "Detail " + nonce(),
                  items: ids6.slice(3),
                },
              ],
            },
          ],
          views: [
            {
              id: nonce(),
              name: "Review " + nonce(),
              arrange: { by: "folder" },
              groups: [groupId],
            },
          ],
        };
        await request(server, "/api/board", expected);
        const check = async (sv, why) => {
          const got = await request(sv, "/api/board");
          for (const key of ["arrange", "groups", "views"])
            assert(
              samePosted(got[key], expected[key]),
              `${why}: ${key} differs`,
            );
        };
        await check(server, "round trip");
        await server.stop();
        server = await start(folder, join(f.temp, "board-small-state"));
        await check(server, "after restart");
        return { ok: true, value: { restart: true } };
      },
    );
    await book.check(
      "folder.clean",
      "git status including ignored/untracked stays clean after organizing",
      () => {
        assert(!error, error);
        const status = git(
          folder,
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--ignored",
        );
        return {
          ok:
            status === "" &&
            canonical(snapshot(folder)) === canonical(initialSnap),
          value: status || "clean",
        };
      },
    );
    await server?.stop().catch(() => {});
    await book.check(
      "thousand.animate",
      "1000 items: groups equal the per-kind counts, cards show content, transitions glide at p95 frame <16.7 ms",
      async () => {
        assert(!error, error);
        const big = join(f.temp, "board-1000");
        await stress(big, { mixed: true, large: false, seed: f.seed });
        const sv = await start(big, join(f.temp, "board-1000-state"));
        try {
          const all = await items(sv);
          assert(all.length === 1000, "not all 1000 items listed");
          await b.goto(sv.base + "/");
          await request(sv, "/api/board", {
            arrange: { by: "kind" },
            groups: [],
            views: [],
          });
          await sleep(1200);
          const got = await request(sv, "/api/board");
          const counts = new Map();
          for (const i of all)
            counts.set(i.kind, (counts.get(i.kind) || 0) + 1);
          const sizes = partitionOf(got)
            .map((g) => g.length)
            .sort((x, y) => x - y);
          assert(
            canonical(sizes) ===
              canonical([...counts.values()].sort((x, y) => x - y)),
            "kind groups of 1000 items do not match per-kind counts",
          );
          const tracked = await b.eval(
            `[...document.querySelectorAll('[data-item-id]')].slice(0,80).map(e=>e.dataset.itemId)`,
          );
          assert(tracked.length >= 20, "fewer than 20 cards in the DOM");
          const filmed = await film(
            b,
            tracked,
            () =>
              request(sv, "/api/board", {
                arrange: { by: "folder" },
                groups: [],
                views: [],
              }),
            1400,
          );
          const j = judgeFilm(filmed, tracked);
          const content = await b.eval(
            `(()=>{const a=[...document.querySelectorAll('[data-item-id]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight});return{n:a.length,empty:a.filter(e=>!${CARD_CONTENT}(e)).length}})()`,
          );
          const frames = filmed.times.slice(3);
          const ok =
            frames.length >= 30 &&
            p95(frames) < FRAME_BUDGET &&
            j.moved >= 6 &&
            j.smooth >= j.moved * 0.5 &&
            j.dropped === 0 &&
            content.n > 0 &&
            content.empty / content.n < 0.05;
          return {
            ok,
            value: { p95: p95(frames), frames: frames.length, ...j, content },
          };
        } finally {
          await sv.stop();
          rmSync(big, { recursive: true, force: true });
        }
      },
    );
  });
}
if (entry(import.meta.url)) output(await measure());
