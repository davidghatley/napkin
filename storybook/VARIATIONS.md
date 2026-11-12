# How to write variation stories

A variation is a proposed alternative for one inventory item in one state, shown next to what napkin looks like today. This document is all a fresh builder needs to add ten variations for one component. Read `INVENTORY.md` for the ids; look at `fixtures/manifest.json` for the captured states.

## The decision (David to confirm)

Variations are **hand-written story files, one per inventory item, in `storybook/stories/variations/<ID>.stories.js`**, using the same story title as the item's Current stories. Storybook merges them into one sidebar entry, so the sidebar reads, for example:

```
3 Components
  C23 Value row
    Current · A length (padding)
    Current · A colour with a variable
    Current · A shorthand with a variable
    Variation 01 · Quiet origin chips
    Variation 02 · Origin chips as a tooltip
```

Reasons: the owner reviews an item with its Current story and all its variations in one place; feedback is keyed by story id, so each variation gets its own keep / change / drop; the generated Current stories (`stories/1-interface`, `2-panels`, `3-components`) are overwritten by `capture.mjs` and must never hold hand-written work, so variations live in their own folder that capture never touches.

## Recipe (copy this)

`storybook/stories/variations/C23.stories.js`:

```js
import { variation } from '../../lib/variation.js';

// Same title as the item's Current stories: "<level> / <ID> <Name>", exactly as in INVENTORY.md.
export default { title: '3 Components/C23 Value row', parameters: { layout: 'fullscreen' } };

export const V01 = {
  name: 'Variation 01 · Quiet origin chips',        // written out: Storybook reads it without running the file
  render: variation({
    item: 'C23', state: 1,                          // which captured state to put it next to (1 = the first Current story)
    css: `
      .pmore .selp { color: var(--nk-text-3); border-color: transparent; }
      .pmore .selp:hover { color: var(--nk-accent-text); background: var(--nk-accent-soft); }
    `,
  }),
};
```

Rules:

1. **File location**: `storybook/stories/variations/<ID>.stories.js`, one file per item. Ten variations of C23 are ten `export const V01 ... V10` in that one file.
2. **Naming**: the export is `V01`, `V02`, ... and the `name` is exactly `Variation 01 · <idea>` (zero padded number, a middle dot, a 2 to 5 word idea that says what is different). Never rename a published variation's number; add the next one.
3. **Mounting**: `variation()` renders two columns, `Current` (the captured fixture of that state) and the variation, in two iframes that load the app's real stylesheets (`public/canvas/*.css`) and use the toolbar's Light / Dark theme. Both are the same size and context, so the difference on screen is only what you changed.
4. **How to change things**, from least to most:
   - `css`: extra CSS appended after the app's stylesheets, inside the variation's iframe only. Use the selectors of the captured DOM (open the fixture `storybook/fixtures/<ID>--NN.html`, or inspect the Current story).
   - `html`: a string, or `(currentHtml) => string`, to change the markup itself (move things, add a label). Keep `data-*` attributes and ids so the app's CSS still matches.
   - both together for a real redesign.
5. **Tokens**: use only napkin's own `var(--nk-*)` tokens (list below) so a variation follows light and dark by itself. Never write a hex colour, a font name or a shadow in a variation unless the idea is a new token: then define it once at the top of `css` under `:root { --nk-new-thing: ... }` and name it in `idea`. Dark values for a new token go in `:root[data-theme="dark"] { ... }`.
6. **Do not** edit `public/`, the generated Current stories, `fixtures/`, or `INVENTORY.md`. A variation is a proposal; changing the product is a separate decision.
7. **Before you finish**: run `node storybook/check.mjs --only <id-prefix>` (no console errors, both themes) and look at one screenshot of each variation in both themes.

## Design tokens the interface actually uses

All of napkin's chrome is styled from its own CSS custom properties, declared in `public/canvas/canvas.css` (`:root`, light; dark under `:root[data-theme="dark"]` and the `prefers-color-scheme` media query). They are prefixed `--nk-`.

| Group | Tokens (use count in `public/canvas/*`) |
|---|---|
| Type | `--nk-sans` (170), `--nk-mono` (147): Inter and JetBrains Mono |
| Surfaces | `--nk-bg` canvas, `--nk-chrome` panels (79), `--nk-chrome-2` wells and fields (83), `--nk-chrome-3` hover (55), `--nk-dot` canvas dots |
| Lines | `--nk-line` (106), `--nk-line-2` (53), `--nk-head-line`, `--nk-cell-line` |
| Text | `--nk-text` (165), `--nk-text-2` (169), `--nk-text-3` (149), `--nk-kbd` |
| Accent | `--nk-accent` (143), `--nk-accent-text` (63), `--nk-accent-soft` (33), `--nk-on-accent` (34), `--nk-select` (23) |
| Status | `--nk-measure` (18, red), `--nk-ok` (13), `--nk-warn` (11) |
| Frames and depth | `--nk-frame`, `--nk-frame-ink`, `--nk-frame-shadow`, `--nk-shadow-pop` (16), `--nk-swatch-line` |

Other `--nk-*` names in the CSS (`--nk-w`, `--nk-h`, `--nk-c`, `--nk-ink`, `--nk-gz`, `--nk-off`, `--nk-slot`, `--nk-cols`, `--nk-split`, ...) are per-element layout or per-agent values set inline by the scripts, not design tokens. There is no spacing, radius or type-size scale: the stylesheets use literal values (radii 6, 4, 5, 8 and 999 px; sizes mostly 10 to 12 px). A variation that proposes a scale should say so in its idea.

**Where they come from**: they are napkin's own. `public/canvas/canvas.css` declares them and nothing in `public/` or `src/` references Secret Sauce (`~/Projects/secret-sauce` names its tokens `--paper`, `--ink`, `--cobalt`, `--vermilion`, `--sun` and so on; no name overlaps). The components shown *inside* the frames are a different matter: they use the opened folder's own tokens (in the captured folder, `ss-ds`, whose `tokens.css` is the Secret Sauce design system). Those frame styles are in `fixtures/frame/`, are David's design system under review and not the interface, and variations should not touch them.

## Adding states or items

Variations attach to captured states. If the state you need is not captured, add it to `storybook/inventory.mjs` (how to reach it in the running app) and run `npm run storybook:capture`; that regenerates fixtures, the Current stories and `INVENTORY.md`, and leaves `stories/variations/` alone.
