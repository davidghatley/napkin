# Spike contract (what the acceptance tests rely on)

Shared and fixed (on `feat/core`): `src/format.js` (F01), `src/edits.js` (F02 validation, pure), `src/render.js` (F04), `fixtures/Card/Card.json`, `test/`.
Each sync variant implements the four modules below. Revisions are opaque (number or string); tests only compare them for equality.

## `src/store.js` (F02 + F03 commit path)
`export async function openStore(file)` resolves to:
- `read()` resolves `{ revision, doc }`
- `apply({ baseRevision, edits, by })` resolves `{ ok: true, revision, doc }` or `{ ok: false, error }`, never throws for bad input.
  - Invalid batch: `error` starts with `invalid edit #<i>` (from `EditError`); the file is not touched.
  - Stale: if any key the batch touches (`touched()`) changed after `baseRevision`, or `baseRevision` is unknown, `error` starts with `stale revision`; the file is not touched.
  - Otherwise edits that touch different keys land even if `baseRevision` is old (rebase onto current).
- `close()`

## `src/server.js --file <path> --port <n>` (F04, F05, F07)
- Prints `napkin canvas: http://127.0.0.1:<port>/` on stdout once listening (`--port 0` picks a free port).
- `GET /` is the canvas page. The page:
  - renders the Card with `src/render.js` inside `#stage` (elements carry `data-node="<id>"`);
  - has a side panel with `input#padding` (the `card.padding` value) and `input#fontWeight` (`title.fontWeight`); a `change` event sends a `set` edit through the store's edit path, with the page's current revision as base;
  - shows the current revision in `#revision` and sets `document.body.dataset.ready = "1"` once live;
  - updates without reload when the file changes for any reason (canvas, agent, external write such as `git restore`).
- Edits reach the file through the same store path as the agent's.

## `src/canvas-client.js` (the canvas socket, usable from Node)
`export async function connectCanvas(baseUrl)` resolves (after the first state arrives) to:
- `state()` returns `{ revision, doc }`
- `onChange(cb)` where `cb({ revision, by, doc })` is called on every new revision; `by` is `"canvas"`, `"agent"` or `"file"`
- `sendEdits(baseRevision, edits)` resolves the same result shape as `store.apply`
- `close()`
It speaks the same protocol as the page.

## `src/mcp.js --file <path>` (F06, F07), env `NAPKIN_URL` = the server URL
MCP over stdio: newline-delimited JSON-RPC 2.0, answers `initialize` (protocolVersion `2025-06-18`), `tools/list`, `tools/call`.
Tools (results as `content[0].text` JSON, plus `structuredContent`):
- `list_components {}` -> `[{ id, name }]`
- `read_component { component }` -> `{ component, revision, doc }` (`component` may be the id or the name)
- `apply_edits { component, baseRevision, edits }` -> `{ revision }`, or `isError: true` with the store's error text
Change notices: whenever the component reaches a new revision made by someone else, send the notification
`{ "jsonrpc": "2.0", "method": "notifications/napkin/change", "params": { component, revision, by, edits? } }`.

## First build (from 2026-10-20, decision 0003)

- **`src/model.js`** (pure; the canvas page can import it): the napkin/1 model plus `applyEdits`, `touched`, `conflicts`, `diffKeys`, `index`, `resolveStyle(doc, nodeId, variant)`, `variantGrid(doc)`, `getValue`, `EditError`.
  - **Ops:**
    - `set {path, value, variant?}`, where `path` is `node.cssProp`, `node.text` or `node.@src` / `node.@alt`; `value: null` removes it; `variant: { axis: value }` writes an override;
    - `insert`, `delete`, `move`;
    - `addProp {name, type, options?, default?}`, `removeProp {name}`;
    - `bindText {id, prop}` ("Make setting"; `prop: null` unbinds);
    - `addVariant {axis, value, base?}`, `removeVariant {axis, value}`.
- **`src/tsx/read.js`:** `readComponent(text) -> { doc, ast, parts }`, or throws `DialectError` (`line N: reason`).
- **`src/tsx/write.js`:**
  - `writeComponent(ast, before, after, originalText) -> text` touches only what changed;
  - `newComponentSource(Name)`.
- **`src/codecs.js`:** `tsxCodec` and `jsonCodec`. The store picks one by file extension. The sidecar `<Name>.napkin.json` holds `{ id, canvas }`.
- **`store.read()`** adds `readOnly: '<reason>'` for a `.tsx` outside the dialect. `apply` then returns `{ ok: false, error: 'read-only: …' }` and never writes.
- **Fixtures:** `fixtures/Card/Card.tsx` and `fixtures/Button/Button.tsx` (size md/sm/lg × state default/hover, which is 6 variants).
- **Tests:** `test/6-tsx-format.test.js` (M1). Tests 1–5 still run the 18 Oct JSON spike until M2 moves the canvas to TSX.
