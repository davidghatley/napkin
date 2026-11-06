# Measures

## P0 locked measures (DREAM 2: D1, D2, D4)

These four scripts are the gates for the engine rebuild (`.dream-gauntlet/plan.md`, P0). They are **locked**:
builders never edit them, the edge corpus, or `bench/p0-lib.js`. They talk to napkin only through the engine
contract in the plan (`node src/cli.js open <folder> --port P`, then `/api/files`, `/api/component/<id>`,
`/view/<id>`, `/api/edit`, `/api/undo`, `/api/styles`) and start Chromium only through `src/chromium.js`.
The lead (Claude, Opus) wrote them on 2026-10-30; the corpus choice and the pass lines come from DREAM.md, which
David approved.

Every script prints one JSON object as its last line and exits 0 on pass, 1 on fail, 2 if the harness itself
could not run. The line carries `harness` (a hash of the locked files and the edge corpus) and `official`
(false when `NAPKIN_P0_ENGINE` points the harness at something other than `src/cli.js`). Only official runs
with the default options count. Check `df -i /tmp` first; each script uses one headless Chromium (CPU).

```sh
node bench/corpus.js                 # assemble the corpus; prints the folder (remove it when done)
node bench/fidelity.js               # D1, about 4 min
node bench/edits.js                  # D2, about 2 min plus napkin's restart time x 60
node bench/imposed.js                # D4, under 1 min
node bench/edits.js --selftest       # checks the edit table against the corpus (no napkin)
NAPKIN_P0_ENGINE=bench/p0-mock.js node bench/fidelity.js   # harness proof: a contract stand-in passes (official: false)
```

Each measure assembles a fresh corpus under `/tmp/claude-1000/` and removes it at the end (`--keep` keeps it,
`--corpus DIR` reuses one; `fidelity.js --folder ss-ds,edge` and `edits.js --only E01,E02` narrow a run, which
then reports `fullRun: false`).

### The corpus (`bench/corpus.js`)

