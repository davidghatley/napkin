# napkin

From napkin sketch to real components: a Paper-like design canvas tuned for components, that agents and people edit together.

Early days. The contract is in [INTENT.md](INTENT.md); how it fits the other projects is in [STACK.md](STACK.md).

## Quickstart

Use Node.js 26 or newer and npm. From the root of this checkout, run:

<!-- quickstart:start -->
```sh
npm ci
node src/cli.js init ./my-napkin
node src/cli.js open ./my-napkin
```
<!-- quickstart:end -->

If npm prints an `allowScripts` warning for esbuild, use `npm rebuild esbuild` if the build cannot start; napkin does not need any new dependency.

Open the printed canvas address in your browser. It starts at **http://127.0.0.1:4810/**,
or the next free port. The starter `Welcome.tsx` is already on the canvas. Press **N**
to create another component; **F**, **T**, and **I** draw inside it. Press **?** for
all shortcuts or **Ctrl/Cmd+K** to find a component, layer, or action. Stop with Ctrl+C.

The checkout also provides `npx napkin init ./another-napkin` and
`npx napkin open ./another-napkin`; nothing needs publishing or a global install.
`init` creates an empty project and prints connection details; `open` starts the server.

Both commands print a ready-to-paste **`.mcp.json`** object for Claude Code.
Paste it into your agent project's `.mcp.json`, then restart Claude Code. It uses
`node`, the absolute path to this checkout's `src/mcp.js`, and the running canvas's
`NAPKIN_URL` with `NAPKIN_AGENT=claude`. If an occupied port moves the server,
use the snippet from `open`. Keep the canvas running while reviewing proposals.

Every component is a real React TSX file your app can import directly. There is
no export step and no napkin runtime dependency. Edits in a text editor or from
an agent appear live. The dialect is described in [decision 0003](docs/decisions/0003-tsx-dialect.md).

## Open an existing repository

```sh
node src/cli.js open /path/to/your/repo
```

Without a `napkin.json`, napkin scans every `.tsx` below that folder, skipping
`node_modules`, `dist`, `build`, and `.git`. The report lists editable files and
read-only files with all blocking constructs and their lines. The address prints
before scanning finishes; components and scan progress stream into the canvas,
and offscreen previews bundle when brought into view. The pinned shadcn reports
are in `docs/evidence/OPN-04.txt` (canonical UI) and `OPN-04-full.txt` (all 3,674
TSX files); `node tools/shadcn-report.js --archive <pinned .tar.gz>` reruns the full census. Opening, classifying and rendering write
**no files in that repository**. The single-writer lock lives in the OS temporary
folder. In foreign repositories, frame positions persist only with `--write-sidecars`. Otherwise positions last only for the session; pass `--write-sidecars` to allow
`.napkin/lock` and position sidecars in the repository. A `napkin.json` project
uses its `components` folder (configure another relative path with `"components"`).

Read-only files still render with their default props. Missing imports, CSS or
context produce an error in that component's frame. napkin does not install a
repository's dependencies or invent its providers. `Ctrl/Cmd+K` finds nested files too.

To adopt a simple read-only file, ask the agent to call
`propose_adoption { "component": "Greeting" }`. The proposal contains the source
and a diff; inspect it through `GET /api/proposals`. Accept or reject it through
`POST /api/proposals/<id>/accept` or `/reject`, with your session bearer token
(from `POST /api/session { "as": "you" }`). Reject writes nothing. Accept goes
through the revision-checked store and the single commit path. A hand edit after
the proposal makes acceptance stale. Conversion currently supports synchronous,
named functions with string or boolean literal prop defaults containing intrinsic JSX and literal inline or constant style objects;
class names, hooks, imports with runtime effects, dynamic children, significant
text whitespace, and other unsupported behavior are refused with reasons.

An editable file changes only after an explicit edit; a read-only file changes
only after you accept an adoption. To keep a repository entirely untouched,
review the canvas and do not issue edits or accept proposals.

## Development

```sh
npm test
npm start
npm run demo
```

`npm start` opens a disposable copy of the fixtures. Tests use random server
ports and CPU Chromium; install Chromium or set `CHROMIUM` to its executable
for browser tests. The [proving demo](docs/demo/demo-log.txt) shows simultaneous
human and agent edits landing in the same Button component.

**On the canvas:**
- Pan with the wheel or Space-drag, zoom with Ctrl/⌘-wheel, pinch or `+` `-` (5% to 800%); `⇧1` fits everything, `⇧2` the selection, `⇧0` is 100%. Drag a frame by its title to place it (the position is saved in the `.napkin.json` beside the file).
- `⌘K` jumps to any component, layer or action. `Enter` focuses the selected component, `Esc` comes back; `#Button/label` in the address deep-links.
- The left tree is the JSX: click to select, F2 or double-click to rename, drag to reorder. Shift-click or drag a box to select several; hold Alt to measure to the hovered element.
- Click an element to select it.
- The panel edits styles on the **Base** or on **This variant**. An override shows a dot and a "Reset to base" button.
- The panel also edits text, "Make setting" (text becomes a prop), props and defaults, and variant axes and values.
- Tools: `V` select, `F` frame (drag to size), `T` text, `I` image slot, `N` new component.
- Delete removes the selected element, and Alt+↑/↓ reorders it.

**History and inspection (history lane):** `⌘Z` / `⇧⌘Z` undo and redo your own edits (never an agent's; refused, naming who, if someone changed the same property after you). The drawer under the canvas has **Code** (live TSX, click a line to select its node), **History** (timeline, scrub to preview, Restore), **Inspect** (computed CSS per cell, with where each value comes from, and Copy usage), **Assets** (images in the repo; drop an image on a node) and **Changes** (a dot on components that differ from git HEAD, line diff, before/after pictures). `node src/docs.js --dir components --out catalog` writes a static catalog. napkin never commits. Details: [CONTRACT](test/CONTRACT.md#history-lane-round-2-his-01-03-his-05-ins-01-05-ast-01-04), [decision 0009](docs/decisions/0009-history-undo-restore-git.md).

A file napkin can't read fully opens read-only with a badge, and napkin never rewrites it.

**Not in this build:** a tokens panel, Figma/HTML import, hosting. See FEATURES.md.

Contract the tests rely on: [test/CONTRACT.md](test/CONTRACT.md). Decisions: [docs/decisions/](docs/decisions/).
