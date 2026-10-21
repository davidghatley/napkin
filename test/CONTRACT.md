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
    - `addVariant {axis, value, base?}`, `removeVariant {axis, value}`;
    - `rename {id, to}` (canvas round 1): changes one node id everywhere it appears (data-n, `s('id', v)`, the base entry and every variant override); `to` must be a free `[a-z][A-Za-z0-9_]*` id. `touched` = `node:<id>`, `node:<to>`.
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
  - `GET /api/components/:idOrName` -> `{ component, canvas, revision, doc, source, readOnly? }`
  - `POST /api/components/:idOrName/canvas` `{ x, y }` -> `{ ok: true, canvas }` (400 for non-numbers): writes the sidecar's `canvas` field and nothing else (never the `.tsx`), then broadcasts `canvas`. This is the only write besides the store's.
  - `POST /api/components/:idOrName/edits` `{ baseRevision, edits, by, origin? }` -> `store.apply`'s result (409 on failure)
  - `GET /api/events` (SSE): first a `state` frame per component, then `ready`; later `change` (`component, revision, by, edits?, origin, doc`), `problem` (`component, error`), `added` (a state frame), `removed` (`component`), `build` (`component, ok, ms, error?`), `canvas` (`component, canvas: { x, y }`). Every frame has `component`; `state` and `added` frames also carry `canvas`.
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

## Canvas lane, round 1 (CAN-01..08, FEEL-02..04)
The page is now an infinite canvas. What the tests (12-15) and other lanes can rely on:

- **Layout:** `#topbar` (`#toolbar`, `#quick-open`, `#revision`, `#agent-status`, `#presence`, `#theme-toggle`), `#sidebar` (`#layers` tree, `#log`), `main#stage` > `#world` (one CSS transform: `translate3d(x, y, 0) scale(z)`) + `#overlays`, `aside#inspector` > `#panel`, `#statusbar` (`#counts`, `#zoom-out/#zoom-level/#zoom-in/#zoom-fit`). `#dock` (hidden) is reserved for the code strip and proposals tray (`#code-strip`, `#proposals-tray`).
- **`window.napkin`** is the shared `ctx` (see the top of `public/canvas/main.js`): `state.components/selection/selections/tool/zoom`, `select`, `selectMany`, `toggle`, `sendEdits`, `find(idOrName)`, `on/emit`, `view`, `stage`, `nav`, `quick`, `tools`. Events added: `view` ({x,y,z}), `layout`, `moved`, `focus`.
- **Frames:** `section.cmp` keeps its attributes and now has `.cmp-head` (title `h3`, `.badge`, `.rev`, `.problem`, `.build-error`) and `.frame > .matrix`. Positions come from the sidecar `canvas` (`{x, y}`; `{0, 0}` means "not placed": the stage packs those once, alphabetically, and never re-packs). A frame moves by dragging its title; that POSTs `/canvas`.
- **Variant matrix:** first axis across, second down, the rest as `.group`s (`.group-title` with `.gchip`s). Headers `.colhead` / `.rowhead` carry the values and stay about 12 px on screen (counter-scaled by `--ls`). `figure.cell[data-variant]` keeps its JSON in axis order and its `figcaption` text (`size=sm · state=hover`); captions show from about 90% zoom. **DOM order of cells is matrix order, not `variantGrid` order: select cells by `data-variant`, never by index.**
- **Selection:** `state.selections` (one component only), `state.selection` is the last. Click, shift/Ctrl/Cmd-click toggles, a marquee on empty canvas selects the nodes it touches in the component with most hits. `#overlay-select` (primary, `data-label` = "Component · node", `data-count`), `.overlay-extra` for the others, `#overlay-hover`, `#marquee`. Overlays are in screen space and refreshed in the same call that moves the world, so they are never a frame late.
- **View:** `view.get()` -> `{x, y, z}` (z 0.05..8). Wheel pans, Ctrl/Cmd-wheel and pinch zoom at the cursor, Space-drag / middle-drag / one finger pan, `+` `-` zoom 1.25x, `Shift+1` fit all (never above 100%), `Shift+2` fit selection, `Shift+0` 100%. Flights take 220 ms and are instant under `prefers-reduced-motion`.
- **Quick open:** Ctrl/Cmd+K opens `#quick` (`#q-input`, `#q-list [role=option]`); fuzzy over actions, components and nodes ("Chip › label"); Enter flies there and selects. `napkin.quick.build()` then `.search(q)` for timing.
- **Focus:** Enter focuses the selection's component (`body[data-focus=<name>]`, `location.hash` = `#Name/node`), Esc returns to the earlier view and clears the hash. Loading `#Name[/node]` focuses it. A free view survives a reload (sessionStorage).
- **Layers:** `#layers [role=treeitem]` rows `.lrow[data-component][data-node][aria-level]` mirror the JSX. Click selects, double-click or F2 renames (`rename` op, one revision), dragging a row is one `move`. Component rows fly on double-click.
- **Measure:** hold Alt; `#overlay-measure[data-active="1"]` holds `.m-label[data-axis=x|y][data-value]` (canvas pixels, i.e. screen pixels / zoom) from the primary selection to the hovered node.
- **Panel:** sections (`details.sec[data-sec]`) Layout, Size, Appearance, Fill, Stroke, Shadow, Text, Content, Advanced: all CSS, then Settings and Variants. Each plain CSS property keeps `input#<cssProp>` (`#padding`, `#borderRadius`, `#width`, `#color`, `#gap`, `#fontSize` ...), its dot `#dot-<prop>` and `#reset-<prop>`. Numbers are filled wells (`.fbox.num`, scrub the label), text is an outlined box (`.fbox.txt`), menus have an arrow (`.fbox.sel`). `#opacity` shows percent and writes 0..1. `#fontFamily` shows the first family name (a `datalist#fontlist` offers faces) and keeps the fallback stack. Segmented controls are `#seg-<prop>-<value>` (`aria-checked`), the alignment matrix `#align-<row><col>` (`aria-pressed`; one batch of `justifyContent` + `alignItems`), width and height are one row each (`.sizerow`: `#size-<prop>-<hug|fill|fixed>` and `#width`/`#height`; Hug writes `auto`, Fill `100%`, Fixed the rendered px; the unit shows only for a number).
  - **Compound controls** are several inputs written as ONE css line: Fill (`#background` hex, `#fill-a` alpha %, `#eye-fill`, `#pick-background`; hex8 holds the alpha), Stroke (`#stroke-color`, `#stroke-a`, `#stroke-w`, `#stroke-s`, `#eye-stroke`, sides `#side-<all|Top|Right|Bottom|Left>` choose `border` or `border<Side>`), Shadow (`#shadow-color`, `#shadow-a`, `#shadow-x|y|blur|spread`; one drop shadow, else a text field `#boxShadow`), per-side padding (`#pad-sides` toggle, `#pad-t|r|b|l`) and per-corner radius (`#rad-sides`, `#rad-tl|tr|br|bl`), written as the `padding` / `borderRadius` shorthand (one number when all equal). Fill, Stroke and Shadow have `#add-<fill|stroke|effects>` / `#remove-<...>` (+ and -).
  - **Scope:** one row, `select#scope` (`base` | `variant`, the variant option is disabled on an all-base cell) with `#scope-info` showing `#target-note` (hidden until asked) and `#override-axis` when two axes differ. `#sel-component`, `#sel-node` (ends with `+N` for N more selected), `#sel-variant`, `#sel-target` stay. Dragging a `label.scrub` scrubs (DOM preview, one edit on release); Mixed shows an empty field, placeholder "Mixed", `data-mixed="1"`. Remove buttons for settings are quiet icon buttons (`#remove-prop-<name>`, an "x").
