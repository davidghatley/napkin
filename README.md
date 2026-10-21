# napkin

From napkin sketch to real components: a Paper-like design canvas tuned for components, that agents and people edit together.

Early days. The contract is in [INTENT.md](INTENT.md); how it fits the other projects is in [STACK.md](STACK.md).

## First build (2026-10-20)
A local canvas for **real React components**. Every `*.tsx` in a folder is a component in the napkin dialect ([decision 0003](docs/decisions/0003-tsx-dialect.md)): plain React with typed props, a `base` style per element and `variants` that hold only overrides. Any React app imports these files as they are. You on the canvas and your agents over MCP edit the same files live, and edits from a text editor, `git restore` or a branch switch show up too.

![The proving demo: the agent adds an xl size while David changes the base radius and draws an icon slot](docs/demo/demo-3-after.png)

**The proving demo** (`npm run demo`, [log](docs/demo/demo-log.txt), [diff](docs/demo/demo-diff.txt)): David and an agent edit one Button at once. David changes the base radius in the panel and draws an icon slot with `I`; the agent calls `add_variant` for an `xl` size. Both land in `Button.tsx` (15 lines added, 2 removed), the canvas shows "agent: editing Button / size=xl" while it works, and a separate plain React app ([examples/consumer-app](examples/consumer-app/)) renders all 8 Buttons with both changes.

```console
npm test                              # format, edit path, MCP, live sync, rendering, panel, drawing, the demo, the canvas (nav, frames, quick open, layers, panel, axe)
npm run demo                          # the proving demo in headless Chromium; writes docs/demo/
npm start                             # canvas at http://127.0.0.1:4810/ on a temp copy of fixtures/ (the repo is not edited)
node src/server.js --dir components --port 4810    # your own folder of components, edited in place
NAPKIN_URL=http://127.0.0.1:4810/ npm run mcp      # MCP for an agent: list_components, read_component, apply_edits (dryRun), add_variant, create_component
node examples/consumer-app/build.mjs <components dir> [out]   # a plain React app that imports Button
```
**On the canvas:**
- Pan with the wheel or Space-drag, zoom with Ctrl/⌘-wheel, pinch or `+` `-` (5% to 800%); `⇧1` fits everything, `⇧2` the selection, `⇧0` is 100%. Drag a frame by its title to place it (the position is saved in the `.napkin.json` beside the file).
- `⌘K` jumps to any component, layer or action. `Enter` focuses the selected component, `Esc` comes back; `#Button/label` in the address deep-links.
- The left tree is the JSX: click to select, F2 or double-click to rename, drag to reorder. Shift-click or drag a box to select several; hold Alt to measure to the hovered element.
- Click an element to select it.
- The panel edits styles on the **Base** or on **This variant**. An override shows a dot and a "Reset to base" button.
- The panel also edits text, "Make setting" (text becomes a prop), props and defaults, and variant axes and values.
- Tools: `V` select, `F` frame (drag to size), `T` text, `I` image slot, `N` new component.
- Delete removes the selected element, and Alt+↑/↓ reorders it.

**History and inspection (history lane):** `⌘Z` / `⇧⌘Z` undo and redo your own edits (never an agent's; refused, naming who, if someone changed the same property after you). The drawer under the canvas has **Code** (live TSX, click a line to select its node), **History** (timeline, scrub to preview, Restore), **Inspect** (computed CSS per cell, with where each value comes from, and Copy usage), **Assets** (images in the repo; drop an image on a node) and **Changes** (a dot on components that differ from git HEAD, line diff, before/after pictures). `node src/docs.js --dir components --out catalog` writes a static catalog. napkin never commits. Details: [CONTRACT](test/CONTRACT.md#history-lane-round-2-his-01-03-his-05-ins-01-05-ast-01-04), [decision 0007](docs/decisions/0007-history-undo-restore-git.md).

A file napkin can't read fully opens read-only with a badge, and napkin never rewrites it.

**Not in this build:** a tokens panel, opening other repos' components, Figma/HTML import, hosting. See FEATURES.md.

Contract the tests rely on: [test/CONTRACT.md](test/CONTRACT.md). Decisions: [docs/decisions/](docs/decisions/).
