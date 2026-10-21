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
    - `setDefault {name, value}` (changes a default in place; an enum base value must have no overrides);
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

## Agents (round 1 of the dream build: AGT-01..11)

### HTTP (all in `src/api.js`, used by `src/server.js`; every JSON failure is `{ ok: false, error, ... }`)
- `POST /api/components/:c/edits` `{ baseRevision, edits, by, origin?, dryRun?, propose? }`.
  - Applied: 200 `{ ok, revision, doc }`. `dryRun`: 200 `{ ok, dryRun, revision, doc, source }`, nothing written.
  - `propose: true` (or the caller's `by` is `propose` in napkin.json): validated as a dry run, then held. 200 `{ ok, proposed: true, proposal: { id, component, baseRevision, by, summary } }`. `dryRun` wins over `propose`.
  - Refused: 409 invalid edit or **stale**; 403 `{ permission: 'read'|'propose' }` when napkin.json forbids it.
  - **Stale** (AGT-06, AGT-10): `{ ok: false, error: 'stale revision: ...', currentRevision, stale: [{ key, value, yours, revision, by }] }`. `key` is a touched key (`node.prop`, `node.prop@axis=value`, `children:<id>`, `node:<id>`, `prop:<name>`); `value` is what it holds now (theirs, landed), `yours` what the caller tried (did not land), `revision` and `by` say who changed it. `null` means removed. Retry by sending the same edits with `baseRevision = currentRevision`. An unknown base gives `stale: []`. Canvas clash chip: show `value` and `yours`; one click re-sends `yours` on `currentRevision`.
- **Proposals (AGT-04), in server memory only; a proposal never writes a file.**
  - `GET /api/proposals[?component=<idOrName>]` -> `[{ id, component, name, baseRevision, currentRevision, edits, by, summary, at, doc, source }]` (`doc` and `source` are the would-be result, for ghost before/after cells; the "before" is the component's own state).
  - `POST /api/proposals/:id/accept` `{ by? }` -> 200 `{ ok, status: 'accepted', revision }`; goes through `store.apply` with the proposal's base revision and `by` = the agent, so the normal stale rules apply: 409 with the stale body above, and the proposal stays listed. 404 once resolved.
  - `POST /api/proposals/:id/reject` `{ by? }` -> 200 `{ ok, status: 'rejected' }`; the file is untouched (sha unchanged).
  - SSE: `proposal` `{ component, proposal }` when one is created; `proposal-resolved` `{ component, id, status: 'accepted'|'rejected', by?, revision? }`. Not replayed on connect: read `GET /api/proposals` after `ready`. A removed component rejects its proposals.
- `GET /api/components/:c/history[?limit=50]` -> `{ ok, component, history: [{ revision, by, summary, at, keys }] }`, newest first. `by` is `david`/an agent name/`unknown` (no name sent)/`file` (external write; revision 1 is `file`, summary `opened`). Every revision has one (AGT-05).
- SSE `change` frames now also carry `summary` (one line) and `at` (ms). The first frame for an apply reaches listeners within 200 ms (AGT-09).
- `POST /api/components/:c/rename` `{ name, by }` -> `{ ok, id, name }` (id is kept; renames file, function and Props interface). `DELETE /api/components/:c[?by=]` -> `{ ok, id, name }`. Both 403 for read/propose agents.
- `GET /api/search?q=` -> `[{ kind: 'component'|'node', component, name, node?, tag?, text?, match? }]`.
- `GET /api/components/:c/render?variant={"size":"sm"}` -> `image/png` of the component's root element for that variant cell (header `x-napkin-render-ms`); 422 for an unknown axis or value. One warm headless Chromium; transparent background.
- `GET /api/guide` -> `{ ok, guide }` (markdown).
- **Permissions (decision 0005, AGT-11):** napkin.json (in the components folder or its parent) `{ "agents": { "<name>": "read"|"propose"|"write" } }`, read on every request. The name is the `by` of the request; unlisted = `write`; an unknown word = `read`. `read`: apply, create, rename and delete refused (dryRun and render allowed). `propose`: every apply becomes a proposal; create, rename and delete refused.

### MCP (`src/mcp.js`; env `NAPKIN_URL`, `NAPKIN_DIR`, `NAPKIN_AGENT`)
- Tools: `list_components`, `read_component`, `apply_edits` (dryRun, propose), `add_variant` (dryRun, propose), `create_component`, `rename_component`, `delete_component`, `render_component` (image content + `{ bytes, ms }`), `search`, `subscribe` (`{ changes: [{ component, revision, by, summary, edits }] }`, `waitMs` up to 10000; also pushed as `notifications/napkin/change`).
- A tool failure is `isError` with plain text, except stale and permission failures: the text is JSON `{ error, stale?, currentRevision?, permission? }` (also in `structuredContent`).
- Guide: resource `napkin://guide`, prompt `napkin_guide`, and the `initialize` `instructions` field all carry `src/guide.js`.
- **No server (AGT-08):** if `NAPKIN_URL` does not answer, MCP opens `NAPKIN_DIR` (default `./components`) itself with the same API, holding `<dir>/.napkin/lock` (the holder's PID on one line; a dead PID's lock is taken over; a live holder makes every tool fail naming the PID). `src/lock.js` has `acquireLock(dir)` for the server to share. `NAPKIN_NO_FALLBACK=1` disables it.
- Agent eval: `AGENT_EVAL=1 EVIDENCE=1 node --test test/agent-eval/` (not part of `npm test`). Evidence files are written to `docs/evidence/` only when `EVIDENCE=1`.
