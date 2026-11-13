# Dials schema, version 1

A document is JSON. It contains no callbacks, DOM nodes or framework types. This extends the sections → controls document in DREAM 3; its original fields remain valid. Unknown metadata is retained. The browser library reads this document independently of the HTTP route that delivered it.

```json
{
  "revision": "cafe42",
  "sections": [{
    "id": "appearance",
    "label": "Appearance",
    "depth": 2,
    "controls": [{
      "id": "radius",
      "type": "number",
      "label": "Corners",
      "value": 12,
      "default": 0,
      "depth": 1,
      "min": 0,
      "max": 64,
      "step": 1,
      "unit": "px",
      "figure": "radius",
      "description": "Rounds the corners of the selected shape."
    }]
  }]
}
```

## Document and section

| Field | Meaning |
| --- | --- |
| `revision` | Optional opaque string or number supplied by the host. Local edit events keep the revision at which the edit began. |
| `sections` | Required array, in display order. An empty array renders an empty panel. |
| `section.id` | Required nonempty string, unique among sections. |
| `section.label` | Display name. Falls back to ID. |
| `section.controls` | Required array, in display order. Control IDs are unique throughout the document. |
| `section.depth` | Initial depth: 1 dial, 2 bench, 3 studio. Defaults to 2. Dial is exactly 32 CSS px including its bottom rule. |
| `section.studio` | Optional preferred control **type** for the initial studio. Every control remains selectable with the studio's instrument buttons or `panel.open(id)`. |

The first control supplies the section's dial figure, summary and scrub target. Dial collapses the section body and makes it inert. Bench shows rows and a compact domain preview. Studio keeps the same section and row DOM, adds advanced tools and can be resized. A host can use `onDepth` to give its container more space.

## Shared control fields

| Field | Meaning |
| --- | --- |
| `id`, `type`, `value` | Required. ID is a stable, nonempty string; type is open-ended; value is JSON. |
| `label` | Human-readable name. Defaults to ID. Do not put units in the label. |
| `depth` | Minimum detail level, 1–3; defaults to 1. Levels 1 and 2 appear in bench rows; 3 appears only in studio. The first control still drives the collapsed dial. |
| `default` | Value restored by reset. Omitted means the value in the rendered document. External updates do not change this baseline. |
| `description` | Plain-language help used as a row tooltip and label description. |
| `min`, `max`, `step`, `unit` | Numeric range, quantization and display unit. Step defaults to 1 for keyboard adjustments, with no quantization for typed values when omitted. |
| `options` | For select/segmented: primitive strings/numbers or `{ "label": "Normal", "value": "normal" }`. Values must match an option. |
| `figure` | Built-in or registered figure name, or `{ "type": "plugin-name", ...metadata }`. Plugins receive the entire control. Defaults to control type. |
| `scrub` | For object values, the numeric property changed by label scrub. Otherwise the first numeric property is used. |
| `disabled` | Makes the row inert and prevents library mutations for that control. External updates are still accepted. |
| `source` | Real bytes for a control that shows a picture: a URL string or `{ "url", "name", "type" }`. On `asset` and `file` the bytes belong to the named file and stop applying when the value names another. The host's `source(control, value)` option is asked first; without either, the control says it has no pixels. |
| `property` | On a number, range or angle in a motion section: the CSS property the control drives once keyed on the timeline (`"scale"`, `"opacity"`, …). An angle drives `rotate` when this is absent; other numbers are written as `--<id>` and bound to nothing. |

Numeric entry accepts parentheses, unary signs, `+ - * /`, decimal and scientific notation. Compatible units convert (`s↔ms`, `turn/rad↔deg`). `12px*1.5` produces 18 px. `50%` stays 50 for a `%` control; on a control with a range it means that share of the range (`50%` on 0 to 200 px is 100 px), and on a control without one it means that share of the current value. Arbitrary CSS lengths such as `em` can be used when the control declares that exact unit; conversion to pixels requires host layout context and is not guessed. Expressions quantize to step and then clamp to range. No code is evaluated. Input length is bounded to 200 characters.

Shift adjusts at 0.1×; Alt at 10×. Pointer movement uses one declared step per two CSS px. Label keys accept counts: `12` then `l` adds twelve steps; `h/j` subtract and `k/l` add. Arrays scrub their first component. Colors scrub perceptual lightness. Booleans toggle; enums move through their declared options. Text and file paths use entry instead of numeric scrubbing.

## Built-in value shapes

Objects below show the recommended complete shape. Unused object properties are preserved in events. Provide a complete object for predictable fields; the motion studio supplies missing response defaults. The row accepts JSON for compound values, while studio fields provide individual entry and keyboard paths.

