# 0018 · Dials: standalone instruments and edit ownership

Status: accepted · 2026-11-12 · DIALS lane

Build `public/dials/` as browser ES modules and scoped CSS with no runtime dependencies. A serializable document declares sections, controls and figures. The library owns presentation and edit transactions; the host owns files, revisions, undo persistence and HTTP.

A section remains the same DOM element at dial, bench and studio depths. Height and width animate for 160 ms, interruption begins from the current bounds, and reduced motion removes transitions. Studio panes resize in place. Keep an open section's controls mounted, so changing depth does not replace the focused input.

An external update during a local gesture is queued for that control. The local gesture commits its visible value with its starting revision; the library then emits a conflict containing both values, and applies the latest external value. The host can reject or rebase the local commit through the locked HTTP protocol. Other controls update immediately. This avoids moving a drag target or silently discarding a concurrent writer.

Typed arithmetic uses a small parser, never eval. CSS colors use the browser parser followed by conversion to OKLab; the original CSS string remains a valid value until explicitly edited. Rendering a schema is atomic: validate all IDs and values before replacing the current panel. Plugins receive the same lifecycle methods as built-ins.

No new dependencies. APCA is an experimental readout beside WCAG, not a compliance claim. Browser-supported CSS color syntax is the input boundary. File adapters and canvas integration belong to other lanes.

## Round 2 amendments (2026-11-12)
- Visual direction: the workshop (ruled headers, square fields, plated figures) was chosen from three round-one directions by a fresh critic. The other two were deleted; the `direction` option is gone.
- Studios: with `studio: "viewport"` a studio is a fixed pane over the window with columns, never a nested scroll. The inline mode remains for hosts that want a pane in their own layout.
- Plots keep a fixed logical size for drawing code, while the backing store follows the device pixel ratio and the displayed size and redraws on resize.
- Rows outside the visible area use `content-visibility: auto`, so a large panel does not style or paint rows nobody can see.
- `remote.js` is the only code that knows the HTTP contract. Everything else stays host-agnostic.
