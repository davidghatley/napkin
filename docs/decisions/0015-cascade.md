# 0015: The cascade for one element: one shared resolver, two ways of matching

Status: **proposed** · Date: 2026-10-30 · Written by the AI builder for P2, the inspector lane (Claude, Sonnet). The choice below is the AI's; David has not decided on it. It builds on decisions 0013 and 0014.

## Context
The inspector (dream moments 2, 6 and 8) has to say, for one element, which rule each value comes from, which `var()` definition applies, and what an edit at each scope would change. Two P1 gaps made that wrong or impossible:
- the panel resolved `var(--x)` to the last definition whose `@media` matched, ignoring the definition's selector and inheritance, so it could show and edit the wrong definition;
- `GET /api/component/<id>/rules` ignored `?node=`: an agent could not ask what applies to one element, because matching a selector needs a document tree.

## Decision
1. **One resolver, in one file, used on both sides.** `public/canvas/inspector-cascade.js` is a pure module (no DOM, no imports). Given the component's rules, an adapter (`matches`, `parent`, `inline`, `id`, optionally `media`) and an environment (frame width, light or dark), it returns the rules that reach an element in cascade order, the winner of every property, and every custom property resolved to the one definition that applies. The order is the browser's: importance (inline beats rules at the same importance), then the specificity of the selector part that matched, then source order; a custom property not set on the element is inherited from its parent; `var()` is substituted on the element it is used on, with its fallback, and a cycle makes the value invalid.
2. **Two ways of matching, behind the adapter.**
   - In the canvas the adapter is the frame's own `element.matches()`, `parentElement` and `matchMedia()`. The browser is the matcher, so what the panel shows is what the page does.
   - On the server (`GET /api/component/<id>/rules?node=<id>&width=<w>&theme=<light|dark>`) the adapter is `src/doc/select.js`: a selector matcher over the parsed file (compound and complex selectors, all four combinators, attribute selectors, `:not :is :where :has`, the structural pseudo-classes, `:root`, `:empty`, the form-state ones that the markup decides). The media queries are evaluated by the same module (`width`, `min/max-width`, range syntax, `prefers-color-scheme`, `orientation`, and so on).
3. **Why not a headless page on the server.** An agent over HTTP needs an answer in milliseconds with no browser installed or started; a browser is a process to launch, wait for and kill, and it would answer for the page as drawn (scripts included) rather than for the file. A selector matcher of about 200 lines is deterministic and cheap. The cost is that it can drift from the browser, so the test `test/inspector/parity.test.js` holds three things to the same answers on a document of hard cases at two widths and both themes: Chromium's computed style (the ground truth for every variable and colour), the canvas cascade, and the server cascade, element by element.
4. **What is left out, and said so.** A static file at rest: dynamic states (`:hover`, `:focus`, `:active`, `:visited`, `:target`) never match; scripts and shadow DOM are not seen; `@layer` order, `@container` and shorthand against longhand (`padding` against `padding-left`) are not modelled. A rule that only reaches a pseudo-element (`::before`) is listed with the element but does not compete for its values.
5. **The edit path does not change.** The staged edit becomes one of the existing ops: a value at *this element* is `style`, at *this class* (or rule) is `rule`, at *this variable* is `var`, each aimed at the definition the resolver found. The one-line diff the panel shows before Apply is built from the same rule data; the journey tests check the file diff against it.

## Consequences
- Provenance, overridden values, the scope picker, off-scale flags and the box model all read one cascade; the server and the canvas cannot disagree silently, because a test compares them.
- Agents get `GET /api/component/<id>/rules?node=` with the same fields the panel uses (`node.rules`, `node.props`, `node.vars`, each with file and line).
- Selector features added to CSS later must be added to `select.js` too; the parity test is where a gap shows first.
- Sweeping the leftovers of a killed writer (`.<name>.tmp-<pid>-<n>`, `.<name>.guard-<pid>-<n>`, only for dead pids, only beside files the engine maps) happens when a folder is opened and before each write; `/raw/` refuses any path segment that starts with a dot.
