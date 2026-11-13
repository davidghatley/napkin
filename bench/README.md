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

## DREAM 3 locked measures (D1–D8)

The measures lane owns `corpus3/`, `lib3/`, `kinds.js`, `controls3.js`, `keys3.js`,
`board.js`, `agents3.js`, `gen.js`, `motion.js`, `craft.js`, `dream3.js` and
`tools/make-corpus3.mjs`. Product builders do not change these files. DREAM 3 and
INTENT stay locked.

**Acceptance is the whole scoreboard.** `node bench/dream3.js` runs D1 to D8, the three
legacy benches (`fidelity`, `edits`, `imposed`) and, with `--tests`, the full test suite.
ACCEPTANCE is MET only when every check in every dimension passed, every regression gate
passed, and every lead-attested gate is satisfied, all in that one run. `--only`,
`--skip-legacy` and a missing `--tests` are for quick looks: whatever they leave out is
reported as "not run" and blocks acceptance. D8 has no beat-the-best mark.

Run from the checkout root, with Node 26, Chromium, ffmpeg/ffprobe, woff2 tools,
zip/unzip and pdfinfo available. There are no new product or bench runtime npm
dependencies. Chromium always uses CPU rendering; unset `NAPKIN_GPU`.

```sh
node bench/kinds.js --json
node bench/controls3.js --json
node bench/keys3.js --json
node bench/board.js --json
node bench/agents3.js --json
node bench/gen.js --json
node bench/motion.js --json
node bench/dream3.js --json
```

Each dimension prints a human table. `--json` adds one final line with
`{ dimension, dream: {met,total}, beat: {met,total}, checks: [{id,ok,value,target}] }`.
The combined runner executes dimensions sequentially and prints one scoreboard;
its final JSON contains the eight dimension summaries and the regression gates. Exit 0 means every check
passed; exit 1 means at least one failed. A missing route, missing tool, timeout,
invalid response or missing external evidence is a **failure**, with its reason.
Nothing is silently skipped. D7 and D8 have no separate beat mark in the locked dream, so
their beat denominators are zero. Counts are assertions, not percentages of a rubric.

Every dimension opens a private, generated folder with the real command
`node src/cli.js open <folder> --port <free>`. State is isolated outside that folder.
No request goes to port 4820. Only processes created by that bench are stopped.
Generated folders, stress media, browser profiles and state are removed in finally
blocks. `--out <directory>` writes screenshots there as evidence; this is a requested
artifact directory and is deliberately retained. The bench never edits the committed
corpus or the owner's folders. Every generated source folder starts in a clean git
repository. Opening and organizing may not create even ignored files there.

### Corpus and anti-gaming

`corpus3/manifest.json` lists all 48 files: canonical `kind`, byte count, SHA-256,
required semantic DOM selectors, text derived from the file, and expected metadata
(row/column counts, durations, dimensions, glyphs, vertices, archive entries).
There are 47 distinct kind labels, covering every format family named in D1.
The generator writes actual codecs and containers: Parquet page and Thrift metadata,
Arrow IPC, SQLite, PNG/JPEG/WebP/AVIF/GIF/APNG, H.264/VP9 video, four audio codecs,
Lottie, an xref-based PDF, a GLB with a binary mesh, glTF/OBJ, TrueType/CFF/WOFF2,
notebook, archive, ComfyUI API and UI workflows, and structured run logs.
Everything is original and dedicated to CC0, including the geometric font outlines.
The corpus is below 1 MB; no downloaded creative assets or system fonts are included.

For each run, the bench chooses cryptographically random names, text values,
Parquet/SQLite/CSV/TSV/JSON/JSONL row counts and values, Arrow values, proposal contents,
control targets, model names and seeds. The product never receives the manifest.
Known media bytes are not a substitute for dynamic identity and outcome checks.
D1 also compares decoded pixels of still-image previews with the source image.
A fake viewer with an icon, hidden native element and a plausible label does not
satisfy visible markers and the data checks.

The generator and the self-test need three **generator-only** packages that the product never
loads. They are declared and pinned in `bench/tools/package.json` (with its lockfile) and are
installed into `bench/tools/node_modules` (git-ignored):

```sh
npm ci --prefix bench/tools --ignore-scripts --no-audit --no-fund   # apache-arrow, parquetjs-lite, opentype.js
node tools/make-corpus3.mjs                                          # rebuild the committed corpus
D3_STRESS_SELFTEST=1 node --test bench/lib3/selftest.mjs             # the harness self-test
```

