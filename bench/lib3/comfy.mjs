// CPU-only ComfyUI protocol double. Shapes checked against GET /object_info, /queue,
// /history and /system_stats at localhost:8188 and upstream server.py / protocol.py.
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, assert, sleep } from "./runtime.mjs";
const info = (name, input, output, output_node = false) => ({
  input: { required: input },
  input_order: { required: Object.keys(input) },
  output,
  output_is_list: output.map(() => false),
  output_name: output,
  name,
  display_name: name,
  description: "Protocol fixture",
  python_module: "nodes",
  category: "image",
  output_node,
});
function executionOrder(prompt, outputs) {
  const ordered = [],
    seen = new Set(),
    visiting = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    if (visiting.has(id)) throw Error("Cycle in prompt");
    visiting.add(id);
    for (const value of Object.values(prompt[id].inputs || {}))
      if (
        Array.isArray(value) &&
        typeof value[0] === "string" &&
        Number.isInteger(value[1])
      )
        visit(value[0]);
    visiting.delete(id);
    seen.add(id);
    ordered.push(id);
  };
  for (const id of outputs) visit(id);
  return ordered;
}
export async function mockComfy() {
  const clients = new Map(),
    sockets = new Set(),
    prompts = [],
    history = {},
    requests = [],
    progress = [],
    served = [];
  let number = 0,
    queue = [],
    running = [],
    closed = false;
  const objectInfo = {
    LoadImage: info(
      "LoadImage",
      { image: [["spectrum.png", "sample-input.png"], { image_upload: true }] },
      ["IMAGE", "MASK"],
    ),
    SaveImage: info(
      "SaveImage",
      {
        images: ["IMAGE"],
        filename_prefix: ["STRING", { default: "ComfyUI" }],
      },
      [],
      true,
    ),
    EmptyLatentImage: info(
      "EmptyLatentImage",
      {
        width: ["INT", { default: 512, min: 16, max: 4096, step: 8 }],
        height: ["INT", { default: 512, min: 16, max: 4096, step: 8 }],
        batch_size: ["INT", { default: 1, min: 1, max: 4096 }],
      },
      ["LATENT"],
    ),
    KSampler: info(
      "KSampler",
      {
        model: ["MODEL"],
        seed: ["INT", { default: 0, min: 0, max: Number.MAX_SAFE_INTEGER }],
        steps: ["INT", { default: 20, min: 1, max: 10000 }],
        cfg: ["FLOAT", { default: 8, min: 0, max: 100, step: 0.1 }],
        sampler_name: [["euler", "heun"]],
        scheduler: [["normal", "simple"]],
        positive: ["CONDITIONING"],
        negative: ["CONDITIONING"],
        latent_image: ["LATENT"],
        denoise: ["FLOAT", { default: 1, min: 0, max: 1 }],
      },
      ["LATENT"],
    ),
  };
  const model = "model-" + randomUUID() + ".safetensors";
  objectInfo.CheckpointLoaderSimple = info(
    "CheckpointLoaderSimple",
    { ckpt_name: [[model]] },
    ["MODEL", "CLIP", "VAE"],
  );
  objectInfo.CLIPTextEncode = info(
    "CLIPTextEncode",
    { text: ["STRING", { default: "", multiline: true }], clip: ["CLIP"] },
    ["CONDITIONING"],
  );
  objectInfo.VAEDecode = info(
    "VAEDecode",
    { samples: ["LATENT"], vae: ["VAE"] },
    ["IMAGE"],
  );
  objectInfo.LoadAudio = info(
    "LoadAudio",
    { audio: ["COMBO", { options: ["tone.wav"], audio_upload: true }] },
    ["AUDIO"],
  );
  objectInfo.SaveAudio = info(
    "SaveAudio",
    {
      audio: ["AUDIO"],
      filename_prefix: ["STRING", { default: "audio/ComfyUI" }],
    },
    ["AUDIO"],
    true,
  );
  objectInfo.LoadVideo = info(
    "LoadVideo",
    { file: ["COMBO", { options: ["orbit.mp4"], video_upload: true }] },
    ["VIDEO"],
  );
  objectInfo.SaveVideo = info(
    "SaveVideo",
    {
      video: ["VIDEO"],
      filename_prefix: ["STRING", { default: "video/ComfyUI" }],
      format: [
        "COMFY_DYNAMICCOMBO_V3",
        {
          options: [
            {
              key: "auto",
              inputs: {
                required: {
                  codec: [
                    "COMFY_DYNAMICCOMBO_V3",
                    { options: [{ key: "auto", inputs: { required: {} } }] },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    [],
    true,
  );
  objectInfo.Load3D = info(
    "Load3D",
    {
      model_file: ["COMBO", { options: ["triangle.glb"], file_upload: true }],
      image: ["LOAD_3D", {}],
      width: ["INT", { min: 1, max: 4096, default: 1024 }],
      height: ["INT", { min: 1, max: 4096, default: 1024 }],
    },
    [
      "IMAGE",
      "MASK",
      "STRING",
      "IMAGE",
      "LOAD3D_CAMERA",
      "VIDEO",
      "FILE_3D",
      "LOAD3D_MODEL_INFO",
    ],
  );
  objectInfo.SaveGLB = info(
    "SaveGLB",
    {
      mesh: ["MESH,FILE_3D"],
      filename_prefix: ["STRING", { default: "3d/ComfyUI" }],
    },
    [],
    true,
  );
  objectInfo.SaveImage.output = ["IMAGE"];
  objectInfo.SaveImage.output_is_list = [false];
  objectInfo.SaveImage.output_name = ["IMAGE"];
  const outputFiles = new Map();
  const frame = (payload, opcode = 1) => {
    const data = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(JSON.stringify(payload));
    let h;
    if (data.length < 126) h = Buffer.from([128 | opcode, data.length]);
    else if (data.length < 65536) {
      h = Buffer.alloc(4);
      h[0] = 128 | opcode;
      h[1] = 126;
      h.writeUInt16BE(data.length, 2);
    } else {
      h = Buffer.alloc(10);
      h[0] = 128 | opcode;
      h[1] = 127;
      h.writeBigUInt64BE(BigInt(data.length), 2);
    }
    return Buffer.concat([h, data]);
  };
  const send = (type, data, client) => {
    progress.push({ type, data, at: performance.now() });
    const msg = frame({ type, data });
    for (const [id, socket] of clients)
      if (!client || client === id) socket.write(msg);
  };
  const status = () =>
    send("status", {
      status: { exec_info: { queue_remaining: queue.length + running.length } },
    });
  const execute = async (tuple) => {
    if (closed) return;
    queue = queue.filter((x) => x !== tuple);
    running.push(tuple);
    const [n, id, prompt, extra, outputs] = tuple,
      client = extra.client_id;
    status();
    send("execution_start", { prompt_id: id, timestamp: Date.now() }, client);
    send(
      "execution_cached",
      { nodes: [], prompt_id: id, timestamp: Date.now() },
      client,
    );
    for (const node of executionOrder(prompt, outputs)) {
      if (closed) return;
      send("executing", { node, prompt_id: id }, client);
      for (let value = 1; value <= 3; value++) {
        await sleep(45);
        if (closed) return;
        send("progress", { value, max: 3, prompt_id: id, node }, client);
        if (value === 2) {
          const header = Buffer.alloc(8);
          header.writeUInt32BE(1, 0); // BinaryEventTypes.PREVIEW_IMAGE
          header.writeUInt32BE(2, 4); // PNG
          const preview = frame(
            Buffer.concat([
              header,
              readFileSync(join(ROOT, "bench/corpus3/spectrum.png")),
            ]),
            2,
          );
          for (const [sid, socket] of clients)
            if (!client || sid === client) socket.write(preview);
        }
      }
    }
    const output = {};
    for (const node of outputs) {
      const cls = prompt[node].class_type;
      const [field, extension, source] =
        cls === "SaveAudio"
          ? ["audio", "flac", "tone.flac"]
          : cls === "SaveVideo"
            ? ["images", "mp4", "orbit.mp4"]
            : cls === "SaveGLB"
              ? ["3d", "glb", "triangle.glb"]
              : ["images", "png", "spectrum.png"];
      const filename = `${id}_${node}_00001_.${extension}`;
      outputFiles.set(filename, source);
      output[node] = {
        [field]: [{ filename, subfolder: "napkin-mock", type: "output" }],
      };
      if (cls === "SaveVideo") output[node].animated = [true];
      if (cls === "SaveGLB")
        Object.assign(output[node], { camera_info: [null], model_3d_info: [] });
      send(
        "executed",
        { node, display_node: node, output: output[node], prompt_id: id },
        client,
      );
    }
    history[id] = {
      prompt: tuple,
      outputs: output,
      status: {
        status_str: "success",
        completed: true,
        messages: [
          ["execution_start", { prompt_id: id, timestamp: Date.now() - 300 }],
          ["execution_success", { prompt_id: id, timestamp: Date.now() }],
        ],
      },
      meta: Object.fromEntries(
        outputs.map((node) => [
          node,
          {
            node_id: node,
            display_node: node,
            parent_node: null,
            real_node_id: node,
          },
        ]),
      ),
    };
    running = running.filter((x) => x !== tuple);
    send("execution_success", { prompt_id: id, timestamp: Date.now() }, client);
    send("executing", { node: null, prompt_id: id }, client);
    status();
  };
  let pumping = false;
  const pump = async () => {
    if (pumping || closed) return;
    pumping = true;
    try {
      while (queue.length && !closed) await execute(queue[0]);
    } finally {
      pumping = false;
    }
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://mock"),
      p = url.pathname;
    requests.push({
      method: req.method,
      path: p,
      query: Object.fromEntries(url.searchParams),
    });
    const json = (code, data) => {
      res.writeHead(code, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET, POST",
        });
        return res.end();
      }
      if (req.method === "GET" && p === "/object_info")
        return json(200, objectInfo);
      if (req.method === "GET" && p.startsWith("/object_info/"))
        return json(
          200,
          objectInfo[p.slice(13)]
            ? { [p.slice(13)]: objectInfo[p.slice(13)] }
            : {},
        );
      if (req.method === "GET" && p === "/prompt")
        return json(200, {
          exec_info: { queue_remaining: queue.length + running.length },
        });
      if (req.method === "GET" && p === "/queue")
        return json(200, { queue_running: running, queue_pending: queue });
      if (req.method === "GET" && p.startsWith("/history"))
        return json(
          200,
          p === "/history"
            ? history
            : history[p.slice(9)]
              ? { [p.slice(9)]: history[p.slice(9)] }
              : {},
        );
      if (req.method === "GET" && p === "/view") {
        const filename = url.searchParams.get("filename"),
          known = Object.values(history).some((h) =>
            Object.values(h.outputs).some((o) =>
              Object.values(o).some(
                (a) =>
                  Array.isArray(a) &&
                  a.some(
                    (i) =>
                      i?.filename === filename &&
                      i.subfolder === url.searchParams.get("subfolder") &&
                      i.type === url.searchParams.get("type"),
                  ),
              ),
            ),
          );
        if (!known) return json(404, { error: "output not found" });
        served.push(filename);
        const source = outputFiles.get(filename);
        res.writeHead(200, {
          "content-type": source.endsWith(".png")
            ? "image/png"
            : source.endsWith(".mp4")
              ? "video/mp4"
              : source.endsWith(".flac")
                ? "audio/flac"
                : "model/gltf-binary",
        });
        return res.end(readFileSync(join(ROOT, "bench/corpus3", source)));
      }
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const b of req) chunks.push(b);
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      }
      if (req.method === "POST" && p === "/prompt") {
        const prompt = body.prompt;
        if (
          !prompt ||
          typeof prompt !== "object" ||
          !Object.keys(prompt).length
        )
          return json(400, {
            error: { type: "no_prompt", message: "No prompt provided" },
            node_errors: {},
          });
        const errors = {};
        for (const [id, node] of Object.entries(prompt)) {
          const info = objectInfo[node.class_type];
          if (!info) {
            errors[id] = {
              errors: [
                { type: "invalid_node_type", message: "Node does not exist" },
              ],
              class_type: node.class_type,
            };
            continue;
          }
          for (const [name, [type, options = {}]] of Object.entries(
            info.input.required,
          )) {
            const value = node.inputs?.[name];
            if (value === undefined)
              errors[id] = {
                errors: [
                  {
                    type: "required_input_missing",
                    message: `Required input ${name}`,
                  },
                ],
                class_type: node.class_type,
              };
            const linked =
              Array.isArray(value) &&
              typeof value[0] === "string" &&
              Number.isInteger(value[1]);
            const invalid = (message) => {
              errors[id] = {
                class_type: node.class_type,
                errors: [{ type: "value_not_in_list", message }],
              };
            };
            if (value !== undefined && !linked) {
              const choices = Array.isArray(type)
                ? type
                : type === "COMBO"
                  ? options.options
                  : type === "COMFY_DYNAMICCOMBO_V3"
                    ? options.options.map((x) => x.key)
                    : null;
              if (choices && !choices.includes(value))
                invalid(`Invalid ${name}`);
              if (
                ["INT", "FLOAT"].includes(type) &&
                (typeof value !== "number" ||
                  !Number.isFinite(value) ||
                  (type === "INT" && !Number.isInteger(value)) ||
                  value < (options.min ?? -Infinity) ||
                  value > (options.max ?? Infinity))
              )
                invalid(`Invalid numeric ${name}`);
              if (type === "STRING" && typeof value !== "string")
                invalid(`Invalid string ${name}`);
            }
            if (linked && prompt[value[0]]) {
              const sourceType =
                objectInfo[prompt[value[0]].class_type]?.output?.[value[1]];
              if (
                !sourceType ||
                (typeof type === "string" &&
                  !type.split(",").includes(sourceType))
              )
                invalid(`Incompatible link ${name}`);
            }
            if (
              Array.isArray(value) &&
              typeof value[0] === "string" &&
              typeof value[1] === "number" &&
              !prompt[value[0]]
            )
              errors[id] = {
                errors: [
                  { type: "bad_linked_input", message: "Missing linked node" },
                ],
                class_type: node.class_type,
              };
          }
        }
        const outputs = Object.keys(prompt).filter(
          (id) => objectInfo[prompt[id].class_type]?.output_node,
        );
        if (Object.keys(errors).length || !outputs.length)
          return json(400, {
            error: {
              type: "prompt_outputs_failed_validation",
              message: "Prompt outputs failed validation",
            },
            node_errors: errors,
          });
        try {
          executionOrder(prompt, outputs);
        } catch (e) {
          return json(400, {
            error: {
              type: "prompt_outputs_failed_validation",
              message: e.message,
            },
            node_errors: {},
          });
        }
        const id = randomUUID(),
          n = body.number ?? (body.front ? -number++ : number++),
          extra = {
            ...body.extra_data,
            ...(body.client_id ? { client_id: body.client_id } : {}),
            create_time: Date.now(),
          },
          tuple = [n, id, prompt, extra, outputs];
        prompts.push({ id, body: structuredClone(body) });
        queue.push(tuple);
        queue.sort((a, b) => a[0] - b[0]);
        json(200, { prompt_id: id, number: n, node_errors: {} });
        status();
        setTimeout(() => pump(), 80);
        return;
      }
      if (req.method === "POST" && p === "/queue") {
        if (body.clear) queue = [];
        if (body.delete)
          queue = queue.filter((x) => !body.delete.includes(x[1]));
        status();
        return json(200, {});
      }
      if (req.method === "POST" && p === "/history") {
        if (body.clear)
          for (const id of Object.keys(history)) delete history[id];
        for (const id of body.delete || []) delete history[id];
        return json(200, {});
      }
      return json(404, { error: "route not found" });
    } catch (e) {
      return json(400, {
        error: { type: "bad_request", message: e.message },
        node_errors: {},
      });
    }
  });
  server.on("upgrade", (req, socket) => {
    if (new URL(req.url, "http://mock").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64") +
        "\r\n\r\n",
    );
    const id =
      new URL(req.url, "http://mock").searchParams.get("clientId") ||
      randomUUID();
    clients.set(id, socket);
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => {
      clients.delete(id);
      sockets.delete(socket);
    });
    socket.on("data", (b) => {
      if ((b[0] & 15) === 8) socket.end(frame(Buffer.alloc(0), 8));
    });
    send(
      "status",
      {
        status: {
          exec_info: { queue_remaining: queue.length + running.length },
        },
        sid: id,
      },
      id,
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    prompts,
    history,
    requests,
    progress,
    served,
    objectInfo,
    close: async () => {
      closed = true;
      for (const s of sockets) s.destroy();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
