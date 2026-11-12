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
import { reviewEvidence } from "./lib3/reviews.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
export async function measure() {
  const mock = await mockComfy();
  try {
    return await run(
      "D6",
      async ({ book, f, s, browser }) => {
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
            await request(s, "/api/generate", {
              workflow: wf.id,
              inputs: { "3.seed": [seed, seed + 1], "3.cfg": [1.5, 2.5] },
            });
            await waitUntil(() => mock.prompts.length === at + 4);
            const prompts = mock.prompts.slice(at);
            assert(
              new Set(
                prompts.map(
                  (x) =>
                    `${x.body.prompt["3"].inputs.seed}:${x.body.prompt["3"].inputs.cfg}`,
                ),
              ).size === 4,
              "grid missing a Cartesian combination",
            );
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
              assert(
                readFileSync(join(f.folder, item.path)).length > 100,
                "empty multimedia output",
              );
              results.push(kind);
            }
            return { ok: true, value: results };
          },
          ["dream"],
        );
        await book.check(
          "real.gpu-smoke",
          "real ComfyUI workflow → result with provenance through shared lock",
          () => {
            const e = reviewEvidence("generation");
            return {
              ok:
                e.locked === true && e.queued === true && e.provenance === true,
              value: e,
            };
          },
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
