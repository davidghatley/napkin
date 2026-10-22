# Engine: what the numbers measure and what produced them

AI built the harness and the fixes; David has not yet reviewed them. Numbers and re-run commands are in `docs/evidence/` (one `.txt` and `.json` per row). Method details are in `bench/README.md`; the decision is `docs/decisions/0011-engine-shared-runtime-and-bounded-history.md`.

```mermaid
flowchart LR
  P[Panel / canvas tools] -->|HTTP edit + session token| S[store.apply]
  A[Agent over MCP] -->|HTTP edit + session token| S
  S -->|atomic rename| F[(TSX on disk)]
  S -->|change| W[workspace]
  W -->|incremental esbuild, React external| B[component bundle ~5 KB]
  R[/runtime.js: one React/] --> C
  B -->|GET /bundle| C[canvas cells]
  S -->|SSE change| C
  C -.->|stream ends| X[reconnect: new token, full snapshot, diff]
  X -.-> C
```

## Where a panel edit's time goes (PRF-02, 200 components)
Tab key, then POST and SSE (about 30 ms, mostly waiting behind a frame), bundle fetch and mount (about 15 ms), the frame that paints it. The frame itself was the largest cost: with a transform on each of 200 frames, and 17,000 hidden but still styled elements, each frame spent about 25 ms in layerize. Moving frames with `left`/`top`, and removing the contents of culled frames, took the median edit from 227 ms to 74 ms.

## Results (re-run commands are in each file)

| Row | Bar | Measured | Evidence |
|---|---|---|---|
| PRF-01 cold open, 40 components | p50 <= 1.5 s | p50 1043 ms, p95 1060 ms | PRF-01.txt |
| PRF-02 panel edit to pixels, 200 components | p95 < 100 ms | p50 73.6, p95 74.6 ms | PRF-02.txt |
| PRF-03 agent edit (MCP) to pixels | p95 < 100 ms | p50 63.7, p95 92.9 ms | PRF-03.txt |
| PRF-04 5 s pan | p95 frame <= 16.7 ms | CDP trace, about 300 frames: 0 to 3 missed vsyncs and 0 to 2 dropped frames per run, no main-thread task over 16.7 ms (longest 8 to 14 ms), p95 16.7 ms in whole vsyncs (raw p95 17 to 20 ms is software-compositor timestamp jitter); same with a zoom step every 12th event | PRF-04.txt |
| PRF-05 rebuild | p95 <= 50 ms | p95 7.9 ms | PRF-05.txt |
| PRF-06 edit #2000 vs #1 | <= 2x | 0.49x (9.2 vs 18.6 ms) | PRF-06.txt |
| PRF-07 memory at 200 | server <= 500 MB, page <= 400 MB | 129 MB, 18 MB | PRF-07.txt |
| PRF-08 typing | p95 <= 50 ms | p50 38.0, p95 38.8 ms (47.9 in another run) | PRF-08.txt |
| REL-03 reconnect | <= 2 s | worst 204 ms; stale, never lost | REL-03.txt |
| REL-04 30-minute soak | 0 errors, RSS growth <= 20% | 0 errors, 12.4% (first run 35.5%) | REL-04.txt, REL-04-before.txt |
| REL-05 branch switch, 40 components | <= 2 s | 667 ms | REL-05.txt |

The numbers move a little from run to run (a shared machine, CPU-only Chromium); the .json files keep every sample. PRF-04 is measured from a Chromium trace (see bench/README.md). During a wheel or drag gesture the view moves only by compositor transform: overlays are placed from geometry cached in canvas units, handles are translated or hidden, culling only adds frames, the title and label scales wait for the view to settle (160 ms idle), and `will-change` is dropped on settle so text is re-rasterised crisp. Frame titles use `zoom` instead of `transform: scale()` (200 scaled titles were 200 paint layers, costing 7 to 9 ms of layerisation per pan event), and attributes are never rewritten with the value they already have (that repaints the page).
