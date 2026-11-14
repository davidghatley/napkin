# Basics pass 3: a component from a selection

Standards section 9. Select an element in an HTML frame, run **Create component** (Ctrl+Alt+K, or the palette), and it
becomes a component of its own that looks the same. Nothing is asked first.

![An element selected in a frame](pass3/1-element-selected.jpg)
![The component made from it, beside the frame](pass3/2-component-made.jpg)

## What happens
- A `.tsx` file is written beside the frame, named from the selection's class, id or tag (`.card` gives `Card.tsx`; a
  taken name gets the next free one, and an existing file is never overwritten).
- The markup becomes plain JSX that reads as if written by hand. The CSS rules that reach the selection travel with it,
  inside their media queries, with the keyframes they name, the type and colour inherited from the page, and the custom
  properties they read.
- Every rule is written inside the component's `display: contents` wrapper (`:where(.card-context ...)`), in its cascade
  order, so the same declarations win and nothing reaches a page that uses the component. Selectors that name ancestors
  outside the selection (`.shell > .offer`) are rewritten against the component; a state named on an outside ancestor
  (`.shell:hover .weather`) moves to the wrapper and stays a state; a position the component cannot reproduce
  (`:nth-child(2)` of the frame) is frozen onto the element by its place inside the component. What the elements around it gave it (inherited
  type and colour, custom properties followed through each other, media queries included) sits on a `display: contents`
  wrapper, so a button or a `pre` keeps its native type. `url(...)` from a stylesheet in another folder is rebased, and a
  component's view resolves relative URLs from its own folder. Spaces at the edges of inline elements are kept, and
  white space a `pre` or a `white-space: pre-wrap` rule keeps is written exactly. A root that a grid or flex parent sized
  gets the width it had in the frame.
- Scripts and inline handlers stay behind; the message says which.
- The frame's file is not touched. One undo removes the new file.
- The new card is revealed once it has settled: wholly on the canvas, at 100% (or the largest zoom that fits it), clear
  of the message. It is selected (its root, past the wrapper), so the panel shows it; its Layers file row selects the same.
- Its label is then a field with the automatic name selected: type a name and press Enter to rename the file and its
  export (`POST /api/frames/component/rename`; one undo still removes the component), or Escape to keep the name.
- When it cannot apply (nothing selected, the whole frame, several elements, something that is already a component) it
  says why in one sentence and makes nothing.

## Where it lives
- `src/doc/to-component.js`: HTML and CSS to a component source; `src/doc/component-css.js`: the CSS that keeps it looking the same.
- `src/doc/folder.js` `componentFrom`, `POST /api/frames/component { from, node, name? }`.
- `public/canvas/make-component.js`; the command is `make-component` in the action registry, so menus can list it.
- Tests: `test/basics/to-component.test.js`, `test/basics/component-css.test.js`, `test/basics/component.test.js`, `test/basics/component-fidelity.test.js` (measured in the browser); fixtures in `test/fixtures/component/`.

## Not yet
- The selection is not replaced by an instance of the new component; the frame stays as it was.
- No props are inferred; text and attributes are literal.
