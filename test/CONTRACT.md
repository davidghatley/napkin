# Contract (what the acceptance tests rely on)

The 18 Oct spike's JSON format, `src/format.js`, `src/edits.js`, `src/render.js` and `fixtures/Card/Card.json` are gone (M2); tests 1-5 now run on the TSX fixtures. The store section below is the commit path from the spike; the server, canvas client, MCP and page are specified in "First build". Revisions are opaque (number or string); tests only compare them for equality.

## `src/store.js` (F02 + F03 commit path)
`export async function openStore(file)` resolves to:
- `read()` resolves `{ revision, doc }`
- `apply({ baseRevision, edits, by })` resolves `{ ok: true, revision, doc }` or `{ ok: false, error }`, never throws for bad input.
  - Invalid batch: `error` starts with `invalid edit #<i>` (from `EditError`); the file is not touched.
  - Stale: if any key the batch touches (`touched()`) changed after `baseRevision`, or `baseRevision` is unknown, `error` starts with `stale revision`; the file is not touched.
  - Otherwise edits that touch different keys land even if `baseRevision` is old (rebase onto current).
- `close()`

## First build (from 2026-10-20, decision 0003)

- **`src/model.js`** (pure; the canvas page imports it): the napkin/1 model plus `applyEdits`, `touched`, `conflicts`, `diffKeys`, `index`, `resolveStyle(doc, nodeId, variant)`, `variantGrid(doc)`, `getValue`, `EditError`.
  - **Ops:**
    - `set {path, value, variant?}`, where `path` is `node.cssProp`, `node.text` or `node.@src` / `node.@alt`; `value: null` removes it; `variant: { axis: value }` writes an override;
    - `insert`, `delete`, `move`;
    - `addProp {name, type, options?, default?}`, `removeProp {name}`;
    - `bindText {id, prop}` ("Make setting"; `prop: null` unbinds);
    - `addVariant {axis, value, base?}`, `removeVariant {axis, value}`.
- **`src/tsx/read.js`:** `readComponent(text) -> { doc, ast, parts }`, or throws `DialectError` (`line N: reason`).
- **`src/tsx/write.js`:** `writeComponent(ast, before, after, originalText) -> text` touches only what changed; `newComponentSource(Name)`.
- **`src/codecs.js`:** `tsxCodec` (the only codec). The sidecar `<Name>.napkin.json` holds `{ id, canvas }`.
- **`src/store.js`:** `openStore(file)` as above, and:
  - `read()` also returns `source` (the file text), `readOnly: '<reason>'` for a `.tsx` outside the dialect, and `problem: '<error>'` while a hand edit is broken. `apply` on a read-only file returns `{ ok: false, error: 'read-only: ...' }` and never writes;
  - `events`: `change { revision, by, edits, origin, doc }` and `problem { error }` (`error: null` clears it). A broken or half-written file keeps the last good doc, and the error carries `line N:`.
- **`src/bundle.js`:** `createBundler()` -> `build(file, name) -> { ok, code, ms } | { ok: false, error, ms }`, `dispose(file)`, `close()`. esbuild in-process, one incremental context per file, `jsx: 'automatic'`, React from this repo's `node_modules`. The bundle is an ES module exporting `mount(el, props) -> unmount` (react-dom/client, rendered synchronously).
- **`src/workspace.js`:** `openWorkspace(dir, { only? })` opens one store and one esbuild context per `*.tsx`, and picks up files added or removed while running. A component's id is the one in its sidecar; `find(idOrName)`, `summary()`, `snapshot(entry)`, `bundle(entry)`, `events` (`change`, `problem`, `added`, `removed`, `build`).
- **`src/server.js --dir <folder> --port <n>`** (or `--file <one .tsx>` as a one-file folder; neither opens a temp copy of `fixtures/`). Prints `napkin canvas: http://127.0.0.1:<port>/`.
  - `GET /api/components` -> `[{ id, name, readOnly? }]`
  - `GET /api/components/:idOrName` -> `{ component, revision, doc, source, readOnly? }`
  - `POST /api/components/:idOrName/edits` `{ baseRevision, edits, by, origin? }` -> `store.apply`'s result (409 on failure)
  - `GET /api/events` (SSE): first a `state` frame per component, then `ready`; later `change` (`component, revision, by, edits?, origin, doc`), `problem` (`component, error`), `added` (a state frame), `removed` (`component`), `build` (`component, ok, ms, error?`). Every frame has `component`.
  - `GET /bundle/:id.js?rev=N` -> the component's ES module bundle (waits for the build after the latest revision; `?rev` only busts caches); 500 `{ ok: false, error }` if esbuild fails.
- **`src/canvas-client.js`:** `connectCanvas(baseUrl, { by })` -> `components()`, `state(idOrName)` (`{ component, name, revision, doc, readOnly?, problem? }`), `onChange(cb)` (every non-initial frame, with `mine`), `sendEdits(component, baseRevision, edits)`, `close()`.
- **`src/mcp.js`:** needs only `NAPKIN_URL`. `list_components` -> `[{ id, name, readOnly? }]`; `read_component { component }` -> `{ component, revision, doc, source, readOnly? }`; `apply_edits { component, baseRevision, edits }`. Notices carry `component` (the id).
- **The canvas page** (`public/index.html`, ES modules in `public/canvas/`):
  - `main.js` builds the shared `ctx` (shape documented at its top); `stage.js` draws every component with its full variant grid, plus selection and hover overlays; `panel.js` (M3 replaces the stub) and `tools.js` (M4 replaces the stub).
  - Each component is a `section.cmp[data-component=<id>][data-name][data-revision][data-ready="1"]`, with a `.badge` ("read-only: <reason>"), a `.problem` line (a broken hand edit: names the line, the last good render stays) and a `.build-error`.
  - Each variant is a `figure.cell[data-variant='{"size":"sm"}']` whose `figcaption` reads `size=sm · state=hover` (`default` when there are no axes). Rendered elements keep their `data-n`.
  - Click selects (`#overlay-select`, label "Component · node"), hover shows `#overlay-hover`. The panel shows `#sel-component`, `#sel-node`, `#sel-variant`, `#base-styles` and `input#padding` (a `change` sends a `set` edit on the selected node).
  - `#revision` shows the revision of the component drawn last; `document.body.dataset.ready = "1"` once every component has drawn.
- **Fixtures:** `fixtures/Card/Card.tsx` and `fixtures/Button/Button.tsx` (size md/sm/lg × state default/hover = 6 variants).
- **Tests:** `test/1`-`5` (TSX versions of the spike tests), `test/6-tsx-format.test.js` (M1), `test/7-render.test.js` (M2: bundles and rebuild time, the 6-variant grid, external writes within 1 s, a broken hand edit, branch switch with `stale revision`, files added and removed, read-only badge).

## Drawing (M4, F11 canvas side + F12)
- `workspace.create(name, rootTag = 'div')` -> `{ id, name }`; throws `CreateError` (`status` 400 for a bad name, 409 when the name exists). `POST /api/components { name, rootTag? }` -> 201 `{ ok: true, id, name }` or `{ ok: false, error }` with that status.
- `public/canvas/tools.js`: `#toolbar` with `button[data-tool=select|frame|text|image][aria-pressed]` (shortcuts V F T I), `#tool-new` (N) opening `form#new-component` (`input#new-name`, `#new-error`). A click or drag inside a rendered component inserts `frame<N>` / `text<N>` / `image<N>` into the base. Delete removes the selected node, Alt+Up/Down moves it among its siblings. Shortcuts never fire while an input has focus. `body[data-tool]` (also) names the active tool.
