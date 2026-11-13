# Control surfaces: patterns for dials

Studied 2026-11-12. These are design observations, not feature inventories or claims about every extension. All linked sources are upstream. No reference implementation is copied into dials.

| Reference | Strongest pattern | Gap relative to this brief | Pattern to carry forward |
| --- | --- | --- | --- |
| [DialKit](https://github.com/joshpuckett/dialkit), [reference](https://github.com/joshpuckett/dialkit/blob/main/docs/reference.md) | Interface tuning, version comparison and animation timing share a compact surface; a vanilla adapter works without a framework. | The documented panel does not make every setting a small explanatory drawing that expands into a domain studio. | Keep tuning close to the result, preserve values across panel changes, put timing next to its preview. |
| [Leva](https://github.com/pmndrs/leva), [plugins](https://github.com/pmndrs/leva/blob/main/docs/advanced/creating-plugins.md) | A store separates values from React rendering. Input plugins and inferred types make small declarations useful. | React-first declarations alone are not a transport document for unrelated agents and file adapters. | Separate model, gesture and view. Give plugins the same edit lifecycle as built-ins. |
| [Tweakpane](https://github.com/cocopon/tweakpane) | Compact bindings, monitoring, folders, tabs and plugin blades make it useful beyond a slider tray. | Folders and tabs organize widgets but do not establish a continuous dial → bench → studio space. | Dense rows, restrained chrome, typed bindings, extensible figures. |
| [lil-gui](https://lil-gui.georgealways.com/) | Very small object-binding API, reset/save/load, onChange and onFinishChange. | A floating debug controller does not give a designer a perceptual color or motion workbench. | Keep the entry point small; make reset and finish-change first-class. |
| [dat.gui](https://github.com/dataarts/dat.gui), [API](https://github.com/dataarts/dat.gui/blob/master/API.md) | Direct manipulation of ordinary JavaScript properties established a durable, understandable model. | Implicit object mutation leaves undo grouping and external writers to the host. | Preserve the immediacy; make edit boundaries explicit instead of observing mutations. |
| [Theatre.js](https://www.theatrejs.com/docs/latest/manual), [repository](https://github.com/theatre-js/theatre) | A sheet, object properties and a sequence turn motion into something inspectable and authored. | A complete animation editor is heavier than the first interaction with one setting should be. | Put a small track in the motion studio; keep curve, ghost and playhead tied to one clock. |
| [Motion](https://motion.dev/docs/animate), [repository](https://github.com/motiondivision/motion) | Springs, easing, keyframe times and playback controls have clear runtime meanings. | A runtime cannot explain a spring visually without an authoring surface. | Preview the actual differential equation, distinguish time from progress, show overshoot. |
| [Storybook Controls](https://storybook.js.org/docs/essentials/controls), [repository](https://github.com/storybookjs/storybook) | Arg types describe controls; args and stories make reproducible states inspectable. | The args table is oriented toward component review, rather than fast spatial instruments for every media kind. | One serializable schema; reproducible examples; descriptions and enum labels belong in the schema. |

## Local references (read only)

`tasty_tunez/app/css/inspector.css`, `app/js/inspector.js` and `app/js/figures.js`: 32 px rows, narrow labels that scrub, a modified dot, reset, and semantic miniatures. Its sampler figure draws the schedule; it is not a generic progress bar. Carry that rule into every type: geometry for spacing, a baseline specimen for type, a response curve for motion, a field arrangement for encoding.

`secret-sauce/README.md`, `tokens.css` and `projects/napkin.json`: structured density, ruled plates, numbered annotations, two inks with color reserved for meaning, visible focus and complete still frames. Use those for direction B. The integration default A follows napkin's current `public/canvas/canvas.css`: cool neutral chrome, cobalt focus, sans labels and mono values, in light and dark. Direction C explores a broad specimen-led layout with larger figures and a horizontal rhythm. Different hierarchy and geometry must distinguish the directions, not a color switch.

## Decisions this study leads to

- Keep the section header and miniature as the spatial anchor at every depth. Grow the same DOM section; do not teleport it into a disconnected modal.
- A figure is a readout. An unlabeled decorative waveform is a failure; use the real value and domain math.
- Treat begin/change/commit/cancel as the shared language of pointer, keys and typed entry. External updates reconcile at the end of a local edit and emit a conflict event when necessary.
- Keep the browser library independent of file writes and HTTP. Hosts wire commit events to the locked protocol and supply revisions.
- Draw gamut boundaries from linear RGB tests, not a CSS gradient pretending to describe a gamut. Label experimental contrast separately from WCAG.

Color mathematics: [CSS Color 4](https://www.w3.org/TR/css-color-4/#color-conversion-code), [OKLab](https://bottosson.github.io/posts/oklab/). Contrast: [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [APCA reference](https://github.com/Myndex/apca-w3). APCA is experimental and is not a WCAG 2 compliance test.
