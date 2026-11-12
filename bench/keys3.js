import {
  run,
  items,
  request,
  assert,
  entry,
  output,
  key,
  typeKeys,
  palette,
  focusVisible,
  diffPng,
  nonce,
  canonical,
  snapshot,
  waitUntil,
  axe,
  evidence,
  sleep,
} from "./lib3/runtime.mjs";
import { shot } from "./lib3/semantic.mjs";
import { randomInt } from "node:crypto";
const VIS =
  "const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};";
import { mockComfy } from "./lib3/comfy.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
// Setup may use APIs; every interaction inside a journey is a physical CDP key event.
export const journeys = [
  ["open-folder", 160],
  ["find-item", 90],
  ["spatial-focus", 8],
  ["group", 110],
  ["color-target", 160],
  ["compare-variants", 130],
  ["approve-proposal", 90],
  ["reject-proposal", 90],
  ["generate", 100],
  ["arrange", 40],
  ["present", 30],
  ["help-rebind", 130],
];
export async function measure() {
  const mock = await mockComfy();
  try {
    return await run(
      "D3",
      async ({ book, f, s, browser }) => {
        let listed = [],
          error,
          b,
          selected,
          proposal,
          proposalPath,
          proposalText,
          rejected,
          rejectPath;
        try {
          b = await browser();
          await b.goto(s.base + "/");
          listed = await items(s);
        } catch (e) {
          error = e.message;
        }
        let count = 0;
        const cmd = async (text) => {
          count += text.length + 2;
          return palette(b, text);
        };
        const press = async (k, m = 0) => {
          count++;
          await key(b, k, m);
        };
        const journey = async (id, fn) => {
          const budget = journeys.find((x) => x[0] === id)[1];
          await book.check(
            "journey." + id,
            `keys only; ≤${budget} keystrokes; disk/API outcome; visible focus`,
            async () => {
              assert(!error, error);
              count = 0;
              const before = await b.screenshot();
              await fn();
              assert(count <= budget, `${count} keystrokes exceeds ${budget}`);
              assert(await focusVisible(b), "keyboard focus is not visible");
              const after = await b.screenshot();
              const diff = diffPng(before, after);
              assert(diff.differing > 0, "no screenshot change after journey");
              await evidence(b, "D3-" + id);
              return {
                ok: true,
                value: {
                  keystrokes: count,
                  budget,
                  pixelsChanged: diff.differing,
                },
              };
            },
          );
        };
        await journey("open-folder", async () => {
          // The command must actually switch folders; reopening the initial folder proves nothing.
          const alternate = join(f.temp, "other");
          mkdirSync(alternate);
          const path = "Opened-" + nonce() + ".html",
            token = "Opened " + nonce();
          writeFileSync(
            join(alternate, path),
            `<!doctype html><h1>${token}</h1>`,
          );
          await cmd("Open folder " + alternate);
          await waitUntil(async () => {
            const a = await items(s);
            return (
              a.some((x) => x.path === path) &&
              !a.some((x) => x.path === f.files[0].path)
            );
          });
          await cmd("Open folder " + f.folder);
          await waitUntil(
            async () => (await items(s)).length === f.files.length,
          );
          assert(
            readFileSync(join(alternate, path), "utf8").includes(token),
            "opened source changed",
          );
        });
        await journey("find-item", async () => {
          selected = listed.find((x) => x.kind === "html");
          assert(selected, "no HTML item");
          await cmd("Select " + selected.path);
          const state = await request(s, "/api/board");
          assert(
            state.selection?.includes(selected.id),
            "item selection not reflected by API",
          );
        });
        await journey("spatial-focus", async () => {
          const before = await request(s, "/api/board");
          assert(
            before.selection?.length === 1,
            "need single focused selection",
          );
          const geometry = await b.eval(
            `Object.fromEntries([...document.querySelectorAll('[data-item-id]')].map(e=>{const r=e.getBoundingClientRect();return[e.dataset.itemId,{x:r.x+r.width/2,y:r.y+r.height/2}]}))`,
          );
          const current = geometry[before.selection[0]];
          assert(current, "focused item geometry absent");
          const candidates = Object.entries(geometry)
            .filter(([id, p]) => p.x > current.x + 1)
            .sort((a, b) => {
              const score = (p) =>
                Math.hypot(p.x - current.x, p.y - current.y) +
                Math.abs(p.y - current.y);
              return score(a[1]) - score(b[1]);
            });
          assert(candidates.length, "no rightward spatial neighbor");
          await press("ArrowRight");
          const after = await request(s, "/api/board");
          assert(
            after.selection?.[0] === candidates[0][0],
            "ArrowRight did not choose nearest geometric neighbor",
          );
        });
        await journey("group", async () => {
          const name = "Group " + nonce();
          await press("ArrowLeft");
          await press("ArrowRight", 8);
          await cmd("Group " + name);
          const board = await request(s, "/api/board");
          const group = board.groups.find((x) => x.name === name);
          assert(
            group?.items?.length >= 2,
            "keys did not group multiple real items",
          );
          assert(
            await b.eval(
              `(()=>{${VIS}return [...document.querySelectorAll('*')].some(e=>vis(e)&&e.children.length===0&&e.textContent.includes(${JSON.stringify(name)}))})()`,
            ),
            "the new group's name is not shown on the canvas",
          );
          assert(
            canonical(snapshot(f.folder)) === canonical(f.initial),
            "grouping dirtied folder",
          );
        });
        await journey("color-target", async () => {
          assert(selected, "no selected HTML");
          await cmd("Select " + selected.path);
          const schema = await request(
              s,
              "/api/controls/" + encodeURIComponent(selected.id),
            ),
            c = schema.sections
              ?.flatMap((x) => x.controls)
              .find((c) => /color/i.test(c.type));
          assert(c, "no color instrument");
          const target = "#" + nonce().slice(0, 6);
          await cmd("Control " + c.label);
          await press("a", 2);
          for (const ch of target) {
            await press(ch);
          }
          await press("Enter");
          const got = await request(
            s,
            "/api/controls/" + encodeURIComponent(selected.id),
          );
          assert(
            got.sections.flatMap((x) => x.controls).find((x) => x.id === c.id)
              ?.value === target,
            "color API did not reach exact target",
          );
          assert(
            Object.values(snapshot(f.folder)).some(
              (h) => !Object.values(f.initial).includes(h),
            ),
            "target color did not write file bytes",
          );
          assert(
            readFileSync(join(f.folder, selected.path), "utf8").includes(
              target,
            ),
            "target color absent from source",
          );
        });
        await journey("compare-variants", async () => {
          const component = listed.find((x) => x.kind === "tsx");
          assert(component, "no typed variant specimen");
          await cmd("Compare variants " + component.path);
          const board = await request(s, "/api/board");
          assert(
            board.compare?.item === component.id &&
              board.compare?.variants?.length >= 2,
            "variant comparison is not represented in API",
          );
          const boxes = await b.eval(
            `(()=>{${VIS}return [...document.querySelectorAll('[data-variant]')].filter(vis).map(e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})})()`,
          );
          assert(
            boxes.length >= 2,
            "fewer than two variants are shown side by side",
          );
          const sh = await shot(b);
          assert(
            boxes[0].x !== boxes[1].x || boxes[0].y !== boxes[1].y,
            "variants overlap",
          );
          const cut = (r) => ({
            ...r,
            w: Math.min(r.w, 120),
            h: Math.min(r.h, 80),
          });
          let distinct = 0;
          const [ra, rb] = [cut(boxes[0]), cut(boxes[1])];
          for (let y = 0; y < ra.h; y += 2)
            for (let x = 0; x < ra.w; x += 2) {
              const i = ((ra.y + y) * sh.width + ra.x + x) * 4,
                j = ((rb.y + y) * sh.width + rb.x + x) * 4;
              if (
                Math.abs(sh.data[i] - sh.data[j]) +
                  Math.abs(sh.data[i + 1] - sh.data[j + 1]) +
                  Math.abs(sh.data[i + 2] - sh.data[j + 2]) >
                30
              )
                distinct++;
            }
          assert(distinct > 20, "the shown variants look identical");
          const source = readFileSync(join(f.folder, component.path), "utf8");
          assert(source.includes("Orbit"), "comparison lost source file");
        });
        // Proposals are prepared through the public API; they must remain isolated until a journey reviews them.
        if (!error)
          try {
            proposalPath = "approved-" + nonce() + ".txt";
            proposalText = "Approved " + nonce();
            proposal = await request(s, "/api/proposals", {
              path: proposalPath,
              content: proposalText,
            });
            rejectPath = "rejected-" + nonce() + ".txt";
            rejected = await request(s, "/api/proposals", {
              path: rejectPath,
              content: "Rejected " + nonce(),
            });
          } catch (e) {
            proposal = { error: e.message };
            rejected = proposal;
          }
        await journey("approve-proposal", async () => {
          assert(
            proposal && !proposal.error,
            proposal?.error || "proposal setup failed",
          );
          const id = proposal.id ?? proposal.proposal;
          assert(
            await b.eval(
              `!![...document.querySelectorAll('[data-proposal-id]')].find(e=>e.dataset.proposalId===${JSON.stringify(id)}&&e.getBoundingClientRect().width>0)`,
            ),
            "the proposal is not in the review queue on screen",
          );
          await cmd("Approve " + id);
          await sleep(200);
          assert(
            await b.eval(
              `![...document.querySelectorAll('[data-proposal-id]')].some(e=>e.dataset.proposalId===${JSON.stringify(id)}&&e.getBoundingClientRect().width>0)`,
            ),
            "an approved proposal is still in the review queue",
          );
          await waitUntil(() => {
            try {
              return (
                readFileSync(join(f.folder, proposalPath), "utf8") ===
                proposalText
              );
            } catch {
              return false;
            }
          });
          const events = await request(
            s,
            "/api/proposals/" + encodeURIComponent(id),
          );
          assert(events.status === "accepted", "proposal outcome not accepted");
        });
        await journey("reject-proposal", async () => {
          assert(
            rejected && !rejected.error,
            rejected?.error || "proposal setup failed",
          );
          const before = snapshot(f.folder),
            id = rejected.id ?? rejected.proposal;
          assert(
            await b.eval(
              `!![...document.querySelectorAll('[data-proposal-id]')].find(e=>e.dataset.proposalId===${JSON.stringify(id)}&&e.getBoundingClientRect().width>0)`,
            ),
            "the proposal is not in the review queue on screen",
          );
          await cmd("Reject " + id);
          await sleep(200);
          assert(
            await b.eval(
              `![...document.querySelectorAll('[data-proposal-id]')].some(e=>e.dataset.proposalId===${JSON.stringify(id)}&&e.getBoundingClientRect().width>0)`,
            ),
            "a rejected proposal is still in the review queue",
          );
          const got = await request(
            s,
            "/api/proposals/" + encodeURIComponent(id),
          );
          assert(got.status === "rejected", "proposal outcome not rejected");
          assert(
            canonical(snapshot(f.folder)) === canonical(before),
            "reject wrote source files",
          );
        });
        await journey("generate", async () => {
          const workflow = listed.find(
            (x) =>
              x.path ===
              f.files.find((x) => x.original === "workflow.api.json").path,
          );
          assert(workflow, "no workflow");
          const before = new Set((await items(s)).map((x) => x.id));
          await cmd("Generate " + workflow.path);
          await waitUntil(() => mock.prompts.length > 0);
          const result = await waitUntil(async () =>
            (await items(s)).find(
              (x) => !before.has(x.id) && x.meta?.provenance,
            ),
          );
          assert(
            await b.eval(
              `!![...document.querySelectorAll('[data-item-id]')].find(e=>e.dataset.itemId===${JSON.stringify(result.id)}&&e.getBoundingClientRect().width>0)`,
            ),
            "the generated result is not on the canvas",
          );
          assert(
            readFileSync(join(f.folder, result.path)).equals(
              readFileSync(new URL("./corpus3/spectrum.png", import.meta.url)),
            ),
            "generation result bytes differ",
          );
        });
        await journey("arrange", async () => {
          await cmd("Arrange by kind");
          const state = await request(s, "/api/board");
          assert(
            state.arrange?.by === "kind" && state.groups?.length,
            "arrange command did not change API state",
          );
          await sleep(800);
          const labels = await b.eval(
            `(()=>{${VIS}return[...document.querySelectorAll('[data-group-id],[data-group]')].filter(vis).map(e=>e.textContent)})()`,
          );
          assert(
            state.groups
              .filter((g) => g.name)
              .every((g) => labels.some((t) => t.includes(g.name))),
            "arranged group names are not drawn on the canvas",
          );
        });
        await journey("present", async () => {
          await cmd("Present");
          const state = await request(s, "/api/board");
          assert(
            state.presentation === true,
            "presentation state missing from API",
          );
          const shown = await b.eval(
            `(()=>{const e=document.querySelector('[data-presenting],[data-presentation]');if(!e&&!document.fullscreenElement)return null;const t=e||document.fullscreenElement;const r=t.getBoundingClientRect();return r.width*r.height/(innerWidth*innerHeight)})()`,
          );
          assert(
            shown !== null && shown >= 0.7,
            `presentation does not take over the screen (${shown})`,
          );
          await press("Escape");
          const after = await request(s, "/api/board");
          assert(
            after.presentation === false,
            "Escape failed to exit presentation",
          );
        });
        await journey("help-rebind", async () => {
          await press("?");
          const map = await request(s, "/api/keys");
          assert(
            Array.isArray(map.bindings) && map.bindings.length,
            "real key map unavailable",
          );
          const overlay = await b.eval(
            `(()=>{const e=document.querySelector('[role=dialog],[data-keymap]');return e&&e.getBoundingClientRect().width>0?e.innerText:null})()`,
          );
          assert(overlay, "? shows no key map on screen");
          const listed = map.bindings.filter(
            (x) =>
              overlay.includes(x.keys) ||
              overlay.toLowerCase().includes(String(x.keys).toLowerCase()),
          ).length;
          assert(
            listed >= map.bindings.length * 0.9,
            `key map shows ${listed} of ${map.bindings.length} real bindings`,
          );
          const binding = map.bindings.find((x) =>
            /arrange.*kind/i.test(x.command),
          );
          assert(binding, "arrange-by-kind command missing in real bindings");
          await press("Escape");
          // Precondition: move away from "kind" so the rebound key has something to change.
          await cmd("Arrange by folder");
          assert(
            (await request(s, "/api/board")).arrange?.by === "folder",
            "could not move away from kind",
          );
          await cmd("Rebind " + binding.command + " to Alt+Y");
          await press("y", 1);
          const board = await request(s, "/api/board");
          assert(
            board.arrange?.by === "kind",
            "rebound key did not run command",
          );
          const after = await request(s, "/api/keys");
          assert(
            after.bindings.some(
              (x) => x.command === binding.command && x.keys === "Alt+Y",
            ),
            "binding did not persist in API",
          );
          await press("?");
          assert(
            (
              await b.eval(
                `document.querySelector('[role=dialog],[data-keymap]')?.innerText||''`,
              )
            ).includes("Alt+Y"),
            "the key map does not show the new binding",
          );
          await press("Escape");
        });
        await book.check(
          "axe.zero",
          "0 axe violations on the populated canvas, with the palette open and with the key map open",
          async () => {
            assert(!error, error);
            assert(b, "Chromium unavailable");
            await b.goto(s.base + "/");
            await sleep(500);
            const cards = await b.eval(
              "document.querySelectorAll('[data-item-id]').length",
            );
            assert(
              cards >= 5,
              `axe on an empty or missing canvas proves nothing (${cards} cards)`,
            );
            const found = { canvas: await axe(b) };
            await key(b, "k", 2);
            assert(
              await b.eval(
                "!![...document.querySelectorAll('[role=dialog],[role=combobox],[role=listbox],input')].find(e=>e.getBoundingClientRect().width>0)",
              ),
              "palette did not open",
            );
            found.palette = await axe(b);
            await key(b, "Escape");
            await key(b, "?");
            found.keymap = await axe(b);
            await key(b, "Escape");
            const all = Object.values(found).flat();
            return { ok: all.length === 0, value: { cards, found } };
          },
        );
        await book.check(
          "commands.reachable",
          "100% advertised commands have bindings or palette paths, and the palette really lists a random sample",
          async () => {
            assert(!error, error);
            const map = await request(s, "/api/keys");
            assert(map.commands?.length, "commands registry missing");
            const unreachable = map.commands.filter(
              (c) =>
                !map.bindings.some((b) => b.command === c.id) && !c.palette,
            );
            const viaPalette = map.commands.filter((c) => c.palette && c.label);
            const sample = Array.from(
              { length: Math.min(10, viaPalette.length) },
              () => viaPalette[randomInt(0, viaPalette.length)],
            );
            const missing = [];
            for (const c of sample) {
              await key(b, "k", 2);
              await typeKeys(b, c.label);
              await sleep(120);
              const ok = await b.eval(
                `[...document.querySelectorAll('[role=option],[data-palette-result]')].some(e=>e.getBoundingClientRect().width>0&&e.innerText.toLowerCase().includes(${JSON.stringify(String(c.label).toLowerCase())}))`,
              );
              if (!ok) missing.push(c.id);
              await key(b, "Escape");
            }
            return {
              ok:
                unreachable.length === 0 &&
                missing.length === 0 &&
                sample.length > 0,
              value: {
                unreachable,
                notInPalette: missing,
                sampled: sample.length,
              },
            };
          },
        );
      },
      { env: { NAPKIN_COMFY_URL: mock.url } },
    );
  } finally {
    await mock.close();
  }
}
if (entry(import.meta.url)) output(await measure());
