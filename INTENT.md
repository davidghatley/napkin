# INTENT: napkin

> From napkin sketch to real components: a Paper-like design canvas tuned for components, that agents and people edit together.

Status: placeholder name · written 2026-10-17 from David's direction; Phase 4 started 2026-10-20 (David) · **this file changes only when David agrees.**

## What it is
- A canvas in the spirit of Paper (paper.design), but optimized for **components** (variants, props, tokens) where Paper is weak.
- **Components are the files you already have: plain HTML/CSS first, React (TSX/JSX) also supported** (decision 0013). napkin renders what it loads as it is and edits it in place. There is no export step, and napkin imposes no format, sidecar, config or token system.
- First build (2026-10-20): live co-editing, props, a variants grid (base + per-variant overrides) and basic drawing (frame, text, image slot, new component).
- Full build (from 2026-10-21): the dream in [docs/DREAM.md](docs/DREAM.md), including tokens and themes, and opening existing components from other repos (read-only unless they fit the dialect).
- **Agent-editable**: agents read and write the same documents David edits, live.
- Files on disk are the source of truth (diffable, versionable).

- **Since 2026-11-12 (decision 0017): the shared surface for all agentic work.** Any media or data an agent produces (UI, images, video, audio, animation, datasets, charts, documents) is an item on the canvas with its own viewer and instrument panel; items group and arrange any way; everything is keyboard-drivable; any agent harness connects; ComfyUI is the generative backend. The dream is [docs/DREAM3.md](docs/DREAM3.md).
- **Working scope since 2026-11-13 (decision 0023):** HTML, components, CSS, SVG, images and text on the canvas, with the base interface (top bar, layers, one tool panel, right-click menus, palette) made excellent first. The wider surface above is on hold, not dropped.

## What it is not
- Not a Figma clone with every feature.
- Not a freehand whiteboard (free arrangement and grouping of real files is in scope since decision 0017).
- Not hosted (for now): one person and their agents on localhost.
- Not the old precision-canvas 'conformance harness' scope.

## The proving demo
**An agent and David edit the same component live** on the canvas, and the result is a real, reusable component file.

## Interface to the stack
Reads/writes component files (HTML/CSS, TSX) and the CSS variables those files define themselves. secret-sauce is opened like any other folder. Exposes an API/MCP surface for agents.

## Decided
- 2026-10-20: Phase 4 starts with a first build (David).
- 2026-10-20: components are React TSX files plus a sidecar (G1); variants are a base plus per-variant overrides (G3); the build grows the 18 Oct spike; local only.
- 2026-10-21: David approved the dream (all 104 criteria and Needs David items N1-N7) in the review page: a token panel and opening other repos' components are now in scope; the dialect widens (decision 0004); G2, G5 and G6 are answered in decision 0005. Hosting stays out until David says otherwise.

- 2026-10-30: napkin is re-dreamed (David): HTML/CSS first, React also supported, render files as they are, nothing imposed (no required sidecar, config or token source); the TSX-only rule of decision 0003 is retired (decision 0013). The bar: a designer would choose napkin over Figma.

- 2026-11-12: napkin widens to any media and data, instrument panels with depth, any agent harness and a ComfyUI backend (David; decision 0017, DREAM 3).
- 2026-11-13: back to basics (David; decision 0023). The wide build is on hold; only the design-core kinds are switched on while the base components are perfected. More returns one piece at a time.

## Starting point
The 18 Oct co-editing spike (decisions 0001, 0002). The precision-canvas spec and capability catalog are reference only (see docs/salvage.md).

## Open decisions
- Which Paper weaknesses matter most (write them down from real use first).
- Name: placeholder.
