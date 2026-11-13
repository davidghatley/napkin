# 0021 kinds: real format runtimes instead of miniatures

Status: accepted (lane decision, round 5)

## Context
For four rounds the critic found another valid file that the viewers drew wrongly: a Lottie with one precomposition was blank,
a textured glTF was flat gray, a Parquet file exposed 0.185% of its rows, a UTF-16 table stopped at 8 MiB. Each viewer was a
small home-made implementation of its format (a Lottie player, a software glTF rasteriser, a Thrift and page decoder for Parquet).
A miniature can only ever cover the files its author thought of, so every round exposed a new hole.

## Decision
Where a mature runtime exists, napkin ships it and drives it, and keeps only the glue:

| Format | Runtime | Licence | Where |
| --- | --- | --- | --- |
| Parquet | hyparquet 1.33.0 (no dependencies, about 270 KB of source) | MIT | `src/vendor/hyparquet` |
| Lottie | lottie-web 5.13.0 | MIT | `public/canvas/lottie-runtime.js` |
| glTF, GLB, OBJ | three.js 0.170.0 (GLTFLoader, OBJLoader, Meshopt, RoomEnvironment), bundled with esbuild | MIT | `public/canvas/model-runtime.js` |

They are vendored files, not npm dependencies: the repository's `node_modules` is shared between worktrees and the server
stays zero-dependency at run time. `node tools/build-runtimes.mjs` re-creates every vendored file from the pinned releases.

Independent, permissively licensed, small, widely used, and the formats' own reference-grade players: that is why these were
chosen over keeping and extending the home-made code. Vega-Lite stays on the in-house interpreter for now (no complete runtime
is small enough to vendor); it reports what it cannot draw.

## Consequences
- Cards for 3D files start on the light software drawing and take the real runtime when pointed at, so a thousand mixed items
  keep the frame budget (measured: loading the runtime in every card moved the zoom p95 from 16.8 ms to 50 ms).
- Draco-compressed glTF is not decoded (the decoder is a separate binary); the view says so.
- Lottie files that list shapes straight on a layer (not valid for the player) are wrapped in a group before playing.
