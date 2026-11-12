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
          await cmd("Approve " + id);
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
          await cmd("Reject " + id);
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
        });
        await journey("present", async () => {
          await cmd("Present");
          const state = await request(s, "/api/board");
          assert(
            state.presentation === true,
            "presentation state missing from API",
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
          const binding = map.bindings.find((x) =>
            /arrange.*kind/i.test(x.command),
          );
          assert(binding, "arrange-by-kind command missing in real bindings");
          await press("Escape");
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
        });
        await book.check("axe.zero", "0 axe violations", async () => {
          assert(b, "Chromium unavailable");
          const violations = await axe(b);
          return { ok: violations.length === 0, value: violations };
        });
        await book.check(
          "commands.reachable",
          "100% advertised commands have keyboard bindings or palette paths",
          async () => {
            assert(!error, error);
            const map = await request(s, "/api/keys");
            assert(map.commands?.length, "commands registry missing");
            const unreachable = map.commands.filter(
              (c) =>
                !map.bindings.some((b) => b.command === c.id) && !c.palette,
            );
            return { ok: unreachable.length === 0, value: unreachable };
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
