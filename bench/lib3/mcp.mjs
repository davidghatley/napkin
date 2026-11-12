import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT, assert } from "./runtime.mjs";
// Deliberately independent of src/mcp.js implementation. Discover named route mirrors.
export async function mcp(base, agent = "measures") {
  const proc = spawn(process.execPath, [join(ROOT, "src/mcp.js")], {
    cwd: ROOT,
    env: { ...process.env, NAPKIN_URL: base + "/", NAPKIN_AGENT: agent },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let id = 0,
    buffer = "",
    stderr = "";
  const pending = new Map(),
    notifications = [];
  proc.stderr.on("data", (b) => (stderr += b));
  proc.on("error", (e) => {
    for (const p of pending.values()) p.reject(e);
  });
  proc.stdout.on("data", (b) => {
    buffer += b;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id);
        clearTimeout(p.timer);
        pending.delete(m.id);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      } else notifications.push({ at: performance.now(), ...m });
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id,
        timer = setTimeout(() => {
          pending.delete(n);
          reject(Error(`MCP ${method} timed out: ${stderr.slice(-300)}`));
        }, 5000);
      pending.set(n, { resolve, reject, timer });
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n",
      );
    });
  const stop = async () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("MCP closed"));
    }
    pending.clear();
    proc.stdin.end();
    proc.kill("SIGTERM");
  };
  try {
    await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: agent, version: "3" },
    });
    proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    const list = await rpc("tools/list", {});
    assert(Array.isArray(list.tools), "MCP tools/list missing tools");
    const call = async (name, args) => {
      assert(
        list.tools.some((t) => t.name === name),
        `Missing MCP mirror ${name}; advertised: ${list.tools.map((t) => t.name).join(", ")}`,
      );
      const r = await rpc("tools/call", { name, arguments: args });
      assert(!r.isError, `MCP ${name}: ${JSON.stringify(r.content)}`);
      if (r.structuredContent) return r.structuredContent;
      for (const c of r.content || [])
        if (c.type === "text") {
          try {
            return JSON.parse(c.text);
          } catch {}
        }
      throw Error(`MCP ${name}: no structured JSON result`);
    };
    return { rpc, call, tools: list.tools, notifications, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
