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

Numeric entry accepts parentheses, unary signs, `+ - * /`, decimal and scientific notation. Compatible units convert (`s↔ms`, `turn/rad↔deg`). `12px*1.5` produces 18 px. `50%` stays 50 for a `%` control; on a bounded unitless range it means its midpoint. Arbitrary CSS lengths such as `em` can be used when the control declares that exact unit; conversion to pixels requires host layout context and is not guessed. Expressions quantize to step and then clamp to range. No code is evaluated. Input length is bounded to 200 characters.

Shift adjusts at 0.1×; Alt at 10×. Pointer movement uses one declared step per two CSS px. Label keys accept counts: `12` then `l` adds twelve steps; `h/j` subtract and `k/l` add. Arrays scrub their first component. Colors scrub perceptual lightness. Booleans toggle; enums move through their declared options. Text and file paths use entry instead of numeric scrubbing.

## Built-in value shapes

Objects below show the recommended complete shape. Unused object properties are preserved in events. Provide a complete object for predictable fields; the motion studio supplies missing response defaults. The row accepts JSON for compound values, while studio fields provide individual entry and keyboard paths.

| Type | Value and metadata | Figure and studio |
| --- | --- | --- |
| `number`, `range` | Finite number; optional range and unit. | Discrete magnitude scale; use `figure: "radius"` or `"opacity"` to show those effects. Studio has a larger readout and range. |
| `angle` | Number, normally `unit: "deg"`. | Direction spoke and rotatable large arrow. |
| `vector` | `[x,y]`, range applies to both components. | Coordinate diagram and pointer/keyboard 2D pad; exact X/Y fields. |
| `boolean` | `true` or `false`. | Enabled/flat signal; named switch. |
| `select`, `segmented` | One declared option's value. | Selected position among option cells; native select and larger choices in studio. Segmented uses a named radio group with arrow-key selection. |
| `text` | String. | A specimen of the actual text; studio multiline entry. |
| `color` | CSS color string accepted by the browser, including `var(--token)`. | Actual swatch; perceptual studio below. |
| `gradient` | CSS gradient string. | Actual gradient miniature and full preview. Studio's two-color composer emits `linear-gradient`; arbitrary stop lists remain editable as CSS in the row. |
| `shadow` | `{ "x":0,"y":8,"blur":24,"spread":0,"color":"#0004" }` | Offset shape and live CSS shadow. |
| `spacing` | `[top,right,bottom,left]`, numbers in CSS px. | Inset rectangle and box model with four fields. Large diagram caps displayed padding at 80 px to retain the content; stored values do not change. |
| `typography` | `{ "text":"Ag", "family":"system-ui", "size":32, "weight":500, "tracking":0, "lineHeight":1.2, "axes":{"wght":500} }` | Baseline specimen, editable text and type lab. `axes` metadata declares actual font axes as `{tag,label,min,max,default,step?}`. Weight and `wght` stay synchronized in the lab. Font discovery/loading belongs to the host. |
| `motion`, `spring`, `bezier` | `{ "mode":"spring", "bezier":[0.22,0.8,0.22,1], "duration":1200, "delay":0, "stiffness":170, "damping":14, "mass":1, "velocity":0, "keyframes":[{"time":0,"value":0},{"time":1,"value":1}], "range":[0,1], "tracks":{"rotation":[{"time":0,"value":0},{"time":1,"value":30}]} }` | Response curve with a pinned earlier response, measured settle and overshoot, ghost trail, timeline with loop `range` and lanes (`tracks` holds keys for other number or angle controls in the section), playhead, editable keyframes, and CSS and Web Animations output. Times are normalized 0–1; duration/delay are ms. Stiffness, damping, mass and duration must be positive. Handle X coordinates are 0–1; Y may overshoot. |
| `image` | `{ "black":0,"white":1,"gamma":1,"exposure":0,"saturation":1,"curve":[0,0.25,0.5,0.75,1],"cropLeft":0,"cropTop":0,"cropRight":0,"cropBottom":0,"mask":0 }` | Tone transfer miniature; real image pixels, luminance histogram, draggable curve knots, normalized crop and circular mask. Exposure is in stops. Curve is five evenly spaced output levels, interpolated linearly. Mask 0 is off; otherwise it is the radius in normalized image coordinates. |
| `encoding` | `{ "x":"distance","y":"energy","color":"group","size":"mass","mark":"point" }` | Shelf occupancy, four field selectors and a plot. `fields` metadata lists names or `{name,type}`; `data` contains preview rows. Mark is `point`, `bar` or `line`. Empty channel means unbound. |
| `sampler` | `{ "steps":28,"cfg":7,"scheduler":"karras","shift":1,"seed":42,"locked":true,"denoise":1 }` | Sigma schedule, discrete evaluation cells, full parameter fields, seed lock/randomize. Schedulers are linear, cosine and a cubic Karras-style study. This is a visualization, not a model-specific Comfy scheduler implementation. |
| `seed` | Unsigned 32-bit integer, declare min 0/max 4294967295/step 1. | Deterministic bit pattern. Lock/randomize lives in the sampler studio. |
| `asset`, `file` | String path or name. | File outline; studio file picker emits value (name) and an `asset` event with the browser File. Image selection can be previewed locally. No disk write or upload is implicit. |

