import { test } from "node:test";
import assert from "node:assert/strict";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
// A stand-in for napkin's HTTP contract: one item whose "file" is a JSON document of control values.
// It checks baseRevision like the real server must, and undo restores the exact earlier bytes.
function mockApi() {
  const state = {
    revision: 1,
    file: JSON.stringify({ radius: 12, label: "Hello" }),
    undo: [],
    posts: [],
  };
  const schema = () => {
    const v = JSON.parse(state.file);
    return {
      revision: state.revision,
      sections: [
        {
          id: "box",
          label: "Box",
          depth: 2,
          controls: [
            { id: "radius", type: "number", label: "Radius", value: v.radius, min: 0, max: 100, unit: "px", depth: 1 },
            { id: "label", type: "text", label: "Label", value: v.label, depth: 1 },
          ],
        },
      ],
    };
  };
  const body = (req) =>
    new Promise((resolve) => {
      let text = "";
      req.on("data", (c) => (text += c));
      req.on("end", () => resolve(text ? JSON.parse(text) : {}));
    });
  const send = (res, status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const handler = async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/api/controls/box.css") return send(res, 200, schema()), true;
    if (path === "/api/control" && req.method === "POST") {
      const b = await body(req);
      state.posts.push(b);
      if (b.baseRevision !== state.revision)
        return send(res, 409, { ok: false, error: "stale revision", revision: state.revision }), true;
      state.undo.push(state.file);
      const v = JSON.parse(state.file);
      v[b.control] = b.value;
      state.file = JSON.stringify(v);
      state.revision++;
      return send(res, 200, { ok: true, revision: state.revision }), true;
    }
    if (path === "/api/undo" && req.method === "POST") {
      if (!state.undo.length) return send(res, 409, { ok: false, error: "nothing to undo" }), true;
      state.file = state.undo.pop();
      state.revision++;
      return send(res, 200, { ok: true, revision: state.revision }), true;
    }
    return false;
  };
  return { state, handler };
}
test(
  "a panel connected to the HTTP contract writes each commit, rejects stale revisions and undoes byte-exactly",
  { timeout: 60000 },
  async () => {
    const mock = mockApi(),
      server = await serve({ api: mock.handler }),
      browser = await launchChromium({ width: 1200, height: 800 }),
      q = (x) => browser.eval(x);
    try {
      await browser.goto(server.url);
      await browser.waitFor("window.dialsDemo?.panels.length===6");
      await q(`(async()=>{
        const { Dials } = await import('./dials.js');
        const { connect } = await import('./remote.js');
        const mount = document.createElement('div');
        document.body.append(mount);
        window.rp = new Dials(mount);
        window.link = connect(rp, { item: 'box.css', events: false });
        await link.load({ render: true });
        return true })()`);
      assert.equal(await q('rp.get("radius")'), 12);
      // A scrub is many changes and one commit: exactly one write.
      await q('rp.begin("radius");for(const n of [14,20,31])rp.change("radius",n);rp.commit("radius");link.flush()');
      await q("link.flush()");
      assert.equal(mock.state.posts.length, 1);
      assert.deepEqual(JSON.parse(mock.state.file), { radius: 31, label: "Hello" });
      assert.equal(await q("rp.revision"), 2);
      // A typed edit afterwards uses the new revision.
      await q('rp.transact("label","Changed")');
      await q("link.flush()");
      assert.deepEqual(JSON.parse(mock.state.file), { radius: 31, label: "Changed" });
      assert.equal(mock.state.posts.at(-1).baseRevision, 2);
      // Another writer changes the file; our next write is refused and the panel shows the truth.
      mock.state.file = JSON.stringify({ radius: 77, label: "Changed" });
      mock.state.revision = 9;
      await q('window.rejected=[];rp.addEventListener("rejected",e=>rejected.push(e.detail.status));rp.transact("radius",5)');
      await q("link.flush()");
      assert.deepEqual(await q("rejected"), [409]);
      assert.equal(await q('rp.get("radius")'), 77);
      assert.equal(JSON.parse(mock.state.file).radius, 77, "a refused write changes nothing");
      // Undo asks the server and restores the exact earlier bytes.
      const before = mock.state.file;
      await q('rp.transact("radius",40)');
      await q("link.flush()");
      assert.notEqual(mock.state.file, before);
      await q("link.undo()");
      assert.equal(mock.state.file, before);
      assert.equal(await q('rp.get("radius")'), 77);
      await q("link.close()");
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