`NAPKIN_D3_TOOLS` may point at a different install directory. These tools are Apache-2.0/MIT;
decision 0018 records why they are used. Ordinary benches use the committed binaries, Node's
SQLite and the in-lane Parquet writer, and need no install. The self-test also needs `ffprobe`,
`pdfinfo` and Chromium on the machine; it creates short socket paths itself (no wrapper script).

The self-test uses independent Arrow, Parquet and font readers, ffprobe, pdfinfo,
unzip, SQLite, Chromium font decoding, actual key events, actual compositor frames,
and positive/negative ComfyUI requests. It includes a multi-row-group Parquet test.
Set `D3_STRESS_SELFTEST=1` to include the large workload validation; this switch only
affects this development self-test, never the seven measuring suites.

`stress(dir)` in the committed generator makes exactly 1,000 primary mixed items,
a 5,000,000-row Parquet with bounded row groups, and a valid H.264 MOV over 2 GB.
The large video repeats real encoded frames; it has neither sparse holes nor filler.
The public `--stress --out <temporary-directory>` command is available for inspection;
the caller owns that directory. The benches create and remove theirs automatically.
When `/api/items` is absent, expensive D1 workloads cannot reach a viewer: their
checks still fail with that explicit route failure. The self-test independently
proves that the workload generators run, rather than treating missing routes as proof.

**Bench-time randomisation.** Each run re-makes the content a viewer must show, from the
committed corpus' structure: colours in svg, lottie, html, css, tsx and animation files; stills,
gif/apng and video from ffmpeg with this run's colours (video: first half one colour, second
half another, duration random); audio with a random frequency, duration and a rising
amplitude ramp (a waveform must be taller late than early); zip entries with random names and
bodies; binary files with random leading bytes and a random string; table rows, chart data and
all names. Oracles read the screen: this run's colours must appear in the viewer, animated
kinds must change over time, video frames sampled at 25% and 75% must match the file, a
waveform must follow the ramp, a random late table row must be reachable by scrolling, chart
mark heights must follow the data (SVG marks), an opened zip entry must show its body, the hex
view must show this run's first bytes, a font specimen needs a loaded FontFace, a model must
turn. "First paint" is the later of first-contentful-paint and the moment every manifest
marker is visible with its text.

**Causality for timing.** `scrubWalk` (lib3/pixels.mjs) takes a random walk of key presses.
The preview must be still when no key is pressed, every step must change it, and revisiting a
position must show the same frame. An animation unrelated to the keys, or a preview that
changes on any key, fails.

**Frame budget.** `FRAME_BUDGET` (17.2 ms) is the p95 frame-interval limit used for the
"p95 frame < 16.7 ms" marks: requestAnimationFrame timestamps are quantised to the vsync, a
perfect 60 Hz page measures 16.6 to 16.9 ms and a page that misses a vsync measures at least
33 ms. The scrub-to-pixel latency marks still use 16.7 ms.

**Focus.** A page in headless Chromium is never focused, so `:focus-visible` never matches;
the benches turn on focus emulation. Focus counts as visible only if a real outline or ring
(at least 1.5 px, not transparent) is drawn and its colour is found in the pixels around the
element. Being a text input, or a caret, does not count.

### Observable conventions beyond the locked route shapes

The locked HTTP routes are used as written. The dream describes UI state, review,
bindings and provenance but does not fix every field or MCP tool name. The following
conventions make those observations concrete before builders implement them:

- Canvas item containers expose `data-item-id`. Instrument regions expose
  `data-controls-for="<item id>"`; individual control rows expose `data-control-id`.
  These identify semantic regions; the benches never call product functions.
- The viewer root exposes the contract's `data-napkin-kind`. All manifest markers
  must be visible. Typed table headers expose `data-type` or `data-column-type`;
  distributions expose `data-distribution`, or an SVG/canvas labelled “distribution”.
  Each column needs both. Counts must be visible, not only hidden metadata.
  Kind names: the viewer reports the canonical kind, or an alias from `kindAliases` in
  `corpus3/manifest.json` (`patch` may be `diff`, `agent-run` may be `agent-log`). Generic kinds
  (`txt`, `json`, `code`) are never aliases for a specialised file.
  Fonts, archives and binaries have no required tag names: a font passes when visible text is set
  in a loaded non-generic FontFace and its measured advance width equals the font file's own
  (read with opentype.js) and paints ink; an archive when its entry names are visible and clicking
  one shows its body; a binary when the file's first 8 bytes appear as hex and its embedded string
  is visible.