Unknown types retain a JSON entry and figure fallback until a plugin registers their UI. This does not turn unknown types into valid file operations; the host still validates every write.

## Color studio

OKLCH plane axes are C 0–0.4 and L 0–1 at the chosen hue. OKLab plane axes are a and b −0.4–0.4 at the chosen lightness. Keyboard arrows or four exact fields provide the same edits. Solid white and dashed dark curves mark calculated sRGB and Display P3 boundaries. Gamut is tested in linear RGB; the plane raster itself uses the browser's sRGB canvas. Out-of-gamut regions are hatched, not silently clamped in the stored value.

Choose a background and a WCAG AA/AAA or experimental APCA map. Failed positions are dimmed. WCAG ratio and signed APCA Lc are always shown for the selected color. Alpha composites over the chosen background, which composites over white if translucent. WCAG figures use the sRGB display fallback for wide-gamut colors. APCA is the 0.0.98G equation and is not a WCAG 2 compliance claim.

Harmony offers complement, analogous, triad and split relationships. Nine-stop ramps fit chroma to sRGB at each lightness. Swatches are keyboard buttons. Image palettes bucket a downsampled local image in RGB and choose the most frequent opaque buckets; this is not semantic image understanding. History keeps twelve local colors. A token binding writes `var(--name)` as the color value and resolves the inherited variable. It does not edit a stylesheet declaration. Output choices are OKLCH, OKLab, hex and RGB; original CSS input strings round-trip through value events until explicitly changed.

## Extension contract

`registerControl(name, { mount(context), studio?(context,host) })` and `registerFigure(name, draw)` register trusted application code. `mount` returns `{element,update?,destroy?}`. `studio` returns `{update?,depth?,destroy?}` and appends its own DOM to the supplied host. `draw(host,control,value)` updates the existing figure host; preserve focus if adding interactive DOM. Registration returns an unregister function. Re-render after changing a registration to replace already-mounted views.

The context contains `control`, `host`, `get`, `begin`, `change`, `commit`, `cancel`, `set`, `isEditing`, and `subscribe`. `set` makes one atomic edit. `subscribe` returns an unsubscribe function. Use the lifecycle for gestures and release subscriptions in `destroy`. The custom studio context also has `panel`. All labels must have accessible names, all gestures need keys or equivalent fields, and plugin animation must honor reduced motion. Plugin code is trusted, schema text is not executed.

## Validation and revisions

Malformed IDs, duplicate IDs, invalid option values, non-finite numeric values, numeric range violations and malformed core array shapes are rejected before a panel replacement or external update. Color parsing is checked before either operation. Compound domain objects are not a replacement for adapter-side validation: hosts must validate complete shapes and supported operations before writing files. JSON values are cloned at boundaries.

`update({id:value}, {revision})` validates the entire patch before applying it. Unedited controls update immediately. Locally active controls queue only the latest external value. Local `commit`/`cancel` emits with the edit's starting revision, then a `conflict` event reports differing local/remote values, then the remote value is applied. Local undo entries for that control are cleared so undo cannot overwrite a newer writer. Durable conflict resolution belongs to the host's `baseRevision` check.
