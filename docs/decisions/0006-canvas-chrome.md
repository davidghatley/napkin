# 0006: The canvas chrome (round 1 of the full build)

Status: **proposed** · Date: 2026-10-21 · Written by Claude (builder, canvas lane); David has not reviewed it.

## Context
The dream (docs/DREAM.md) asks for an infinite canvas with a variant matrix, a layers tree, quick open and a design panel that reads like a design tool, at 200 components later. The first build was a scrolling page with a form panel.

## Decisions
- **Plain DOM modules, no UI framework.** The chrome is still small (about 2,400 lines in `public/canvas/`). React stays inside the cells only. Revisit if the proposals tray and token panel make the panel code hard to follow.
- **One transform on one layer.** Pan and zoom set `translate3d(x, y, 0) scale(z)` on `#world`; nothing lays out again. Labels are counter-scaled with a quantised `--ls` so headers stay about 12 px on screen at any zoom. Far off-screen frames get `content-visibility: hidden` (only above 30 components); they are not unmounted yet. Overlays live outside the world in screen pixels and refresh in the same call that moves it, so they are never a frame late.
- **Layout is decided once.** Frames with no saved position are packed once, alphabetically; nothing is re-packed. This is what keeps an edit in one frame from moving any other (CLS 0).
- **Position lives in the sidecar only.** `POST /api/components/:id/canvas {x, y}` writes the `canvas` field of `<Name>.napkin.json` and nothing else. It is not a component write, so it does not go through `store.apply`; the `.tsx` is never touched. (If INV-05's spy counts sidecar writes as component writes, this endpoint is the one place to look.)
- **`rename {id, to}` is a model op**, written back by `src/tsx/write.js` as a rename in place (data-n, `s('id', v)`, the base key and the variant keys), so it is one revision and a 2-line diff. The writer decides "rename" by walking both trees together and only when one id disappears and one appears, so a reorder or a delete-and-insert is never mistaken for it.
- **Variants as a matrix.** First axis across, second down, the rest as labelled groups. Per-cell captions stay in the DOM and show from about 90% zoom; at fit the headers carry the same information (a caption per cell cannot be legible at 64 cells).
- **Fonts are vendored**, not fetched: Inter (UI) and JetBrains Mono (values), latin variable woff2 from `@fontsource-variable/*@5.2.8` (published 2025-09-17), both SIL OFL 1.1, licences beside the files in `public/fonts/`. The app has to work offline. They are not npm dependencies.
- **axe-core 4.13.0 (published 2026-08-05)** is a test-only devDependency, pinned exactly, installed with `--ignore-scripts`. It is injected into the page by `test/14-canvas-look.test.js`.
- **The alignment matrix writes two properties** (`justifyContent` and `alignItems`) in one batch: one revision, a 2-line diff. Every other control writes one.

## Consequences
- DOM order of cells is matrix order, not `variantGrid` order. Tests select cells by `data-variant` (test 7 was changed for this).
- `launchChromium` now pins the page to the requested size; earlier tests got a taller page.
- The suite is about 48 s (it was 17 s): five new browser files.

## Round 2 additions
- Sidecar writes use `src/atomic-write.js` (`writeFileAtomic(path, text)`: temp, fsync, rename), the same name and signature as the files lane's module so they converge at merge. `POST /canvas` refuses null, strings and NaN.
- Compound panel controls (stroke, shadow, fill alpha, per-side padding, per-corner radius) are several inputs written as one CSS value, so each stays one line in the file. Fill and stroke alpha live in the hex (#rrggbbaa).
- Layers have no visibility toggle: it would have to write `display:none` over the node's real `display`, which loses information in one line. Row actions are rename, duplicate (one batch of inserts) and delete.