- Timeline controls are accessible range inputs/sliders with “time” in their label.
  Standalone animated viewers must offer a keyboard path to that timeline. Their
  dials schema includes loop/range and, for editable CSS/WAAPI/SVG, keyframe controls.
  A keyframe value is an array of at least two frame records, each an object that may carry
  `offset` and CSS properties; the bench sets `transform: "translateX(Npx)"` on the second
  record through `POST /api/control`. The file may encode it any way (CSS `@keyframes`, WAAPI
  `animate()`, SMIL, `transform` attributes): the bench only requires the number N in the
  written code (comments do not count) and, after a restart, that sweeping the item's animation
  clock moves some element on screen by about N px (0.8 N to 1.25 N + 4 px).
- Board readback includes `selection: [id]`, `compare: {item, variants: [...]}` and
  `presentation: boolean`. `/api/keys` returns `{bindings:[{command,keys}],
commands:[{id,palette}]}`. Commands include arrange-by-kind and can be rebound.
- `POST /api/proposals {path,content}` creates an isolated create-file proposal;
  `GET /api/proposals/<id>` returns its `status` (`accepted` or `rejected` after review).
  A proposal must not write source bytes until accepted.
- Workflow inputs use `"nodeId.inputName"` keys. Array-valued inputs for scalar node
  parameters request the Cartesian sweep. `workflow` is an item id; passing a result
  item's id reopens its provenance. Generated items expose `meta.provenance` with
  `workflow` and `inputs`, and placeholders/events carry the returned `job` id.
- Review and presentation state is on screen: pending proposals are `data-proposal-id`
  cards (gone once resolved), variants side by side are `data-variant`, presentation sets
  `data-presenting` (or fullscreen) and fills at least 70% of the screen, arranged groups
  are `data-group-id` headings with the group name, the key map (`?`) and palette are
  `[role=dialog]` / `[role=option]` lists showing real bindings and command labels,
  a control's live figure is an svg, canvas or `[data-figure]` of at least 12 x 8 px inside its
  `data-control-id` row, the modified marker is `[data-modified]`, a studio is
  `[data-studio-for="<control id>"]` covering at least 30% of the screen for color and motion.
  A focus indicator is any visible difference between the focused and unfocused element and
  its 4 px surround (at least 4% of the box or 60 changed pixels, channel difference > 40): an
  outline, a ring, a background fill, an inverted colour or a thick underline all count; a
  blinking caret does not.
  A palette is typed with the exact command phrase followed by Enter. The top-ranked entry for
  an exact phrase must be that command (exact and prefix matches rank above fuzzy ones). The
  bench never types abbreviations.
  `GET /api/controls/<id>` sections may hold a single control. The `figure` field is optional;
  the rendered figure is not (an svg, canvas, img or `[data-figure]` of at least 12 x 8 px
  inside the control's row that changes pixels when the value changes), for every control
  including toggles and selects. At bench depth the opened section must be taller than a dial
  row and show min(2, controls in that section) controls.
  The axe states (palette, panel, studio, key map) are checked open first: a palette is a
  `[role=dialog]`, `[role=combobox]` or `[data-palette]` region with at least 6 descendants and
  `[role=option]` entries; a panel `[data-controls-for]` and a studio `[data-studio-for]` each
  have at least 8 descendants; the key map is a `[role=dialog]` with at least 10.
  Mixed-folder cards show content from the file: for plain-text kinds a distinctive word from
  the file body (not part of the path) is in the card's rendered text for at least 80% of the
  sampled visible cards.
  Palette commands used by the benches: `Select`, `Control`, `Dial|Bench|Studio`, `Reset`,
  `Open folder`, `Group`, `Compare variants`, `Approve`, `Reject`, `Generate`,
  `Arrange by <mode>`, `Present`, `Rebind <command> to <keys>`.
- Arrange modes are `kind`, `folder`, `date`, `similarity`, `tag`, `status`, `run`, and
  `meta.<column>`. `/api/board` groups are exactly the partition the data implies (the
  bench seeds a Latin square of kinds, folders and ages, front-matter tags and statuses,
  warm and cool images, two agent runs and CSV label columns). Runs are created with
  `POST /api/runs {name}` and `POST /api/runs/<id>/artifacts`.
- `resume_run` returns the next unfinished step (its id appears in the result).
- Control keys: ArrowRight/Left step, Shift+Arrow is coarse (larger than a step), Alt+Arrow
  is fine (smaller than a step); typed entry accepts math such as `12+7`.
- `/api/events` may be SSE or WebSocket on that same path. A WS-only server may take
  the isolated session token as `?token=`. SSE supports LF or CRLF boundaries.

If a contract-compatible product chooses a different observation shape, resolve
that with the lead before judging: do not put compatibility branches or bench-specific
responses into the product. These conventions are not permission to weaken DREAM 3.

### Builder-facing contract: hooks, commands and what is judged by outcome

Where a check needs a hook, this is the contract. Where an outcome can be seen another
way, the bench accepts the other way; those places are marked "or".

| Need | Hook the bench uses | Accepted instead |
|---|---|---|
| Canvas card | `data-item-id="<item id>"` on the card | none; every check that samples cards needs it |
| Selecting an item (D3 panel checks, D8) | palette phrase `Select <path>` | clicking the card, as long as `/api/board` `selection` then holds the id or a `[data-controls-for=<id>]` region shows. D6 keys journeys never fall back: they are keyboard-only |
| Item panel | `[data-controls-for="<id>"]` | D8 only: any visible aside / complementary / region / dialog / form that shows at least 3 of the item's first 6 schema control labels (text or aria-label) and holds at least 3 widgets (inputs, buttons, sliders) |
| Control row | `data-control-id` | D3 control checks need it |
| Studio | palette phrase `Studio <label>` and `[data-studio-for]` | D8 only: Enter / double click on the control's row, and any visible `[role=dialog]` as the pane |
| Keyboard control checks | palette phrases `Control <label>`, `Dial`, `Bench`, `Studio`, `Reset <label>` | none; typed exactly, never abbreviated |
| Arrange / review / present | `Arrange by <mode>`, `data-group-id`, `data-proposal-id`, `data-variant`, `data-presenting` | fullscreen for presenting |

Cards are judged by what they show, not by their markup. In the 1,000-item folder:

- Text kinds: a distinctive word from the file body is in the card's rendered text (at
  least 80% of the sampled visible cards, at least 3 judged).
