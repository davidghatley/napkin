# 0013: HTML/CSS first, React also supported, nothing imposed

Status: **accepted** · Date: 2026-10-30 · Decided by: David ("It's meant to be good with components, not be strictly react. If anything it's supposed to be primary HTML/CSS and allow for react components"; "Napkin should simply render the files it loads, not impose an external token system"; approved the re-dream at the gate). Details below proposed by the AI lead (Claude, Opus).

## Context
Decision 0003 (David, 2026-10-20, G1) made components React TSX files in a narrow dialect, with a `.napkin.json` sidecar. Everything since was built on that: a model with 21 allowed tags and style objects, sidecars, a token source in `napkin.json`, and whole files read-only when they leave the dialect. On 2026-10-30 napkin found 0 components in secret-sauce's `ds/project` (23 HTML components) and could edit 0 of 61 shadcn components.

## Decision
- The source of truth is the file text, as it is. napkin renders each component the way a browser renders that file, and edits are small text changes at the exact place in the file.
- Formats:
  - `.html` with its CSS (linked, `<style>` or inline) is first-class;
  - `.tsx`/`.jsx` also open, render and edit.
- napkin writes nothing into a folder except the edits you make. Nothing is required: no sidecar, no `napkin.json`, no token source. Canvas layout and remembered choices live outside the folder.
- Tokens are the CSS custom properties the folder's own files define.
- If a folder's files use variables nothing defines, napkin asks once which stylesheets apply and remembers that outside the folder (David, 2026-10-30).
- Edits are refused one spot at a time, with the reason. A whole file is never refused for being outside a dialect.

## Consequences
- Decision 0003's TSX-only rule is retired, and decision 0004 (dialect widening) goes with it. Criteria that exist only for sidecars or the dialect are retired, each with a reason in the ledger.
- Decision 0012's light-DOM cell reset is expected to give way to a real document per component (an iframe), so `@media` responds to the frame's width. The builder decides and records it.
- The bar for the interface is in the re-dream (D3): a designer would choose napkin over Figma.
