# 0012: Cells are isolated from the editor's CSS with a reset, not a shadow root

Status: **proposed** · Date: 2026-10-22 · Written by the AI builder (Claude, Sonnet) for the fidelity lane; the choice between a reset and a shadow root was the AI's. David has not decided on this yet.

## Context
Whole-product walk 1 (scene S3) found that a component on the canvas does not look like the same component in a plain React app. "Fixed width 280" with padding 16 drew 280 px wide on the canvas and 312 px in an app, because the editor's `* { box-sizing: border-box }` reached every node in a cell. The text colour was the editor's ink (28, 31, 39) instead of black, and Inspect called that "browser default". WPC-01 and WPC-02 are the same problem: editor CSS leaks into the component. The product promise is that what you draw is what ships, so the cell has to render the component as it renders in a page with no app CSS. The renderer behind `render_component` and the visual diff had the same two rules baked into its blank host page, so the PNGs agreed with the canvas and with each other and were both wrong.

## Decision
Keep the cell in the page's light DOM and isolate it with CSS:

- `.mount` (the element React renders into) and `.preview-inner` (the same thing inside a ghost or history preview) get `all: initial` plus `color-scheme: light`, and keep `pointer-events` and `visibility` inherited so focus dimming, play mode and hidden ghosts still work. `all: initial` stops every inherited property (colour, font, line-height, cursor, letter-spacing) at the cell's edge. Custom properties are not affected by `all`, so token variables still reach components, as a plain app that loads the tokens CSS would see them.
- Every editor element rule (`* { box-sizing }`, scrollbar rules, `button/input/select` font inherit, `:focus-visible`, `kbd`, `code`) is written as `selector:where(:not(:is(.mount, .preview-inner) *))`, so it never matches inside a cell and adds no specificity.
- `.mount` is a block, not a grid, so the component's root is a block child as in `<body>` and not a grid item (grid items compute `min-width: auto`).
- The standalone renderer's host page loses its `box-sizing` and colour rules: it is a blank page, as in an app.
- Inspect no longer says "inherited from the page" for a value nothing in the file declares. Cells inherit nothing from the page, so the label is the true "browser default".

Why not a shadow root per cell: it isolates both ways with no selector discipline, but every part of the editor that reaches into cells would have to cross the boundary (hit-testing and selection by `[data-n]`, handles measuring rects, Inspect reading computed style, html-paste cloning the target context, slots and drop targets, `document.querySelector` in about 40 tests and the agents' own scripts), and React's event delegation and portals behave differently inside one. The reset keeps one DOM and one set of selectors. Its weakness is that a new global rule in editor CSS can leak again, so a test now guards it.

## Consequences
- `test/fidelity/cell-isolation.test.js` draws a probe component (about 20 element kinds, fixed width plus padding plus border, a scroller) in a cell and in a blank page, and requires zero differing computed properties (custom properties, `cursor`, `color-scheme` aside) and zero pixels differing by more than 2/255 at 100%, also under dark chrome, play mode and inside a ghost layer. `test/fidelity/s3-end-to-end.test.js` does scene S3 end to end. Adding an editor CSS rule that matches inside a cell fails them.
- Authoring chrome that is deliberately drawn on the cell stays: slot outlines and empty-slot labels, the drop-target outline, the dashed cell border, and the focus-dimming `pointer-events: none`. These are part of editing, not of the component, and a pixel comparison of a component with slots will show the slot outlines.
- A component that relied on the editor's border-box reset now draws bigger, exactly as it does in its app. That is the intended correction.
- Pixel equality holds to 2/255 per channel, not bit for bit: antialiasing on a rounded corner can land one level apart between the composited canvas layer and a plain page.
- Screenshots in the canvas must be taken with the selection cleared; the selection handles are editor chrome drawn over the cell.
