# 0010: One shared React for the canvas, a reconnecting client, and bounded revision memory

Status: **proposed** · Date: 2026-10-21 · Written by the AI builder (Claude, Sonnet) for the engine lane; David has not decided on this yet.
Builds on 0002 (one authority, SSE down, HTTP up) and 0009 (history, undo). The measurement harness was first built by Codex on the older core and rebuilt here.

## Context
The engine criteria (PRF-01..08, REL-03..05) measured what 0002 left implicit. On the first run every component bundle carried its own copy of React (about 690 KB each, 28 MB over HTTP for 40 components), the page restyled 21,000 elements on every pan event, every frame cost 25 ms of layerize work at 200 components, and server memory climbed with every revision.

## Decisions
- **Component bundles leave React external.** `src/bundle.js` marks `react`, `react-dom`, `react-dom/client` and `react/jsx-runtime` external; the canvas page's import map (`public/index.html`) points them at `GET /runtime.js`, which the server builds once with esbuild. Forty components share one React and one copy in the page heap. Bundles that are drawn outside the page (`render_component`, the visual diff) use `buildStandalone`, which keeps React inside, so they still run in a blank page. The server never rewrites bundle text, and the files stay ordinary TSX with no napkin import (INV-06).
- **The canvas client reconnects.** When the event stream ends it retries (50 ms, doubling to 500 ms), takes a new session token, reads a complete snapshot, then announces only what differs (`change`, `added`, `removed`, `canvas`, `preview`) and a `connection` frame. Writes are never replayed. While the stream is down, or if a request is cut off, `sendEdits` answers `stale revision ... the edit may have landed`, so the caller reads before retrying. Revisions are the content hashes already in the store; Codex's per-session UUID revisions were dropped.
- **Revision memory is bounded.** The store keeps the document and text of the newest 3 revisions per component in full. Older entries keep their text deflated (in a buffer of exactly its size) and rebuild the document by parsing when undo, restore or preview asks. The 500-revision window is unchanged.
- **The canvas pays for what is on screen.** Frames far off screen drop their contents (`display: none` on the frame's children, size kept by `--w`/`--h`), sections are placed with `left`/`top` instead of one transform each, and a pan sets no custom property on `#stage`. Up to 40 components all draw and all follow the files; beyond that, off-screen frames wait until revealed (as before).
- **Typing in a style field previews on the canvas** (the same DOM preview a scrub uses) and the edit is written on commit.

## Consequences
The `render` event fires once per render, and typing in a style field moves the canvas before the file changes, so a test that sees the pixels change must still wait for the revision before it reads the file. A render host that wants the shared runtime needs the same import map. The cost of an old undo step is one parse.
