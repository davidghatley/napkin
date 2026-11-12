/**
 * Connects a Dials panel to napkin's HTTP contract:
 *   GET  /api/controls/<item>                          -> the dials schema (with revision)
 *   POST /api/control { item, control, value, baseRevision } -> { ok, revision }
 *   POST /api/undo    { item }                         -> { ok, revision }
 * The panel stays usable offline of this module; nothing here is needed to render a schema.
 */
export function connect(panel, options) {
  const { item, base = "", onError } = options,
    request = options.fetch || globalThis.fetch.bind(globalThis),
    url = (path) => `${base}${path}`;
  let chain = Promise.resolve(),
    closed = false,
    source;
  const json = async (path, init) => {
    const response = await request(url(path), init);
    let body = {};
    try {
      body = await response.json();
    } catch {
      /* an empty body is a failure below */
    }
    return { status: response.status, ok: response.ok && body.ok !== false, body };
  };
  const post = (path, payload) =>
    json(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  const values = (schema) =>
    Object.fromEntries(
      schema.sections.flatMap((s) => s.controls.map((c) => [c.id, c.value])),
    );
  /** Load the schema and render it, or (when already rendered) move values to the server's. */
  async function load({ render = false } = {}) {
    const { ok, body } = await json(`/api/controls/${encodeURIComponent(item)}`);
    if (!ok) throw new Error(body.error || `Could not load controls for ${item}`);
    if (render || !panel.schema) panel.render(body);
    else panel.update(values(body), { revision: body.revision });
    return body;
  }
  async function send(detail) {
    const { ok, status, body } = await post("/api/control", {
      item,
      control: detail.control,
      value: detail.value,
      baseRevision: panel.revision,
    });
    if (ok) {
      panel.update({}, { revision: body.revision });
      panel.emit("saved", { control: detail.control, revision: body.revision });
      return;
    }
    // A newer writer got there first (or the value was refused): show what the file really holds.
    panel.emit("rejected", {
      control: detail.control,
      status,
      reason: body.error || "refused",
    });
    await load();
  }
  const onValue = (event) => {
    const detail = event.detail;
    // Remote-originated updates and in-progress gestures are never echoed back.
    if (detail.phase !== "commit" || detail.source === "remote") return;
    chain = chain.then(() => (closed ? undefined : send(detail))).catch((e) => onError?.(e));
  };
  panel.addEventListener("value", onValue);
  if (options.events !== false && typeof EventSource === "function" && !options.fetch) {
    try {
      source = new EventSource(url("/api/events"));
      source.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.item === item && !closed) load().catch((err) => onError?.(err));
        } catch {
          /* ignore events that are not JSON */
        }
      };
    } catch {
      source = undefined;
    }
  }
  return {
    load,
    /** Ask the server to undo its last change to this item, then show the restored values. */
    async undo() {
      await chain;
      const { ok, body } = await post("/api/undo", { item });
      if (!ok) throw new Error(body.error || "Nothing to undo");
      await load();
      return body;
    },
    flush: () => chain,
    close() {
      closed = true;
      panel.removeEventListener("value", onValue);
      source?.close();
    },
  };
}
