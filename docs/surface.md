# Surface: one panel, one palette, one key map

The surface is the canvas chrome a person works through: the instrument panel for whatever is selected, the command
palette (Ctrl K), the key map (?), spatial focus on the canvas, and the board (arrangement, groups, comparison,
presentation). It answers DREAM 3 D2 (instruments), D3 (keyboard) and D8 (craft). Decisions are in
[0021](decisions/0021-surface-one-registry-and-board-state.md).

![One registry drives the palette, the key map, the keys and the server](surface/registry.svg)

## What each file does

| File | Role |
| --- | --- |
| `public/canvas/actions.js` | The one registry. Each command: id, label, palette phrase, default keys, argument kind, what it runs. |
| `public/canvas/keynames.js` | One spelling of keys for the page and the server (`Alt+Y`, `Shift+ArrowRight`, `A K`). |
| `public/canvas/commands.js` | The key dispatcher (chords, sequences, counts), palette phrases and what every command does. |
| `public/canvas/surface-panel.js` | The instrument panel: mounts the dials library for the selection, writes through `POST /api/control`, keeps tokens and palettes. |
| `public/canvas/early.js` | Keeps keys pressed while the page is waking and plays them back; makes a typed character sent with an editing key's code replace the selection. |
| `public/canvas/shortcuts.js` | The key map, generated from the bindings in force, with Rebind on each row. |
| `public/canvas/surface.css` | The chrome in the dials design language: Inter, one cobalt accent, hairlines, light and dark. |
| `src/surface/routes.js` | `GET/POST /api/board`, `GET/POST /api/keys`, `POST /api/folder`, the dials files, section depth and kept palettes on `/api/controls/<id>`. |

## Selecting and tuning

- **Select `<path>`** in the palette selects that file's card, flies to it and focuses it. The panel for it is drawn first,
  before a frame that is still loading finishes: the schema is read while the phrase is typed and the cards are read in
  the background two at a time. Keys pressed before the page has woken are kept and played back (`early.js`).
- The panel stands **below the element panel** of an HTML or TSX component, in the same column under a "Whole file" header,
  so drawing it never moves what is above it.
- **Arrow keys** on the canvas move focus to the nearest card that way, judged by the centres of the cards on screen.
  **Shift+Arrow** adds that card to the selection. A number first repeats the move (3, then ArrowRight).
- With several cards selected the panel shows the controls they share; a change goes to each of them.
- **Control `<label>`** puts focus in that control's value, ready to type (`43-7+7` is evaluated). Enter applies it and
  hands focus to the control's label, where arrows step it: Shift coarse (×10), Alt fine (×0.1). **Reset `<label>`**
  puts it back to the value it had when the page opened. **Dial / Bench / Studio `<label>`** set its section's depth;
  the server reports that depth for the control (`GET /api/controls/<id>`) and keeps it across restarts.
- Every change writes the file (or the recipe beside it) and can be undone exactly (Undo in the panel, or G U).

## Commands

| Phrase | Default keys | Outcome |
| --- | --- | --- |
| `Arrange by kind` (folder, date, similarity, tag, status, run) | `A K`, `A F`, `A D`, `A S`, `A T`, `A U`, `A R` | Cards packed in named groups; `GET /api/board` reports `arrange` and `groups`. |
| `Arrange by meta.<column>` | | Groups by a metadata field or data column. |
| `Group <name>` | | The selected cards become a named group, drawn as a frame with its name. The folder is untouched. |
| `Present` | `F5` | The selection (or the first cards) full screen; Escape leaves. `presentation` in the board. |
| `Compare variants <path>` | | One frame per declared variant, side by side (`[data-variant]`); `compare` in the board. |
| `Approve <proposal>`, `Reject <proposal>` | | Answers an agent's proposal through `/api/proposals/<id>/accept or reject`. |
| `Generate <workflow>` | | Asks `POST /api/generate` to queue a ComfyUI workflow. |
| `Open folder <path>` | | `POST /api/folder` switches the running napkin to that folder on the same address ([0022](decisions/0022-surface-open-folder-in-process.md)). |
| `Rebind <command> to <keys>` | | Changes a binding; the key map and the dispatcher follow at once and it is kept. |
| `Go to the instruments`, `Back to the canvas` | `G I`, `G C` | Move focus between the canvas and the panel. |

## Board state

`GET /api/board` returns `{ selection, arrange, groups, views, compare, presentation }`. Arrangement, groups, views,
rebinding and section depths are kept in napkin's state directory, never in the opened folder; selection, comparison and
presentation describe what is on screen and start empty after a restart.

## Figures and keys that needed the host

- The item schema names figures the dials library does not draw (`value`, `meter`); the panel drops those names so dials
  picks by control type. A number with no range of its own, or one with more than 100 steps, gets a ruler that slides under a
  fixed pointer (one tick per step). A text value is drawn as its own first characters.
- Every figure carries `data-figure`. Picture bytes come from `/raw/<id>` (dials' `source` option). Token-bound colours write
  the token (`POST /api/tokens`) and keep `var(--x)`; colours kept in a studio are stored in the board and come back.
- Dial depth is one 32 px row; a long value takes the full width under its label at bench depth.
- Ctrl+Z undoes the newest instrument change of the selected file when it is newer than any element edit.
- A remote-control tool often sends `! " # $ % & ' ( - .` with the virtual-key code of an editing key; the field would move its
  caret or delete before the character arrives. `early.js` keeps the selection from before the key and types the character
  over it. A real keyboard never produces that pair.

## Not done yet

- **One panel is one column, not one set of dials.** The element inspector of HTML and TSX components (cascade and
  provenance, tokens, layout, variables) is still its own DOM (`#panel`) above the dials panel. Its abilities are all
  there; they are not yet dials sections or studios. Writing those sections is the largest open item.
- `Generate` and creating a proposal from the API need routes from the agents lane (and a generation lane); the
  generate, approve and reject journeys of `bench/keys3.js` stay blocked on them.
- The dials `number` figure shows a position in a range; a one-step change on a large number is shown by the host's ruler
  only because the host replaces the figure.
- A cold page spends its first second laying out cards; a selection made in that second takes about 100 ms to show its
  panel because the main thread is busy (swap median measured below).
