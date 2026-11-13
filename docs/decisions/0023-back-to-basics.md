# 0023: back to basics: perfect a small core before adding more

Status: accepted (David, 2026-11-13)

## Decision
The wide build toward DREAM 3 (54 file kinds, five parallel lanes) is on hold. napkin goes back to a small set of base components and makes each one as intuitive and well made as Figma and tldraw make theirs. More is added only after that, one piece at a time, judged against the standards the basics set (`docs/basics/standards.md`).

## Why
Supporting many kinds at once spread the work thin: many details, none finished. The interface dimensions were barely touched while kinds took most of the rounds, and the parts that were built fought each other (a full-window "studio" that hides the canvas, two right-hand panels, tools that do nothing on empty canvas).

## What is on
- Kinds: HTML, TSX/JSX components, CSS, SVG, raster images, Markdown and text.
- The canvas, the top bar, the layers panel, one right-hand tool panel, the command palette and key map.

## What is on hold (code kept, nothing deleted)
- Every other kind (video, audio, data tables, charts, 3D, fonts, PDF, notebooks, archives, workflows, run logs). They stay in `src/kinds/registry.js`, switched off; their files show as plain file cards. `NAPKIN_ALL_KINDS=1` switches them all back on. The test suite sets it, so their tests keep running; the `bench/*3.js` benches need it set and are not gates for now.
- The agents lane (runs, review queue, questions): branch `d3/agents`, not merged.
- Generation, timeline and organization lanes: not started.
- DREAM 3 stays as the long-range picture; it is not the working bar for now.
- Lane heads are tagged `archive/d3-<lane>-2026-11-13`.

## What changes in the basics
- Tools stay in the sidebar and never cover what is being edited. The three depths and the full-window studio go; widening or lengthening the panel reveals more control.
- Frame, Text and Image work on empty canvas. A frame drawn on the canvas is its own HTML file.
- A component is made from a selection (select some HTML, convert it), not named up front.
- Right-click menus everywhere, driven by the same command registry as the palette and keys.
- One mark: the 5x5 folded-napkin pixel glyph (`public/brand/`).

## How the work runs
One owner at a time, in order, because the pieces are coupled. David reviews each pass on the running app before the next starts.

## Note on decision numbers
Lanes working in parallel reused numbers 0018, 0019, 0021 and 0022. The files keep their names because code comments cite them; the lane name in each filename tells them apart.