- Every other kind: the colours that dominate the item's own `/view/<id>` render (up to
  three bins of at least 4% of the picture) must also appear in its canvas card at
  0.5% of the card or more, for at least half of those colours, on at least 80% of up to 10
  visible non-text cards (at least 3 judged). A card that holds three characters of
  placeholder text fails; a thumbnail, a plot, a waveform or a poster passes.
- A card with no real content fails the blank check even if it carries a `pre` or `ul`.

D8 is judged by outcome too. The panel must name the item's real controls and hold
working widgets for them. The studio must redraw: the bench changes the control through
`POST /api/control` and the studio pane's pixels must change (more than 60 differing pixels
within 0.9 s). An empty panel wrapped in the right landmarks fails.

### D1 and D2 methods

D1 checks every manifest file, the right MIME/bytes/kind, visible purpose-built DOM,
file-derived text and metadata, decoded media duration, typed distributions, image
pixels, screenshot luminance variance >20 and at least eight quantized colors.
First paint is the later of Chromium's `first-contentful-paint` and the moment all manifest
markers are visible with their text, from navigation, with all items
required and nearest-rank p95 strictly below 150 ms. Twelve random items of the 1,000 are also
opened alone and must show the right kind and real content. The 1,000-item opening clock
includes CLI readiness and canvas navigation. Pan/zoom uses real wheel events,
requires real item geometry to move, then checks visible cards after 300 ms at rest.

