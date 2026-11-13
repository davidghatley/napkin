import {
  run,
  items,
  request,
  assert,
  entry,
  output,
  nonce,
  canonical,
  eventStream,
  waitUntil,
  sleep,
  evidence,
} from "./lib3/runtime.mjs";
import { mockComfy } from "./lib3/comfy.mjs";
import { createHash, randomInt } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
export async function measure() {
  const mock = await mockComfy();
  try {
    return await run(
      "D6",
      async ({ book, f, s, browser, restart }) => {
        let listed, error, stream, workflow, job, first, outputItem;
        const seed = f.seed;
        try {
          listed = await items(s);
          workflow = listed.find(
            (x) =>
              x.path ===
              f.files.find((x) => x.original === "workflow.api.json").path,
          );
          assert(workflow, "workflow missing");
        } catch (e) {
          error = e.message;
        }
        await book.check(
          "workflow.instruments",
          "workflow inputs derived from discovered ComfyUI node schemas",
          async () => {
            assert(!error, error);
            const schema = await request(
              s,
              "/api/controls/" + encodeURIComponent(workflow.id),
            );
            const controls = schema.sections?.flatMap((x) => x.controls) || [];
            assert(
              controls.some((c) => /image/i.test(c.id + " " + c.label)) &&
                controls.some((c) => /prefix/i.test(c.id + " " + c.label)),
              "workflow image and prefix instruments missing",
            );
            assert(
              mock.requests.some((x) => x.path.startsWith("/object_info")),
              "backend schema never discovered",
            );
            return { ok: true, value: { controls: controls.map((c) => c.id) } };
          },
        );
        await book.check(
          "workflow.schema-random",
          "a custom node invented at bench time becomes instruments with exactly its min, max, step, default and options",
          async () => {
            assert(!error, error);
            const tag = nonce().slice(0, 6),
              lo = randomInt(2, 20),
              hi = lo + randomInt(30, 400),
              dflt = lo + randomInt(1, 20),
              step = [1, 2, 5][randomInt(0, 3)],
              opts = Array.from(
                { length: 3 },
                () => "mode-" + nonce().slice(0, 4),
              ),
              scale = +(0.1 + randomInt(0, 80) / 100).toFixed(2);
            const src = "Probe" + tag,
              sink = "Sink" + tag;
            mock.addNode(
              src,
              {
                ["strength_" + tag]: [
                  "INT",
                  { default: dflt, min: lo, max: hi, step },
                ],
                ["scale_" + tag]: [
                  "FLOAT",
                  { default: scale, min: 0, max: 2, step: 0.01 },
                ],
                ["mode_" + tag]: [opts],
                ["flag_" + tag]: ["BOOLEAN", { default: false }],
              },
              ["IMAGE"],
            );
            mock.addNode(
              sink,
              {
                images: ["IMAGE"],
                filename_prefix: ["STRING", { default: "p" }],
              },
              [],
              true,
            );
            const graph = {
              1: {
                class_type: src,
                inputs: {
                  ["strength_" + tag]: dflt,
                  ["scale_" + tag]: scale,
                  ["mode_" + tag]: opts[0],
                  ["flag_" + tag]: false,
                },
              },
              2: {
                class_type: sink,
                inputs: { images: ["1", 0], filename_prefix: "probe-" + tag },
              },
            };
            const path = "probe-" + tag + ".json";
            writeFileSync(join(f.folder, path), JSON.stringify(graph));
            const wf = await waitUntil(async () =>
              (await items(s)).find((x) => x.path === path),
            );
            const schema = await request(
              s,
              "/api/controls/" + encodeURIComponent(wf.id),
            );
            const controls = schema.sections?.flatMap((x) => x.controls) || [];
            const find = (n) =>
              controls.find((c) =>
                (c.id + " " + c.label).includes(n + "_" + tag),
              );
            const st = find("strength"),
              sc = find("scale"),
              mo = find("mode"),
              fl = find("flag");
            assert(
              st && sc && mo && fl,
              "controls for the invented node are missing: " +
                controls.map((c) => c.id),
            );
            assert(
              st.min === lo &&
                st.max === hi &&
                (st.step ?? step) === step &&
                st.value === dflt,
              `strength control does not mirror the schema (${JSON.stringify(st)})`,
            );
            assert(
              sc.min === 0 && sc.max === 2 && sc.value === scale,
              "scale control does not mirror the schema",
            );
            const got = (mo.options || []).map((o) => o.value ?? o);
            assert(
              canonical(got) === canonical(opts),
              "mode options differ from the schema: " + got,
            );
            assert(typeof fl.value === "boolean", "flag is not boolean");
            const before = mock.prompts.length;
            let rejected = false;
            try {
              const r = await request(s, "/api/generate", {
                workflow: wf.id,
                inputs: { ["1.strength_" + tag]: hi + 1 },
              });
              rejected = !r.job;
            } catch {
              rejected = true;
            }
            await sleep(300);
            assert(
              rejected || mock.prompts.length === before,
              "an out-of-range value was queued",
            );
            assert(
              mock.prompts.length === before,
              "an out-of-range value reached the backend",
            );
            return { ok: true, value: { lo, hi, step, opts: opts.length } };
          },
        );
        await book.check(
          "negative.invalid-prompt",
          "a workflow the backend rejects shows an error and queues nothing",
          async () => {
            assert(!error, error);
            const path = "bad-" + nonce() + ".json";
            writeFileSync(
              join(f.folder, path),
              JSON.stringify({
                1: {
                  class_type: "SaveImage",
                  inputs: { images: 42, filename_prefix: "x" },
                },
              }),
            );
            const wf = await waitUntil(async () =>
              (await items(s)).find((x) => x.path === path),
            );
            const before = mock.prompts.length;
            let r;
            try {
              r = await request(s, "/api/generate", {
                workflow: wf.id,
                inputs: {},
              });
            } catch {
              r = { rejected: true };
            }
            await sleep(300);
            assert(
              r.rejected || r.ok === false || !r.job,
              "an invalid workflow was accepted as a job",
            );
            assert(
              mock.prompts.length === before,
              "an invalid workflow was queued",
            );
            return { ok: true, value: { rejected: true } };
          },
        );
        await book.check(
          "queue.placeholder-progress",
          "queued placeholder, multiple stage events, then exact result bytes",
          async () => {
            assert(!error, error);
            stream = await eventStream(s);
            const before = new Set((await items(s)).map((x) => x.id));
            const inputs = { "2.filename_prefix": "orbit-" + nonce() };
            const r = await request(s, "/api/generate", {
              workflow: workflow.id,
              inputs,
            });
            job = r.job;
            assert(job, "no job id");
            assert(
              mock.prompts.length === 1,
              "Generate must queue one /prompt",
            );
            first = mock.prompts[0].body;
            assert(
              first.prompt["2"].inputs.filename_prefix ===
                inputs["2.filename_prefix"],
              "instrument input missing in backend prompt",
            );
            const placeholder = (await items(s)).find(
              (x) => !before.has(x.id) && JSON.stringify(x.meta).includes(job),
            );
            assert(placeholder, "no queued placeholder item");
            await waitUntil(() => Object.keys(mock.history).length === 1);
            await waitUntil(() => mock.served.length > 0);
            outputItem = await waitUntil(async () => {
              const a = await items(s);
              return a.find(
                (x) =>
                  !before.has(x.id) && x.kind === "png" && x.meta?.provenance,
              );
            });
            assert(
              readFileSync(join(f.folder, outputItem.path)).equals(
                readFileSync(
                  join(
                    new URL(".", import.meta.url).pathname,
                    "corpus3/spectrum.png",
                  ),
                ),
              ),
              "result bytes do not match /view output",
            );
            const stages = stream.events.filter((e) =>
              JSON.stringify(e.value).includes(job),
            );
            assert(
              stages.length >= 3,
              "not enough matching queued/progress/completed events",
            );
            const pid = mock.prompts[0].id;
            const sent = mock.progress.filter(
              (x) => x.type === "progress" && x.data.prompt_id === pid,
            );
            const forwarded = new Set();
            const walk = (v) => {
              if (Array.isArray(v)) return v.forEach(walk);
              if (v && typeof v === "object") {
                if (typeof v.value === "number" && typeof v.max === "number")
                  forwarded.add(`${v.node ?? ""}:${v.value}/${v.max}`);
                Object.values(v).forEach(walk);
              } else if (typeof v === "string") {
                try {
                  walk(JSON.parse(v));
                } catch {}
              }
            };
            stream.events.forEach((e) => walk(e.value));
            const want = sent.map(
              (x) => `${x.data.node}:${x.data.value}/${x.data.max}`,
            );
            const hit = want.filter(
              (w) =>
                forwarded.has(w) || forwarded.has(w.replace(/^[^:]*:/, ":")),
            );
            assert(
              want.length >= mock.steps && hit.length >= want.length * 0.6,
              `progress is not forwarded from the backend websocket (${hit.length} of ${want.length} backend steps of ${mock.steps} seen)`,
            );
            assert(
              new Set(
                stages.map(
                  (e) => e.value.type ?? e.value.stage ?? e.value.status,
                ),
              ).size >= 3,
              "stage progress never changed",
            );
            const b = await browser();
            await b.goto(s.base + "/");
            await evidence(b, "D6-result");
            return {
              ok: true,
              value: {
                job,
                events: stages.length,
                backend: mock.progress.map((x) => x.type),
              },
            };
          },
        );
        await book.check(
          "provenance.reopen",
          "output retains exact workflow + inputs; reopen generates identical backend prompt",
          async () => {
            assert(outputItem && first, "no generation output");
            const p = outputItem.meta.provenance;
            assert(
              p.workflow && p.inputs,
              "workflow and inputs absent from provenance",
            );
            assert(
              p.inputs?.["2.filename_prefix"] ===
                first.prompt["2"].inputs.filename_prefix,
              "provenance inputs differ from what was generated",
            );
            // A fresh process must rebuild the request from the output's own file/metadata.
            s = await restart();
            const again = (await items(s)).find(
              (x) => x.path === outputItem.path,
            );
            assert(
              again?.meta?.provenance,
              "provenance is lost across a restart",
            );
            const count = mock.prompts.length;
            await request(s, "/api/generate", {
              workflow: outputItem.id,
              inputs: {},
            });
            await waitUntil(() => mock.prompts.length === count + 1);
            assert(
              canonical(first.prompt) ===
                canonical(mock.prompts.at(-1).body.prompt),
              "reopened request differs",
            );
            return { ok: true, value: { identical: true } };
          },
        );
        await book.check(
          "seed-and-sweep",
          "seed round-trips; 2×2 grid over any two sampler parameters",
          async () => {
            assert(!error, error);
            // Valid standard sampler graph, with an unpredictable model name offered by this mock.
            const model = Object.keys(mock.objectInfo).includes(
              "CheckpointLoaderSimple",
            )
              ? mock.objectInfo.CheckpointLoaderSimple.input.required
                  .ckpt_name[0][0]
              : null;
            assert(model, "mock sampler model schema unavailable");
            const graph = {
              1: {
                class_type: "CheckpointLoaderSimple",
                inputs: { ckpt_name: model },
              },
              2: {
                class_type: "EmptyLatentImage",
                inputs: { width: 160, height: 128, batch_size: 1 },
              },
              3: {
                class_type: "KSampler",
                inputs: {
                  model: ["1", 0],
                  positive: ["4", 0],
                  negative: ["5", 0],
                  latent_image: ["2", 0],
                  seed,
                  steps: 4,
                  cfg: 1.5,
                  sampler_name: "euler",
                  scheduler: "normal",
                  denoise: 1,
                },
              },
              4: {
                class_type: "CLIPTextEncode",
                inputs: { text: "Orbit " + nonce(), clip: ["1", 1] },
              },
              5: {
                class_type: "CLIPTextEncode",
                inputs: { text: "", clip: ["1", 1] },
              },
              6: {
                class_type: "VAEDecode",
                inputs: { samples: ["3", 0], vae: ["1", 2] },
              },
              7: {
                class_type: "SaveImage",
                inputs: {
                  images: ["6", 0],
                  filename_prefix: "sweep-" + nonce(),
                },
              },
            };
            const path = "sweep-" + nonce() + ".json";
            writeFileSync(join(f.folder, path), JSON.stringify(graph));
            const wf = await waitUntil(async () =>
              (await items(s)).find((x) => x.path === path),
            );
            const at = mock.prompts.length;
            const seeds = [seed, seed + 1 + randomInt(0, 50)],
              cfgs = [
                +(1.5 + randomInt(0, 9) / 10).toFixed(1),
                +(3 + randomInt(0, 9) / 10).toFixed(1),
              ];
            await request(s, "/api/generate", {
              workflow: wf.id,
              inputs: { "3.seed": seeds, "3.cfg": cfgs },
            });
            await waitUntil(() => mock.prompts.length === at + 4);
            await sleep(400);
            assert(
              mock.prompts.length === at + 4,
              "the grid queued more than 4 jobs",
            );
            const prompts = mock.prompts.slice(at);
            const pairs = prompts
              .map(
                (x) =>
                  `${x.body.prompt["3"].inputs.seed}:${x.body.prompt["3"].inputs.cfg}`,
              )
              .sort();
            const wantPairs = seeds
              .flatMap((a) => cfgs.map((c) => `${a}:${c}`))
              .sort();
            assert(
              canonical(pairs) === canonical(wantPairs),
              `grid is ${pairs} not ${wantPairs}`,
            );
            for (const x of prompts) {
              const rest = structuredClone(x.body.prompt);
              delete rest["3"].inputs.seed;
              delete rest["3"].inputs.cfg;
              const base = structuredClone(graph);
              delete base["3"].inputs.seed;
              delete base["3"].inputs.cfg;
              assert(
                canonical(rest) === canonical(base),
                "a grid cell changed something other than the two swept inputs",
              );
            }
            await waitUntil(async () => {
              const a = await items(s);
              return (
                a.filter(
                  (x) =>
                    x.meta?.provenance &&
                    JSON.stringify(x.meta.provenance).includes(path),
                ).length >= 4
              );
            });
            return { ok: true, value: { seed, grid: 4 } };
          },
        );
        await book.check(
          "outputs.multimedia",
          "video, audio and 3D use the same queue/result/provenance path",
          async () => {
            assert(!error, error);
            assert(
              mock.objectInfo.LoadAudio &&
                mock.objectInfo.LoadVideo &&
                mock.objectInfo.Load3D,
              "mock multimedia schemas unavailable",
            );
            const results = [];
            for (const [load, save, key, name, kind] of [
              ["LoadAudio", "SaveAudio", "audio", "tone.wav", "flac"],
              ["LoadVideo", "SaveVideo", "video", "orbit.mp4", "mp4"],
              ["Load3D", "SaveGLB", "mesh", "triangle.glb", "glb"],
            ]) {
              const graph = {
                1: {
                  class_type: load,
                  inputs: {
                    [load === "Load3D"
                      ? "model_file"
                      : load === "LoadVideo"
                        ? "file"
                        : "audio"]: name,
                  },
                },
                2: {
                  class_type: save,
                  inputs: {
                    [key]: ["1", load === "Load3D" ? 6 : 0],
                    filename_prefix: "media-" + nonce(),
                    ...(save === "SaveVideo"
                      ? { format: "auto", "format.codec": "auto" }
                      : {}),
                  },
                },
              };
              if (load === "Load3D")
                Object.assign(graph["1"].inputs, {
                  image: "",
                  width: 160,
                  height: 128,
                });
              const path = "media-" + nonce() + ".json";
              writeFileSync(join(f.folder, path), JSON.stringify(graph));
              const wf = await waitUntil(async () =>
                (await items(s)).find((x) => x.path === path),
              );
              const before = new Set((await items(s)).map((x) => x.id));
              await request(s, "/api/generate", {
                workflow: wf.id,
                inputs: {},
              });
              const item = await waitUntil(async () =>
                (await items(s)).find(
                  (x) =>
                    !before.has(x.id) && x.kind === kind && x.meta?.provenance,
                ),
              );
              const src = {
                flac: "tone.flac",
                mp4: "orbit.mp4",
                glb: "triangle.glb",
              }[kind];
              const want = createHash("sha256")
                .update(
                  readFileSync(new URL("./corpus3/" + src, import.meta.url)),
                )
                .digest("hex");
              assert(
                createHash("sha256")
                  .update(readFileSync(join(f.folder, item.path)))
                  .digest("hex") === want,
                `${kind} output bytes are not the backend's /view bytes`,
              );
              assert(
                JSON.stringify(item.meta.provenance).includes(path),
                "provenance does not name the workflow",
              );
              results.push(kind);
            }
            return { ok: true, value: results };
          },
          ["dream"],
        );
        await book.attest(
          "real.gpu-smoke",
          "one real ComfyUI workflow through the shared GPU lock: queued, history output, result bytes and provenance matching",
          "generation",
          (e) =>
            /gpu_run/.test(e.lockInvocation || "") &&
            /^[0-9a-f-]{36}$/.test(e.promptId || "") &&
            /^[0-9a-f]{64}$/.test(e.outputSha256 || "") &&
            e.outputSha256 === e.resultFileSha256 &&
            e.provenanceRequestSha256 === e.reopenRequestSha256 &&
            e.nvidiaSmiBefore &&
            e.historyStatus === "success",
        );
        await stream?.close();
      },
      { env: { NAPKIN_COMFY_URL: mock.url } },
    );
  } finally {
    await mock.close();
  }
}
if (entry(import.meta.url)) output(await measure());