| Type | Value and metadata | Figure and studio |
| --- | --- | --- |
| `number`, `range` | Finite number; optional range and unit. | Discrete magnitude scale; use `figure: "radius"` or `"opacity"` to show those effects. Studio has a larger readout and range. |
| `angle` | Number, normally `unit: "deg"`. | Direction spoke and rotatable large arrow. |
| `vector` | `[x,y]`, range applies to both components. | Coordinate diagram and pointer/keyboard 2D pad; exact X/Y fields. |
| `boolean` | `true` or `false`. | Enabled/flat signal; named switch. |
| `select`, `segmented` | One declared option's value. | Drawn option glyphs (`figure: "align"`, `"mark"`, or blocks) with the chosen word beside them; drawn listbox for select. Segmented is a named radio group with arrow-key selection. |
| `text` | String. | A specimen of the actual text; studio multiline entry. |
| `color` | CSS color string accepted by the browser, including `var(--token)`. | Actual swatch; perceptual studio below. |
| `gradient` | CSS gradient string. | Actual gradient miniature and full preview. Studio's two-color composer emits `linear-gradient`; arbitrary stop lists remain editable as CSS in the row. |
| `shadow` | `{ "x":0,"y":8,"blur":24,"spread":0,"color":"#0004" }` | Offset shape and live CSS shadow. |
| `spacing` | `[top,right,bottom,left]`, numbers in CSS px. | Inset rectangle and box model with four fields. Large diagram caps displayed padding at 80 px to retain the content; stored values do not change. |
| `typography` | `{ "text":"Ag", "family":"system-ui", "size":32, "weight":500, "tracking":0, "lineHeight":1.2, "axes":{"wght":500} }` | Baseline specimen, editable text and type lab. `axes` metadata declares actual font axes as `{tag,label,min,max,default,step?}`. Weight and `wght` stay synchronized in the lab. Font discovery/loading belongs to the host. |
| `motion`, `spring`, `bezier` | `{ "mode":"spring", "bezier":[0.22,0.8,0.22,1], "duration":1200, "delay":0, "stiffness":170, "damping":14, "mass":1, "velocity":0, "loopRange":[0.2,0.6] }` | Response curve with handles, measured settle and overshoot, a loop range (`loopRange`, optional: two fractions of one iteration, the first smaller; the motion plays once, then that part repeats, in the preview and in the written CSS and WAAPI alike), the keyframe track with a lane per animated value, and CSS and Web Animations output that reads back tolerantly. Times are normalized 0–1; duration/delay are ms. Stiffness, damping, mass and duration must be positive. Handle X coordinates are 0–1; Y may overshoot. |
| `keyframes` | Array of at least two frame records `{ "offset":0.55, "transform":"translateX(132px)", "opacity":1 }`, offsets 0–1. Metadata `min`/`max` bound translateX in px. | Diamonds on a path; in the motion studio a timed track you drag. Arrows on the row move the frame with the largest travel. Written as live CSS `@keyframes` and WAAPI frames. |
| `image` | `{ "black":0,"white":1,"gamma":1,"exposure":0,"saturation":1,"curve":[0,0.25,0.5,0.75,1],"cropLeft":0,"cropTop":0,"cropRight":0,"cropBottom":0,"mask":0 }` | Histogram with tone curve; studio has the picture with crop handles, mask ring and before/after split, and the curve over the histogram with level triangles. Exposure is in stops. Curve is five evenly spaced output levels, interpolated linearly. Mask 0 is off; otherwise it is the radius in normalized image coordinates. |
| `encoding` | `{ "x":"distance","y":"energy","color":"group","size":"mass","mark":"point" }` | Shelf occupancy, four field selectors and a plot. `fields` metadata lists names or `{name,type}`; `data` contains preview rows. Mark is `point`, `bar` or `line`. Empty channel means unbound. |
| `sampler` | `{ "steps":28,"cfg":7,"scheduler":"karras","shift":1,"seed":42,"locked":true,"denoise":1 }` | Sigma schedule, discrete evaluation cells, full parameter fields, seed lock/randomize. Schedulers are linear, cosine and a cubic Karras-style study. This is a visualization, not a model-specific Comfy scheduler implementation. |
| `seed` | Unsigned 32-bit integer, declare min 0/max 4294967295/step 1. | The seed's own 32 bits drawn as a grid (no picture is invented from it). Lock/randomize lives in the sampler studio; seed tiles show the section's real images when the host supplies them. |
| `asset`, `file` | String path or name. | File outline; studio file picker emits value (name) and an `asset` event with the browser File. A preview shows real bytes (a chosen file, the host's `source`, or the schema `source`) or says none were supplied. No disk write or upload is implicit. |

Unknown types keep a text entry in the row (JSON for objects, wrapped in full) and get a full studio instrument chosen from the shape of the value: options become cards, a number a ruler, a pair of numbers a pad, a number list bars, an object one lane per key plus a tolerant source box. `registerInstrument(type, make)` replaces that stage for a type. This does not turn unknown types into valid file operations; the host still validates every write.

Optional keys any control may carry that the instrument frame reads: `unit` (picks the number subject: px, ms, s, %, K), `figure` (opacity, radius, count, align, mark), `description` (shown in palette previews), and for text, an id or label that says prompt to get weighted word tokens. Compound values typed into a row or an instrument source box are read with `looseJson` (exported from `dials.js`): JSON or a JS literal with single quotes, bare keys, trailing commas, comments, `Infinity` and `undefined`; errors give a line and column.

## Color studio

OKLCH plane axes are C 0–0.4 and L 0–1 at the chosen hue. OKLab plane axes are a and b −0.4–0.4 at the chosen lightness. Keyboard arrows or four exact fields provide the same edits. Solid white and dashed dark curves mark calculated sRGB and Display P3 boundaries. Gamut is tested in linear RGB; the plane raster itself uses the browser's sRGB canvas. Out-of-gamut regions are hatched, not silently clamped in the stored value.

Choose a background and a WCAG AA/AAA or experimental APCA map. Failed positions are dimmed. WCAG ratio and signed APCA Lc are always shown for the selected color. Alpha composites over the chosen background, which composites over white if translucent. WCAG figures use the sRGB display fallback for wide-gamut colors. APCA is the 0.0.98G equation and is not a WCAG 2 compliance claim.

Harmony offers complement, analogous, triad and split relationships. Nine-stop ramps fit chroma to sRGB at each lightness. Swatches are keyboard buttons. Image palettes bucket a downsampled local image in RGB and choose the most frequent opaque buckets; this is not semantic image understanding. History keeps twelve local colors per control and survives switching studio tabs. A token binding writes `var(--name)` as the color value and resolves the inherited variable; while the value is bound, studio edits set the custom property on the document element (emitting `token` `{control, name, value, phase}`) instead of replacing the value, and Unbind writes the literal back. It does not edit a stylesheet declaration: persisting the token is host work. The palette (emitting `palette` `{control, palette}`) and the ramp settings (steps 5–11, anchored or free) are kept per control for the life of the panel. Output choices are OKLCH, OKLab, hex and RGB; original CSS input strings round-trip through value events until explicitly changed.

## Extension contract

`registerControl(name, { mount(context), studio?(context,host) })` and `registerFigure(name, draw)` register trusted application code. `mount` returns `{element,update?,destroy?}`. `studio` returns `{update?,depth?,destroy?}` and appends its own DOM to the supplied host. `draw(host,control,value)` updates the existing figure host; preserve focus if adding interactive DOM. Registration returns an unregister function. Re-render after changing a registration to replace already-mounted views.

The context contains `control`, `host`, `get`, `begin`, `change`, `commit`, `cancel`, `set`, `isEditing`, and `subscribe`. `set` makes one atomic edit. `subscribe` returns an unsubscribe function. Use the lifecycle for gestures and release subscriptions in `destroy`. The custom studio context also has `panel`. All labels must have accessible names, all gestures need keys or equivalent fields, and plugin animation must honor reduced motion. Plugin code is trusted, schema text is not executed.

## Validation and revisions

`render(schema)` repairs instead of refusing. A null or wrong-typed value, a value out of range, an unknown option, a colour the browser cannot read, a bad `min`/`max`/`step`, a missing type, a duplicate id (suffixed `-2`) or a record field of the wrong type is replaced with the nearest value that fits; the row gets a wavy underline and its description says what was repaired, and `panel.problems` lists `{control, problem}` for each. Partial motion values (`{ duration: 300 }`, a bare bezier array, a CSS keyword) are completed silently. Only a schema without a `sections` array is refused. `repairSchema(schema)` in `values.js` returns `{ schema, problems }` without rendering.

Large numbers read as people write them: `1.5T`, `51,654`, `$2.4B` (a currency unit is a prefix). Typed input accepts `1.5k`, `2,400` and `$12`. Seeds and controls with `plain: true` keep every digit.

External updates are stricter: malformed IDs, duplicate IDs, invalid option values, non-finite numeric values, numeric range violations and malformed core array shapes are rejected before an external update. Color parsing is checked before either operation. Compound domain objects are not a replacement for adapter-side validation: hosts must validate complete shapes and supported operations before writing files. JSON values are cloned at boundaries.

`update({id:value}, {revision})` validates the entire patch before applying it. Unedited controls update immediately. Locally active controls queue only the latest external value. Local `commit`/`cancel` emits with the edit's starting revision, then a `conflict` event reports differing local/remote values, then the remote value is applied. Local undo entries for that control are cleared so undo cannot overwrite a newer writer. Durable conflict resolution belongs to the host's `baseRevision` check.

## Hooks for hosts and test harnesses

- Every row has `data-control-id` (and `data-control`, `data-type`); a changed row has `data-modified`.
- An open studio's section has `data-studio-for="<control id>"` and covers at least 30% of the window in viewport mode.
- Double-click a row (or Enter on its label with `S`) to open its studio; double-click the label to reset.
- `Ctrl K` opens a `role=dialog` palette whose `role=option` items read `Control <label>`, `Dial|Bench|Studio <section>` and `Reset <label>`; exact and prefix matches rank above fuzzy ones.
- Motion: `detail.code` on commit events, `motionCode()`, `applyMotionCode()`, `motionModel()` and `motionAt(section, ms)` (the pose the code produces at that time; see docs/dials.md).
- Pictures: the `source(control, value)` option and the schema `source` field supply bytes; nothing is drawn in their place.
