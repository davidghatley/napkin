# 0022 kinds: one lossless table model, reference readers, and a gesture that only moves the world

Status: accepted (lane decision, round 6)

## Context
Rounds 3 to 5 all scored 4.5 and each round's fixes were local. Round 5's critic found the same kinds of failure again:
a CSV with two columns called `value` lost one of them (rows were objects keyed by header), `00123` became `123` and
`9007199254740993` lost its last digit (cells were re-printed through `Number`), an Arrow file in stream format or with
dictionaries read wrong (napkin had its own small Arrow decoder), Markdown tables and task lists did not render (a home-made
inline parser), a JSON array stopped at 200 entries, and zooming 1,000 files missed frames (33 ms p95 at 1280x820).

The structural causes were three: every tabular reader shaped its own rows and coerced its own cells; two more formats
(Arrow, Markdown) still had miniature implementations; and a pan or zoom did paint work on every frame.

## Decision
**One table model** (`src/kinds/cells.js`) for CSV, TSV, JSONL, JSON records, Parquet, Arrow and SQLite:
- a cell is the exact text of the file, or of the typed value the format stores (BigInt for 64-bit integers, the source
  text for JSON numbers through `JSON.parse` source access), never re-printed through `Number`;
- columns are positional, so duplicate and blank headers are separate columns;
- a type is a label (inferred from the text, declared by the format's schema, or overridden in the recipe with
  `columnTypes`, honoured by the CSV, TSV, JSONL, JSON-records and SQLite views; no panel control yet) that decides
  alignment and the distribution only. A leading zero marks an identifier, so `00123` is text;
- minimum and maximum are cells of the file, compared as BigInt for integers;
- a file that cannot be read faithfully says so on the card (ragged CSV rows, JSONL lines that are not JSON, an Arrow
  stream that ends early).

CSV parsing, the row index and the cell editor share one RFC 4180 field-state machine.

**Reference readers** instead of miniatures, vendored, with licences beside them:

| Format | Reader | Licence | Where |
| --- | --- | --- | --- |
| Arrow IPC (file and stream) | Apache Arrow JS 21.2.0 core with flatbuffers and tslib, bundled with esbuild (about 218 KB) | Apache-2.0 (tslib 0BSD, flatbuffers Apache-2.0) | `src/vendor/apache-arrow` |
| Markdown | marked 18.0.2 (GFM: tables, task lists, strikethrough, autolinks); raw HTML is escaped, links go through `safeUrl` | MIT | `public/canvas/markdown-runtime.js` |

napkin keeps only the glue: for Arrow, one pass over message headers finds the schema, the dictionaries and each record
batch with its row count; a window of rows is decoded by Arrow itself (its file reader with random access for the file
format; for streams, a small stream of the schema, the dictionaries and the needed batches in stream order).
`node tools/build-runtimes.mjs` re-creates both vendored files from the pinned releases.

**Differential tests** (`test/kinds/differential.test.js`) compare napkin's cells with an independent reader on seeded
random files: 60 CSV/TSV files against the sqlite3 importer (11,294 cells), 40 Arrow files (file and stream, dictionaries,
replacement dictionaries, nulls, several batches, int64) against Arrow's own read-back (33,402 cells), and SQLite databases
against the sqlite3 shell. They found one real bug on the first run (a window spanning two batches replayed every
dictionary before the first batch; replacement dictionaries then applied to the wrong rows).

**A gesture only moves the world.** Measured with Chromium traces on 1,000 files: in this Chromium, every frame whose
world transform changes re-layerizes the page (no fast path applies, even on a bare test page), and layerizing costs in
proportion to the paint chunks and layers. So during a pan or zoom:
- no frame is loaded or unloaded (cull keeps un-culling cards; loading waits for the view to settle);
- the stage's background position (kept for readers of its style) is written on settle, not on every event;
- titles are rescaled only for the cards on screen;
- the dot grid is the world's first child (its floor) instead of a separate layer under it. One painted area under every
  card lets Chromium paint all the cards into the world's one layer: on a bare world each card was a layer of its own
  (839 layers at 2560x1440, 16 after);
- video cards show their poster as an image until the pointer reaches them (a `<video>` is a layer of its own).

The surface lane owns `view.js`, `stage.js` and `layers.js`; the changes there are the ones listed above plus Layers
redrawing on the first layout (a folder of files only had no component render to draw its first rows).

## Consequences
- Every table kind shows the file's text; the differential tests guard it. Parquet has no differential reference yet
  (no independent Parquet writer or reader is available on this machine).
- The performance test is back to the strict bar: p95 frame < 16.7 ms for pan and zoom at 1280x820, 1600x1000 and
  900x700, with frame intervals counted in vsyncs (rAF timestamps are vsync-quantised, so a perfect page reads 16.6 to
  16.9 ms raw; counted in vsyncs, a missed frame is 33.3 ms and cannot hide in jitter).
- Open: at 1920x1080 on the test's 12-kind corpus a pan still misses about 12% of frames, and at 2560x1440 both pan and
  zoom miss frames. Layerize still runs every frame and grows as cards are un-culled during a long pan; the software
  compositor's own draw is about 13 ms per frame at 2560. Moving the pan to native scrolling (a compositor scroll needs no
  layerize) is the next structural step, and belongs to the surface lane.
- JSON documents over 1 MiB still show the limit instead of a tree.