- **Layers, round 2:** rows are fixed columns (disclosure, icon, name, quiet tag shown on hover, `.lmore`). Name = the data-n id. Classes: `.selected`, `.primary`, `.anc` (an ancestor of a selection), `.hot` (hovered either side). `.lmore` opens `#lmenu` (Rename, Duplicate = one batch of inserts, Delete). A click keeps focus on its row across the redraw. No visibility toggle: it would need `display:none`, which would overwrite the node's real `display`.
- **Hints and errors:** `#hint` (shift-click across components: "Selection stays within one component"); the `#error` toast says "That id is already used" for a taken id (inline panel errors keep the store's text). A link to a node that is not there focuses the component root.
- **Far zoom:** below 33% zoom the per-axis headers hide and `.axes-strip` ("size ×4 → tone ×4 ↓ look ×4") in the frame title stays at least 10 px (`--lf` scales titles up to 16x).
- **Sidecar writes** go through `src/atomic-write.js` (`writeFileAtomic(path, text)`: temp file, fsync, rename); `POST /canvas` refuses null, strings and NaN.
- **Chrome:** light and dark follow the system until `#theme-toggle` is used (`html[data-theme]`, saved in localStorage). axe-core finds nothing in either (test 14).
- **No layout shift:** the toolbar, status bar and change log reserve their size; the log has fixed rows rewritten in place; frames never move when another frame's edit lands (test 12).
- **Fixtures:** `fixtures/Chip/Chip.tsx` has size x tone x look, 4 x 4 x 4 = 64 cells.
- **Tests:** `11` (rename), `12` (navigation, layout shift, overlay lag), `13` (frame drag, quick open, layers, multi-select, measure, focus), `14` (axe, matrix legibility; `EVIDENCE_OUT=docs/evidence` writes the screenshots), `15` (panel controls), `16` (canvas endpoint), `17` (round 2: compound controls, layer menu, hints, far strip). `test/helpers/input.js` has wheel, key (with modifiers), mouse and touch over CDP; `launchChromium` now pins the page size to the requested width x height.
