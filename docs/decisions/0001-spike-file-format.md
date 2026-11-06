# 0001: Spike file format (canonical JSON node tree)

Status: **proposed** (spike only; does not settle GAPS.md G1)
Date: 2026-10-18 · Proposed by: AI build lead (Claude). Not decided by David.

## Context
FEATURES.md "Build first" needs a component file that round-trips byte-identically and gives a one-line diff for one property change (F01). INTENT leaves "HTML-first vs a component AST" open, so the spike needs a stand-in that's cheap to throw away.

## Decision
For the spike, a component is one file, `components/<Name>.json`:
- `format: "napkin/0"`, a stable `id` separate from `name` (salvage INV-08), and one `root` node;
- each node has `id`, `tag`, optional `text`, `style` (camelCase CSS properties, one per line) and `children`;
- written canonically as `JSON.stringify(doc, null, 2) + "\n"`, keeping key order, so load-then-save is byte-identical and one property is one line;
- revisions live in memory or in a sidecar, never in the file, so an edit doesn't add a second diff line.

Edit paths are `<nodeId>.<prop>` (`title.fontWeight`; `text` means the node's text). The canvas renders it as real HTML with inline styles (`src/render.js`).

## Consequences
- It's simple to diff, validate and render, with no parser dependency.
- It isn't a component an app can import yet. Exporting to HTML/JSX or switching to HTML-first is G1, for David.
- Hand-written files that aren't in canonical form get normalised on first save (one noisy diff).
