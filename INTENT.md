# INTENT: napkin

> From napkin sketch to real components: a Paper-like design canvas tuned for components, that agents and people edit together.

Status: placeholder name · written 2026-10-17 from David's direction; Phase 4 started 2026-10-20 (David) · **this file changes only when David agrees.**

## What it is
- A canvas in the spirit of Paper (paper.design), but optimized for **components** (variants, props, tokens) where Paper is weak.
- **Components are real React (TSX) files** that an app imports as they are (decision 0003). There is no export step.
- First build (2026-10-20): live co-editing, props, a variants grid (base + per-variant overrides) and basic drawing (frame, text, image slot, new component).
- Full build (from 2026-10-21): the dream in [docs/DREAM.md](docs/DREAM.md), including tokens and themes, and opening existing components from other repos (read-only unless they fit the dialect).
- **Agent-editable**: agents read and write the same documents David edits, live.
- Files on disk are the source of truth (diffable, versionable).

## What it is not
- Not a Figma clone with every feature.
- Not a whiteboard.
- Not hosted (for now): one person and their agents on localhost.
- Not the old precision-canvas 'conformance harness' scope.

## The proving demo
**An agent and David edit the same component live** on the canvas, and the result is a real, reusable component file.

## Interface to the stack
Reads/writes component files and design tokens (from secret-sauce). Exposes an API/MCP surface for agents.

## Decided
- 2026-10-20: Phase 4 starts with a first build (David).
- 2026-10-20: components are React TSX files plus a sidecar (G1); variants are a base plus per-variant overrides (G3); the build grows the 18 Oct spike; local only.
- 2026-10-21: David approved the dream (all 104 criteria and Needs David items N1-N7) in the review page: a token panel and opening other repos' components are now in scope; the dialect widens (decision 0004); G2, G5 and G6 are answered in decision 0005. Hosting stays out until David says otherwise.

## Starting point
The 18 Oct co-editing spike (decisions 0001, 0002). The precision-canvas spec and capability catalog are reference only (see docs/salvage.md).

## Open decisions
- Which Paper weaknesses matter most (write them down from real use first).
- Name: placeholder.
