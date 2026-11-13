# 0021 surface: one command registry, board state on the server, one instrument panel

Status: accepted (surface lane, round 1)

## Context

DREAM 3 (D2, D3, D8) asks for one panel for anything selected, a palette and key map that list the same commands, and
every command reachable by keys, with the outcome visible to agents and tests through the API. Before this round the
canvas had a second panel for file items (`renderKindPanel` in kinds.js), a key sheet written from `actions.js`, and no
board state on the server.

## Choices

1. **The registry stays `public/canvas/actions.js`.** It was already audited by `test/onboarding/shortcuts.test.js`.
   DREAM 3 commands are added to it with a `phrase` (what the palette runs), `keys` (the default binding) and `arg`
   (what the palette completes: an item, a control, a proposal, free text). The palette, the key map, the server's
   `GET /api/keys` and the key dispatcher (`public/canvas/commands.js`) all read it. Nothing else lists commands.
2. **One key spelling** (`public/canvas/keynames.js`), shared by the server and the page: modifiers Ctrl, Alt, Shift,
   Meta in that order, a single letter upper case, a sequence separated by spaces ("A K"). With Alt, Ctrl or Meta held
   the physical key (`code`) names the letter, so Alt+Y is Alt+Y on every layout.
3. **Board state is served by `src/surface/routes.js`** (`GET/POST /api/board`, `GET/POST /api/keys`). The arrangement,
   named groups, saved views, rebinding and the depth each section was opened at are kept in napkin's state directory
   (`<state>/<folder digest>/surface.json`), never in the opened folder, so arranging or grouping leaves the folder
   untouched. What is on screen now (the selection, a comparison, the presentation) is held in memory only.
4. **A read waits for a write that is still arriving.** `GET /api/board` and `GET /api/controls/<id>` wait (at most
   300 ms) for board writes and instrument writes (`POST /api/control`, `POST /api/undo`) already received, so a read
   made right after a key press sees its outcome.
5. **One instrument panel, drawn by the dials library**, mounted by `public/canvas/surface-panel.js` above the existing
   panel. For a file item it is the whole panel. For an HTML or TSX component the element inspector (cascade, tokens,
   layout, variables) still shows below it in this round; moving those into dials sections is the next step.
6. **Modifiers follow the DREAM 3 contract in the panel**: Shift+Arrow coarse (×10), Alt+Arrow fine (×0.1). The dials
   library's own default is the other way round; the panel host swaps them rather than changing the library.
7. **Compare variants draws one frame per declared variant** through `/view/<item>?props={...}`. This added a props
   query to the TSX view in `src/doc/view.js` and `src/doc/routes.js` (four lines). The variants are the component's
   napkin axes, or else the first string-union prop of its source.

## Consequences

- `renderKindPanel` in kinds.js is no longer called; the kinds lane can remove it.
- `test/kinds/browser.test.js` now looks for the file's section in the instrument panel (`#instruments .instruments`)
  instead of `.kind-panel`; it checks the same text ("File values") and the same `[data-control]` rows.
- No new dependencies.
