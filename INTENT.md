# INTENT: napkin

> From napkin sketch to real components: a Paper-like design canvas tuned for components, that agents and people edit together.

Status: placeholder name · written 2026-10-17 from David's direction · **this file changes only when David agrees.**

## What it is
- A canvas in the spirit of Paper (paper.design): real HTML/CSS on the canvas, but optimized for **components** (variants, props, tokens) where Paper is weak.
- **Agent-editable**: agents read and write the same documents David edits, live.
- Files on disk are the source of truth (diffable, versionable).

## What it is not
- Not a Figma clone with every feature.
- Not a whiteboard.
- Not starting now: it is Phase 4 of the roadmap. Until then: research, spec, and tiny spikes only.
- Not the old precision-canvas 'conformance harness' scope.

## The proving demo
**An agent and David edit the same component live** on the canvas, and the result is a real, reusable component file.

## Interface to the stack
Reads/writes component files and design tokens (from secret-sauce). Exposes an API/MCP surface for agents.

## Starting point
Scratch. The precision-canvas spec and capability catalog are reference only (see docs/salvage.md).

## Open decisions
- Which Paper weaknesses matter most (write them down from real use first).
- Document model (HTML-first vs a component AST).
- Name: placeholder.
