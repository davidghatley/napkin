# 0008: Layout controls write plain CSS, one line per control

Status: **proposed** · Date: 2026-10-21 · Proposed by: the AI layout lane (Claude); David has not reviewed it.
Extends: [0003](0003-tsx-dialect.md), [0006](0006-canvas-chrome.md). Everything in those still holds.

## Context
The layout criteria (LAY-01..11 in docs/DREAM.md) ask for auto layout, sizing, grid, pins, handles and paste to behave like Figma and Framer, while every control still lands as small, reviewable CSS in a real component file (INV-03).

## Decision
1. **A control is a CSS line, never a hidden model.** Direction, wrap, gap, padding, alignment, space-between, min / max, grid tracks and pins are ordinary style properties in `base` (or in one variant override).
2. **Fill is relative to the parent**: `flex: 1` along a flex parent's main axis, `alignSelf: stretch` across it, `100%` everywhere else. Hug is `auto`, Fixed is px (the border-box size converted to the element's `box-sizing`).
3. **Pins are inset CSS**; centre is `50%` (or `calc(50% - 105px)`) plus a translate. There is no scale constraint: it has no honest one-line CSS. A pin change legitimately writes several inset lines (for example `left`, `width`, `top`, `height`, `transform`) in ONE revision; "one line per control" holds for every other control. (Lead ruling, 2026-10-21.)
4. **A grid placement is one line**, `gridArea: 'row / column'`, so a drop in a cell is one line in the diff. Hand-written `gridColumn` / `gridRow` stay and are edited in place.
5. **Gestures send one batch on release.** While the pointer is down only the DOM and overlays change, which is also why a drag costs about 1 ms of script per frame.
6. **Paste never approximates.** napkin nodes get fresh ids; images become files named by content hash in `assets/` next to the components; HTML converts only when every tag, attribute and style fits the dialect exactly, otherwise the whole paste is refused with the reason. That includes bare numbers where CSS needs a unit (`width:100` is invalid and ignored by browsers, so it is refused, not written as `100px`), character references outside the HTML 4 table (`src/html-entities.js`), `white-space: pre*`, and backticks in text. `&nbsp;` is kept; only ordinary spaces and line breaks collapse.
7. **Preview widths are sidecar data** (`preview` in `<Name>.napkin.json`), like the frame position: the component file never changes when a cell is dragged wider.
8. **The colour picker keeps the file's format**: a value is rewritten in its own space (hex, rgb(), hsl(), oklch()); a colour with no value yet follows the file's most-used space. Alpha has two decimals. Switching the picker's tab is display-only; only a real edit writes, in the tab's format.
9. **The 8 px grid is measured from the parent's inner corner**, so a drag lands on multiples of 8 in the file wherever the view is panned.

## Consequences
- New model ops `duplicate`, `paste`, `wrap`, `unwrap` (all through `store.apply`); the writer needed no new code.
- `POST /api/assets` and `POST /api/components/:c/preview` are new write routes, both behind the session token.
- The assets path shape is shared with AST-01: `assets/<content hash>.<ext>`, relative to the components folder.

## Who did what
David set the criteria and the references. The AI proposed this rule set and built it; nothing here changes `INTENT.md`.
