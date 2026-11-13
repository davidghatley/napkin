# Dials

A standalone instrument panel. Declare values in JSON; each section opens in place, up to its full editor, inside the host (never a full-window overlay). Browser ES modules, scoped CSS, no runtime dependencies. MIT licensed. Nothing has been published.

```html
<link rel="stylesheet" href="./dials/dials.css">
<div id="instruments"></div>
<script type="module">
  import { render } from './dials/dials.js';
  const panel = render({ revision: '1', sections: [{
    id: 'shape', label: 'Shape', controls: [{
      id: 'radius', label: 'Corners', type: 'number', depth: 1,
      value: 12, default: 0, min: 0, max: 64, step: 1, unit: 'px', figure: 'radius'
    }]
  }] }, document.querySelector('#instruments'));
  panel.addEventListener('value', ({ detail }) => {
    if (detail.phase === 'change') document.body.style.borderRadius = detail.value + 'px';
    if (detail.phase === 'commit') console.log('Persist one undo group', detail);
  });
  panel.update({ radius: 24 }, { revision: '2' });
</script>
```

Copy this folder and serve it with any static HTTP server. The demo's font is optional; it falls back to system fonts. See [the integration guide](../../docs/dials.md), [schema](../../docs/dials-schema.md), and [demo](./demo.html).

- Drag labels; Shift is fine and Alt is coarse. Type `12px*1.5`, `1.2s`, or `50%`.
- Focus a label and use arrows or `3` then `l`. `R` resets; `S` opens that control's full editor in place.
- Enter on a figure opens its full editor. All editable plots have fields or keys as alternatives.
- `Ctrl K` finds any control or command. `?` opens the keyboard map, where keys can be rebound. `Ctrl Z` / `Ctrl Shift Z` undo and redo local edits.
- Custom controls and figures register through `registerControl` and `registerFigure`.

Color accepts CSS syntax supported by the browser, including variables inherited by the panel. Wide-gamut boundaries are calculated; the plane raster is displayed in sRGB. APCA is experimental. File writes, network persistence, file-format adapters and durable undo belong to the host.
