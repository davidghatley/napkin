# 0017: napkin widens from a component canvas to the shared surface for all agentic work

Status: accepted (David, 2026-11-12)

## Decision
David re-dreamed napkin: it stays a Paper-like shared canvas for a person and their agents, but it is no longer limited to HTML/CSS and React components. It presents and edits any media or data an agent can produce (images, video, audio, animation, datasets, charts, documents, UI), organizes items in any grouping, is fully keyboard-drivable, gives context-specific instrument panels that expand from a single row to a full studio, works with any agent harness, and uses ComfyUI as a generative backend. The dream is in [docs/DREAM3.md](../DREAM3.md).

## Why
Paper showed the value of one surface the person and the agent both work on, but it stops at HTML and CSS. Agents doing long work produce every kind of artifact and need one place to present it. Inspirations David named: DialKit, Leva, Tweakpane, lil-gui, dat.gui, Theatre.js, Motion, Storybook, and the tasty_tunez inspector.

## What changes
- INTENT.md "What it is" widens; the "not a whiteboard" line is replaced (free arrangement and grouping of items are now in scope; freehand drawing is not the goal).
- Kept: files on disk are the source of truth, nothing is imposed on a folder that is only viewed, local only, no pushes or publishing without David.
- Where a file format cannot hold an edit (for example non-destructive image adjustments), the builder records a decision on where the recipe lives before building it.

## Who decided what
David set the direction and the inspirations. The lead agent wrote DREAM3.md from it and runs the build with Codex and opencode agents as builders and critics.