Copies only, read with `git archive` at pinned commits (`--latest` takes each repo's HEAD); nothing is written
into another repo. `manifest.json` records each source commit and a content hash per folder.

| Folder | What | Components | Applied stylesheets |
|---|---|---|---|
| `ss-ds` | secret-sauce `ds/project` + `tokens.css` + `components.css` at its root | 22 `components/*/preview.html` | `tokens.css`, `components.css` |
| `recipes` | secret-sauce `recipes/*.html` + `tokens.css`, `components.css` and the fonts they name | 4 | none (they link their own) |
| `edge` | `bench/corpus/edge`: 10 hand-written files (below) + one local woff2 (secret-sauce Hoop Bold, OFL) | 10 | none |
| `tsx` | sample-40 from `tools/sample-repo.js` as it was at napkin 3181316 | 40 | none |
| `shadcn` | playdough `app/src/components` + `tsconfig.json`; `node_modules` is a symlink to playdough's | 6 files | none |

Edge files: `inline-style.html` (odd spacing, comments, `!important`, quote styles, unquoted and bare
attributes, UTF-8), `import.html` (+ `css/`: a `<link>` that `@import`s, and `@import` in `<style>`),
`media.html` (`@media` by width and by colour scheme), `custom-element.html` (shadow DOM, slot),
`svg.html` (inline SVG, `<defs>`/`<use>`), `font.html` (`@font-face` from a local file), `vars.html`
(fallbacks, nested fallbacks, undefined variables, an inline custom property), `hover.html` (`:hover`,
`:focus-visible`), `grid.html` (named lines, areas, `auto-fill`), `table.html` (no `<tbody>` tag, uppercase
tags, tabs, CRLF line endings; `.gitattributes` keeps the bytes).

### D1 fidelity (`bench/fidelity.js`)

For each folder: open it, answer `POST /api/styles { applied }` (then `GET /api/styles` must echo it), list
`GET /api/files`. Every component file in the table must be listed with at least one component. Every
component napkin lists in an html/tsx/jsx file is shot at widths 360 and 1024, light and dark:

- napkin: `GET /view/<id>?width=W&theme=T` must answer 200, then Chromium loads it.
- reference, HTML: the file's own `file://` URL with the applied stylesheets inserted first in `<head>`.
- reference, TSX/JSX: a plain React page (doctype, UTF-8 meta, the applied stylesheets, `<div id="root">`), the
  named export (else default) rendered with no props, built by esbuild with the folder's `node_modules`.
  If the reference itself throws (for example a Next.js router hook), the component is listed as
  `noReference` and only has to render.

Both sides: viewport W x 900, `prefers-color-scheme` = T, animations frozen at their start, wait for load,
fonts in every same-origin frame, images and two animation frames, then resize to the page's own height
(max 8000) and capture. A pixel differs when any channel differs by more than 2/255; sizes that differ count
every uncovered pixel. For HTML files, every element in `<body>` (by source start tag; not script, style or
template) must have a node in `GET /api/component/<id>` whose `start` is that byte offset.

**Pass:** 100% rendered; every measured component's worst config at most 0.1% pixels differing; napkin's view
throws no error the reference did not; 100% of HTML elements selectable; 0 contract errors.

### D2 edits (`bench/edits.js`)

60 edits, 6 per op (text, attr, class, style, rule, var, insert, move, delete, prop), over ss-ds, recipes,
edge, tsx and shadcn. Each starts from the pristine file. Nodes are found in `GET /api/component/<id>` by the
byte offset of their start tag (the harness also checks that the node's tag really starts there). Each edit
is chosen to catch reformatting: single-quoted, unquoted and bare attributes, irregular spaces in a class
list, CSS with odd spacing and comments, alignment spaces in a variable block, CRLF and tabs, multi-byte
UTF-8, multi-line JSX with arrow-function props and spreads. Checks:

1. **span**: the edited file equals the expected result. Bytes outside the edit are compared exactly; inside,
   only what the op asks for (values replace values; whitespace may vary only where an element is inserted,
   moved or deleted, or a declaration or attribute is added or removed; a new attribute goes after the
   existing ones; a class list keeps its order).
2. **others**: no other file in the folder changes, appears or disappears.
3. **reopen**: `/view` (800, light) right after the edit equals `/view` after napkin is stopped and the
   folder opened again (at most 0.1% pixels differing).
4. **undo**: `POST /api/undo { component }` restores the file and the folder byte for byte.

**Pass:** all 60 edits pass all four. `--selftest` proves the table is sound against the pinned corpus:
anchors unique, each canonical result matches its own expectation, the unedited file does not, and a stray
byte before or after the span, or CRLF turned into LF, is rejected.

### D4 nothing imposed (`bench/imposed.js`)

Each folder is committed to a fresh git repo, then `node src/cli.js open <folder> --port P`. Timed from the
command: the first 200 from `GET /api/files`, and the first `/view` of the folder's first component drawn in
Chromium (fonts and images loaded; Chromium is started before the clock). Then `POST /api/styles`, one edit
(`attr` on HTML, `prop` on TSX: `data-bench="one"` on the component's first node), and napkin is stopped.
`git status --porcelain --untracked-files=all --ignored` must be empty after opening, exactly
` M <edited file>` after the edit, and the same after napkin stops.

**Pass:** every folder passes, and ss-ds's first `/view` is drawn within 2000 ms of the command.

### Notes for whoever reads a failure

- `startNapkin` waits up to 30 s for `GET /api/files`; a 404 from a running server ends the wait at once.
- If an engine answers 401, the harness asks for an identity once with `POST /api/session { as: 'napkin-bench' }`
  (today's engine needs it). This is not in the contract; it is tolerated, never required.
- Failing captures are kept in the `out` folder the summary names (`*.napkin.png`, `*.reference.png`).
- `bench/p0-mock.js` is not an engine: it serves files as they are and "edits" by writing the expected result.
  It exists to show the measures can pass (all three pass with it, `official: false`).

## Engine measurements (older, TSX era)

These scripts drive the real server, store, esbuild and canvas page. Chromium is headless with
`--disable-gpu` (CPU only). Every listener starts on port 0, except the restart tests, which
bring a server back on the port it had. No dependencies were added.

The harness (corpus, perf, soak) was first built by Codex against an older core; it was then
rebuilt here on the current canvas (shared React runtime, session tokens, hash revisions,
`src/chromium.js`).

```sh
node bench/corpus.js --size 40            # prints the temp folder it made; remove it when done
node bench/perf.js                        # PRF-01..08 and REL-05; one row: --id PRF-02
node --test test/engine/                  # REL-03 reconnect + shared-runtime tests (EVIDENCE=1 records the REL-03 text)
node bench/soak.js --duration 1800 --size 200 --interval 1000 --seed 1729   # REL-04
```

Each measured row writes `docs/evidence/<ID>.json` (raw samples, machine, method, SHA-256
of the measured sources) and `<ID>.txt` (result and the exact re-run command). A missed bar
exits nonzero after the measurements are written; `node bench/perf.js` runs every row even
when one misses. Generated TSX never goes into git. The branch-switch row stages and commits
only inside its generated temp repo.

Default `npm test` skips the expensive workloads. To run them as tests:

```sh
PERF=1 node --test test/engine/bench.test.js
SOAK=1 node --test test/engine/bench.test.js     # 60 s soak, writes REL-04-60s only
```

## Methods

- `PRF-01` starts the clock before the server spawns and stops it after all 40 sections are
  ready, every expected cell holds its component, there are zero build/render errors and two
  animation frames have run. Chromium launch is excluded; the OS file cache is not flushed.
- `PRF-02`, `PRF-03`, `PRF-08` use wall-clock times (`performance.timeOrigin + performance.now()`)
  so a separate MCP process and the page share a clock. "Painted" means: the new value is in
  every cell of the edited component, layout is forced, then two `requestAnimationFrame`
  callbacks have run (a conservative paint proxy, not a physical display). 40 trials, the first
  10 are warm-up and not counted, nearest-rank p95. The edited component is revealed at its own
  size first, with 200 components (1,131 cells) loaded; an edit to a component that is off-screen
  is deliberately not drawn until it scrolls into view.
  - `PRF-02` types a new default for a setting and presses Tab; timed from that key event.
  - `PRF-03` is an MCP `apply_edits` call from another process.
  - `PRF-08` types into the padding field with focus kept; timed from the `input` event to the
    selected node showing the new padding (the canvas previews while you type; the edit is written
    on commit).
- `PRF-04` first lays the 200 generated components out as a grid (about square; the stage packs the
  corpus into one tall column when it is packed zoomed out) and selects the component nearest the middle.
  It then sends real CDP wheel events for five seconds (one every 16 ms without waiting for each
  acknowledgement; about 300 land) while a Chromium trace (Tracing domain) records. Four runs:
  `pan` (30% zoom, scrolling about 370 px back and forth around the selection; it stays on screen),
  `pan+zoom` (the same with every twelfth event a Ctrl-wheel zoom step, 1.27x, in for a second, out for a
  second, anchored on the selection), `sweep+zoom` (30%, 25 px per event around a square of about 7,500 px,
  so components are un-culled and rasterised throughout; the selection leaves the screen) and `overview`
  (the same sweep from 10%). Reported per run: raw p95 frame time (presentation to presentation, from the
  compositor's PipelineReporter events), the same rounded to whole vsyncs, frames of at least 25 and 33 ms
  and the longest frame, dropped frames, main-thread long tasks (over 16.7 ms) with the longest, the
  components on screen and un-culled (geometry sampled every 100 ms, no layout) and the share of frames with
  the selection on screen. At 30% zoom the real components are tall: 3 to 10 are on screen (not 30), and 10%
  zoom shows up to 28.
  The same run measures two floors in Chromiums of their own: a page that only moves a translate3d every
  frame, and the same page driven by the same wheel events, with `loadavg` and the number of chromium
  processes. Pass, every run: raw p95 <= max(16.7, floor + 1) ms, at most 2% of frames >= 25 ms and at most
  2% dropped. The benchmark never injects a transform.
  `--gpu` (run it as `~/anime-pipeline/tools/gpu_run node bench/perf.js --id PRF-04 --gpu`; the GPU is
  shared) launches every Chromium of the run with GPU raster (`--enable-gpu-rasterization
  --ignore-gpu-blocklist --use-angle=gl --use-gl=angle`, headless=new) and fails unless `SystemInfo.getInfo`
  reports `gpu_compositing: enabled`, `rasterization: enabled*` and an NVIDIA renderer; that report is in
  the evidence (`docs/evidence/PRF-04.gpu.json`, the CPU run is `PRF-04.json`). `--use-angle=vulkan` also
  works here; plain `--use-gl=egl` and the default fall back to software.
  Zoom steps alternate in and out. (An earlier version zoomed in for a whole second: the view then sat on the
  gaps between frames, nothing on screen changed, and the compositor drew no frames for 200 to 380 ms. That
  "stall" was the benchmark looking at empty canvas, not a stall; it is gone now. The overview sweep is
  scaled to stay inside the grid for the same reason.)
  Floor on this machine, five-second runs: raw p95 16.9 ms CPU (0 frames >= 25 ms), 16.9 to 17.0 ms GPU (1
  frame >= 25 ms), with 51 to 66 chromium processes alive and a load average of 0.5 to 2.9.
  State at the last commit, three consecutive CPU runs (FAIL on the p95 bar in most scenarios; GPU not re-run
  after the correctness fixes below): `pan` raw p95 17.95 to 18.68 ms against a bar of 17.9, 0.7 to 1.7% of
  frames at 25 ms or more; `pan+zoom` 17.4 to 22.2 ms, 0.3 to 1.7%; `sweep+zoom` 21.1 to 23.5 ms, 1.7 to
  3.4%; `overview` 21.8 to 22.6 ms, 0.7 to 1.7%. Fixes that made the canvas correct during a gesture cost
  about 2 to 4 ms of raw p95 in the zoom runs against the previous commit (2be2653: pan+zoom 17.7 to 18.2).
  What a gesture does now: the world moves by transform; frames that come into view (pan or zoom) are drawn
  within a frame (nothing is taken out until the gesture settles; frames more than a viewport away are
  `visibility: hidden`); titles and every label scale (`--nk-lf`, `--nk-ls`) are set on the frames on screen
  as soon as they are 1.4x off, so they are never more than 1.4x wrong (a transform, so nothing shifts), and
  go back to the world's value on settle; the overlay boxes are layers of their own, positioned and sized at
  1x (the outline and pills are not stretched); the handles are drawn again at every zoom step and moved with
  the world on a pan; the dot grid is scaled by transform from its drawn pitch and redrawn on settle. Tests:
  `test/engine/pan-gesture.test.js` (no blank frame in view, labels within 1.4x, handles in place, CLS).
  What the earlier raster work found: each zoom step used to re-rasterise the page (about 100 raster tasks);
  the overlay boxes in the root layer, the grid and the titles were the causes (now about 31, the frames the
  zoom un-culls).
- `PRF-05`/`PRF-06` apply 2,000 real `store.apply` edits to a 200-component workspace and time
  the incremental esbuild rebuild and the whole apply-to-bundle path. Edit #1 and #2000 are kept.
- `PRF-07` samples the server's `VmRSS` and the page's live JS heap after an explicit GC.
- `REL-04`: two concurrent agents choose seeded random components and valid edits for the
  duration; every accepted revision (or a newer one) must reach the page; all files are parsed
  each minute and at the end; RSS growth is the largest sample against the post-warm-up baseline.
- `REL-05` runs an actual `git checkout` in a generated temp repo that changes all 40 files.
