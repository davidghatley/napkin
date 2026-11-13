# 0020 kinds: how a big folder opens, and kind names for animated pages

Status: accepted (kinds lane, round 2)

## Choices

1. **A folder of more than 150 files opens at 30% on its first files, not fit to the whole canvas.** Fit-all of 1,000 files drew cards 17 px tall, which no one can read and the pixel and text checks cannot judge. The files are packed before the components, grouped by kind, with room for each title at that zoom. Shift+1 (fit everything) is unchanged.
2. **File cards are hidden until they are placed and their picture, poster or type has arrived.** An empty box that fills in a moment later is worse than a card that appears whole.
3. **A frame under 20 screen pixels wide is not loaded live.** It stays the card of its file's first lines. This removed the load and unload churn that made panning 1,000 items take 180 ms a frame.
4. **Kind names.** An html page with `@keyframes` is `css-animation`; one that calls `.animate()` is `waapi`; a `.patch` file is `patch`; run logs are `agent-run`. The old stylesheet kind `css-animation` is now `css-keyframes` and the old JSON `waapi` kind is `waapi-json`. They are still components and still draw through the document engine.
5. **PDF pages are drawn by poppler (`pdftocairo`) on the server into a PNG, shown on a canvas.** Headless and embedded browsers have no PDF plugin. When poppler is missing the viewer falls back to the browser's own frame.
6. **No new dependencies.** Fonts are read with `node:zlib` (Brotli, zlib); poppler and ffmpeg are used only when present.

## Where edits live

Unchanged from 0018: native when the format can hold the value, a recipe beside the file when it cannot.