**D1 frame budget (16.7 ms, the dream's number).** requestAnimationFrame timestamps are
vsync-quantised, so a p95 *interval* below 16.7 ms cannot be measured: a perfect 60 Hz page
reads 16.6 to 16.9 ms. D1 therefore measures what decides whether a frame is made in time, at
three viewport sizes (1100x700, 1600x1000, 1920x1080) over a 4 s, 240-event wheel gesture each:
the main-thread work of every frame (from the frame's rAF timestamp to a message posted from
inside rAF, which runs only after that frame's rendering task: callbacks, style, layout, paint)
must have p95 < 16.7 ms, and at most 5% of frames may be dropped (an interval over 1.5 times
the median vsync). Every viewport must pass. (`FRAME_BUDGET`, 17.2 ms on intervals, is still
used by the board bench.)

Large-file gates also seek the 2 GB video to a random distant offset (must settle in 3 s),
reach a random row (1 M to 4 M) and the last row of the 5 M-row Parquet file and require both
cells of each exactly (id and value as written), and measure isolated peaks: each large file
gets a fresh Chromium whose process tree is sampled every 10 ms from a baseline of the same
viewer settled on a small file of the same kind (so the increase is what the file's size costs), plus server-tree peak RSS (sampled from spawn every 10 ms) against an empty-folder
process, and page heap + backing storage against an empty page. Each
increase must be below 60% of the input size, with a decoded video or a visible
5-million-row count. This catches straightforward whole-file buffering on either
side; it does not prove an allocator-independent upper bound or measure OS page cache.

D2 discovers every declared section and control, chooses another value, writes it,
checks real item bytes or an adjacent recipe, checks API readback, and verifies exact
whole-folder undo. It also edits each control through the keyboard and opens all
three depths, taking screenshots when requested. A keyboard edit is the person's edit, so it
is undone the way the person would undo it: Ctrl+Z on the canvas (routed to the selected
item's history), then the item's Undo button; never the bench's own API session, which the
product rightly refuses as another caller's undo (409). The rendered-effect step loads
`/view/<id>` in a second browser, so the canvas tab keeps its selection and focus. Dial rows must be 32 px high.
Selection-to-panel timing starts at the final selection key, inside Chromium, and
ends on the correct instrument region's DOM mutation; search typing is excluded.
Scrub timing is `scrubWalk` (see Anti-gaming) on compositor frames cropped to the selected
item's own preview (the card named by the panel, not the first preview in the DOM). A
selection that shows no panel within 2 s counts as Infinity in `panel.swap`. Further D2 checks: each control's live figure must change its pixels when the
value changes; changing a control must change the rendered `/view` (at least 70% of
sampled controls on visual kinds, and undo must restore it); committed values must be
re-read from files by a fresh server process; the control types must be at least eight
distinct widget shapes; a numeric control must evaluate typed math (`12+7`), show a
modified marker, step finer and coarser with Alt and Shift, and reset. Studios and the
blind rubric are lead-attested (below).

### D1 differential fidelity (`bench/fidelity3.js`)

`kinds.js` proves each kind has a real viewer; `fidelity3.js` proves the viewer shows what the
file holds. Each run a seeded generator (`lib3/fidelity-gen.mjs`, seed printed in
`fidelity3.meta`, `--seed N` to replay) writes ordinary and awkward files of 16 families into
a fresh folder (nothing committed), and a trusted reference reads the same bytes back. The bench
then opens each file at `/view/<id>` like a person: scrolling (with proportional correction
from the rows on screen), End and Ctrl+End, typing a key into a filter or a row number into a
go-to input, last/next buttons (at most 40 presses), expanding disclosures, picking a table or
an archive entry. A missing reference (library or command-line tool) FAILS its checks with
"reference missing"; it never skips. Families, references and what must match:

| Family | Cases | Reference | Judged |
| --- | --- | --- | --- |
| CSV/TSV | leading zeros, ints beyond 2^53, decimals with trailing zeros, duplicate and empty headers, quotes, embedded newlines, CRLF, UTF-8 BOM, UTF-16LE, Latin-1, TSV with stray quotes, 8.6 MiB CSV, 8.6 MiB UTF-16 TSV | csv-parse on the decoded bytes | header in order; first, random and last row reached, every cell exactly as text; row count; `/api/items` table preview, if served, must also be exact |
| JSON/JSONL | 24-34 deep nesting, 1,200-1,800 element array (last and a middle element), big and precise numbers, 2,500+ line JSONL with unsafe ints | `JSON.parse` with source text | node reachable; numbers exactly as written; counts |
| Arrow | file IPC, stream IPC (`.arrows` and inside `.arrow`), 3 record batches, dictionary strings, nulls, int64, bool | apache-arrow | rows at batch edges and the last row exact; total rows |
| Parquet | 3+ row groups, UTF8, INT64, DOUBLE, BOOLEAN, optional UTF8 with nulls | parquetjs-lite | rows on both sides of each row-group boundary and EOF exact |
| SQLite | 3 tables, INTEGER/REAL/TEXT, ints beyond 2^53, zero-padded text, NULLs | sqlite3 CLI | every table listed and openable; per-table count; sampled rows exact |
| Markdown | GFM table, task list, fenced code, relative image | markdown-it | table cells, checkbox states, verbatim code, image loaded at its size |
| Vega-Lite | layered line+point, stacked bar, column-faceted bar | vega-lite + vega scenegraph | point count and positions (r > 0.98); bar columns, segments per column, heights (r > 0.98) |
| glTF/GLB | 3 instances of one mesh, a scaled node, a textured quad, unlit materials, external and embedded buffers | the file's own nodes (read back) | 3 separate red instances evenly spaced; scaled node area; both texture colours |
| Lottie | nested precomp, relative image asset, a layer without `st` | lottie-web rendered in the bench's browser | each part's colour drawn |
| PDF | 3-5 pages, page and block colours, text | pdfinfo, pdftocairo | page count; every page reached with the raster's block colour; reference text ink present |
| Audio | wav, mp3, flac, ogg of a 16-step amplitude envelope | ffmpeg decode, ffprobe | duration; waveform ink follows decoded peaks (r > 0.9) |
| Video | mp4, webm with 4 colour segments | ffmpeg frame extraction | frames at 4 jittered times |
| Fonts | static OTF with a seeded non-ASCII coverage; installed variable TTF | opentype.js; fvar table + fc-scan | glyph count, every covered character, each axis with range and a control |
| ZIP | nested folders, 18-19 MB stored entry, entries after it | unzip | every entry listed; large size; deep and trailing entries open |
| Images | 3xN, 7x5, alpha with a loud colour at alpha 0, animated GIF/WebP/APNG | ffprobe | size shown; colours visible; alpha respected; every frame shown |
| Sniffing | PNG without extension, PDF as .dat, ZIP as .txt, SQLite as .db, MP4 as .bin, WAV without extension, HTML as .bin | the source family | listed and viewed as the bytes' kind |

Three canvas checks follow: a TSX module with no component export still gets a card showing
its source; a folder holding only a kind registered through `NAPKIN_KIND_PLUGINS` shows each
card's content and a Layers row per file on first load; and a CSV selected through Layers +
Enter is on screen, opaque and hit-testable, and wheel (or its own next button) moves the
card's rows without moving the canvas. Where a viewer draws inside a sandboxed frame the bench
cannot read, it judges what is drawn instead (the sniffed page's red paragraph, the plugin
viewer's paper colour). The Lottie reference writes in the spec default `st: 0` for the layer
that omits it (lottie-web would skip that layer); the product gets the file as written. The
whole bench takes 1.5 to 3.5 minutes; `dream3.js` adds
its checks to D1's dream total.

### The twelve keyboard journeys and budgets

A chord counts as one keystroke; each typed character counts as one. Only CDP
`Input.dispatchKeyEvent` is used inside journeys. No click, mouse, wheel, injected
`.focus()`, `.value=` or synthetic DOM event is allowed. Setup may create source files
and proposals through the API. Assertions read disk and HTTP state, not UI text alone.
Every journey also requires visible focus (a drawn ring, see Anti-gaming), a nonzero
screenshot difference and the visible state named in its outcome (review queue card gone,
variants side by side, presentation filling the screen, group names drawn, key map listing
the real bindings). The rebind journey first moves the arrangement away from "kind" so a
no-op key cannot pass. axe runs on the populated canvas, with the palette open and with
the key map open; an empty canvas fails. The palette must list a random sample of
advertised commands.
Each journey has a pointer-step count P (the clicks, drags and confirmations the same
outcome needs with a mouse; typing a value into a field is one step on either side) and passes
only if its key steps are at most 2 x P (the Dream's ratio) and its raw keystrokes are within
the cap in the table. Key steps: palette open + a whole typed phrase + Enter = 3, a chord or a
single key = 1, a run of characters typed into one field = 1. P per journey: open folder 8, find
item 3, spatial focus 1, group 4, color target 5, compare variants 4, approve 2, reject 2,
generate 4, arrange 2, present 2, help and rebind 6.
The palette uses Ctrl K, a command phrase, and Enter. Names and values below are
chosen during the run; the brackets describe arguments, not literal text.

| Journey          | Scripted actions                                                     | Keystroke cap | Required outcome                                                           |
| ---------------- | -------------------------------------------------------------------- | -----: | -------------------------------------------------------------------------- |
| Open folder      | `Open folder [fresh folder]`, then `Open folder [original]`          |    160 | `/api/items` switches to the random sentinel and back; source bytes intact |
| Find item        | `Select [randomized HTML path]`                                      |     90 | Board selection contains that real item id                                 |
| Spatial focus    | ArrowRight                                                           |      8 | Focus follows the nearest rightward geometric neighbor                     |
| Group            | ArrowLeft, Shift ArrowRight, `Group [random name]`                   |    110 | API group holds multiple real items; disk stays clean                      |
| Color target     | `Select [HTML]`, `Control [color label]`, Ctrl A, type target, Enter |    160 | Exact random hex in schema and source file                                 |
| Compare variants | `Compare variants [TSX path]`                                        |    130 | API compares at least two real variants; typed gold/blue source survives   |
| Approve proposal | `Approve [proposal id]`                                              |     90 | Exact proposed random bytes land on disk; status accepted                  |
| Reject proposal  | `Reject [proposal id]`                                               |     90 | Status rejected; whole-folder bytes unchanged                              |
| Generate         | `Generate [workflow path]`                                           |    100 | Mock receives the request; exact output bytes and provenance land          |
| Arrange          | `Arrange by kind`                                                    |     40 | Board reports kind arrangement and real groups                             |
| Present          | `Present`, Escape                                                    |     30 | API presentation state enters and exits                                    |
| Help and rebind  | `?`, Escape, `Rebind [arrange command] to Alt+Y`, Alt Y              |    130 | Real key map changes and the rebound command changes board state           |

The map is checked against the command registry for 100% keyboard reachability.
Axe runs on the live canvas and must return zero violations. A map or palette that
only claims a command exists is insufficient for the twelve outcome checks.
The broad claim that _every_ pointer gesture has a path within twice its steps still
requires a fresh interaction review; these twelve budgets do not prove that claim.

### Organization and agents

D4 round-trips nested groups, saved views and pins, restarts the real CLI, checks
kind/folder/run/tag/date/status/similarity/metadata arrangements twice against actual
DOM geometry, and checks that pins keep their positions. It also arranges 1,000
mixed items while recording frame intervals, and checks git including ignored files.

D5 is **MCP only** for all product operations. Disk reads are independent assertions;
the bench never falls back to HTTP if an MCP tool is absent. The stdio client performs
initialize/initialized, tools/list and tools/call. The route mirror names are:
`list_items`, `get_controls`, `set_control`, `get_board`, `set_board`, `start_run`,
`add_run_step`, `add_artifact`, `get_run`, `checkpoint_run`, `resume_run`,
`propose`, `resolve_proposal`, `ask_question`, `answer_question`, `read_events`.
Arguments follow their HTTP bodies; `run`/`item` identify the path parameter.
`add_artifact` takes `{run,path,content,encoding,kind,step?}` with utf8 or base64.
`get_run` returns plan, steps, artifacts, questions and proposals. Step status is
`complete`. Event reads may consume events; the concurrency test uses one collector.

The 30 steps are: start run, read selection; place twelve artifacts (six kinds);
group; tune five controls; raise and read answers to three proposals; ask and read
one question; checkpoint; resume after stopping and restarting the CLI. Every step
must be persisted, not just counted locally. Four simultaneous MCP writers then place
40 unpredictable files and edit independent controls in the same item, retrying
explicit revision conflicts. All accepted bytes and values must survive. At least
30 matched event arrivals must have p95 below 100 ms.

For the real-harness gate, use the CLI's printed MCP connection line (the underlying
stdio command is `NAPKIN_URL=http://127.0.0.1:<private-port>/ NAPKIN_AGENT=<name> node src/mcp.js`).
Give an independent Codex run and an independent opencode run this task from a fresh
folder: “Connect using the README line. Start a run, place a component and five other
kinds of artifact, group them, tune a real control, propose an edit, ask for review,
and resume after napkin restarts.” No manual tool-name hints after starting. Keep
the complete transcripts, disk results and review answers as evidence. Missing runs
fail; a scripted MCP client does not stand in for either real harness.

### Generation and motion

`lib3/comfy.mjs` implements `/prompt`, `/queue`, `/history`, `/view`, `/object_info`
and the `/ws?clientId=` handshake. Queue entries are real five-element tuples;
requests are validated, execution is serial, progress carries node and prompt ids,
binary previews have the ComfyUI eight-byte header, and history contains exact prompts,
output descriptors and completion messages. It serves actual image, video, audio and
GLB bytes, rejects unknown outputs, and supports queue/history clearing and deletion.
The sampler's model filename changes per run and must be discovered from node schemas.
The mock computes no model output: it tests the transport and item lifecycle.

The shapes were studied using GET only on the owner's local ComfyUI `/object_info`,
`/queue`, `/history?max_items=1`, `/system_stats` and the upstream
[ComfyUI server](https://github.com/comfyanonymous/ComfyUI/blob/master/server.py) and
[binary protocol](https://github.com/comfyanonymous/ComfyUI/blob/master/protocol.py).
No real job was queued by this lane. `NAPKIN_COMFY_URL` always points to the private
mock during benches. The generation gate requires workflow-derived instruments,
a queued placeholder, multiple matching progress stages, exact output bytes,
provenance, identical backend prompts after reopening, and a seed/CFG Cartesian grid.
Video, audio and GLB also have to traverse that same path.

D7 uses keyboard timeline scrubbing and timestamped compositor pixels, not just a
slider's label. It requires 35 samples for every animated corpus family, a loop-range
instrument, random keyframes written back to CSS/WAAPI/SVG and exact undo/readback.
Interface transitions must be observable, interruptible, strictly below 200 ms, and
nonessential transitions must stop under emulated prefers-reduced-motion.

### Lead-attested gates

A bench cannot manufacture a blind review, a real harness run, a real GPU smoke, a slop
audit or a critics' rubric, and a file in this repository cannot stand in for them. These
gates are **lead-attested**: they are not met by default and read two inputs supplied from
outside the repo and its worktrees:

- `NAPKIN_LEAD_ATTEST`: path to a JSON document the lead keeps outside the repository.
- `NAPKIN_LEAD_PUBKEY`: the lead's Ed25519 **public** key as PEM text. The bench holds only the
  public key; the private key stays with the lead and is used by `bench/lead-sign.mjs`
  (`--keygen <dir>` once; `--key lead.key --file attest.json --name <gate> --json '{...}'` per
  gate). Nothing the bench's environment, process list or children can read allows signing. Both
  variables are also removed from `process.env` at start-up (`lib3/lead-env.mjs`), so the product,
  Chromium and MCP children never inherit them; `dream3.js` re-passes them only to bench children.

The document is `{ sourceHash, <key>: { attestedBy, at, ...fields, mac } }` where
`sourceHash` is `buildHash()` (lib3/reviews.mjs: hash of `src/` and `public/`) and `mac` is
the hex Ed25519 signature, by the lead's private key, of the canonical JSON of
`{ sourceHash, key, entry }` (entry without `mac`). A missing
file, an unsigned or wrongly signed entry, a different source hash or a file inside the repo
fails with `PENDING LEAD ATTESTATION`. Checks that wait on the lead are listed per dimension
as "lead-attested pending" and keep ACCEPTANCE at NOT MET.

Keys and the fields each must carry:

- `instruments` (D2 rubric): `blind`, `orderSwapped`, `comparisons:{Tweakpane,Leva,DialKit}` each >= 8.
- `studios` (D2): `features` and `captures` true for oklch, gamut, contrast, palette, ramps,
  harmony, sampledPalette, tokenBinding, history, curves, springs, ghost.
- `agents` (D5): for `codex` and `opencode`: `unaided`, `completed`, `readmeLine`, `runId`,
  `transcriptSha256`.
- `generation` (D6): `lockInvocation` (contains `gpu_run`), `nvidiaSmiBefore`, `promptId`,
  `historyStatus: "success"`, `outputSha256` equal to `resultFileSha256`, and
  `provenanceRequestSha256` equal to `reopenRequestSha256`.
- `craft` (D8): `blind`, `orderSwapped`, `critics: [{id, score >= 8, screenshotsSha256}]`
  from at least two distinct fresh critics.
- `slop` (D8): `tells: 0`, `skill: "slop-audit"`, `reportSha256`.

This lane forbids GPU work. A successful mock never satisfies the GPU smoke.
