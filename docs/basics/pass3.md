# Basics pass 3: a component from a selection

Standards section 9. Select an element in an HTML frame, run **Create component** (Ctrl+Alt+K, or the palette), and it
becomes a component of its own that looks the same. Nothing is asked first.

![An element selected in a frame](pass3/1-element-selected.jpg)
![The component made from it, beside the frame](pass3/2-component-made.jpg)

## What happens
- **Trigger.** Ctrl+Alt+K, the palette, the right-click menu, or the Create component button beside the selection name in the
  right panel (same command, same enabled rule, shortcut shown). Undo of it selects the source element again; redo makes the
  component again and selects it.
- **Naming in place.** The file is written beside the frame at once, named from the selection's class, id or tag (`.card`
  gives `Card.tsx`; a taken name gets the next free one; an existing file is never overwritten). The new card's label is then
  a field with that name selected: Enter renames the file and its export (`POST /api/frames/component/rename`), Escape keeps it.
- **Refusals.** It makes nothing and says why in one sentence when nothing is selected, several elements are, the selection
  is the whole frame (the frame's Layers row, its label and `html`/`head`/`body` all count), it is already a component, it is
  inside an `<svg>` (select the whole `<svg>`), or it is part of a table (select the whole table).
- **Carried over.** The markup becomes plain JSX that reads as if written by hand: long tags take a line per attribute, a
  textarea's text and `<option selected>` become `defaultValue`, and inline custom properties and `!important` declarations move
  into the component's CSS (a style object cannot hold them). The CSS that reaches the selection travels with it, one declaration
  per line, inside its media queries, with the keyframes it names, the custom properties it reads and the type and colour
  inherited from the page (on a `display: contents` wrapper). Every rule is `:where(.card-context ...)` in cascade order, so
  the same declarations win and nothing reaches a page that uses the component. Selectors naming outside ancestors are
  rewritten against the component; a state on an outside ancestor stays a state on the wrapper; a position the component
  cannot reproduce is frozen onto the element. `url(...)` is rebased to the component's folder, spaces and `pre` text are
  kept, and the root keeps the size it had in the frame (`width: min(Npx, 100%)`, plus a height a grid or flex row gave it).
- **Left behind.** Scripts and inline event handlers; the message lists them. The frame's file is not touched.
- **Inspector.** The made component's panel lists the rules of its scoped `<style>` (padding, border, colours) like any frame's.
- **Reveal.** The new card is shown whole and readable, clear of the message, and selected (its root, past the wrapper).
- One undo removes the new file and card, also after a rename.

## Where it lives
- `src/doc/to-component.js`: HTML and CSS to a component source; `src/doc/component-css.js`: the CSS that keeps it looking the same.
- `src/doc/folder.js` `componentFrom`, `POST /api/frames/component { from, node, name? }`.
- `public/canvas/make-component.js`; the command is `make-component` in the action registry, so menus can list it.
- Tests: `test/basics/to-component.test.js`, `test/basics/component-css.test.js`, `test/basics/component.test.js`, `test/basics/component-fidelity.test.js` (measured in the browser), `test/basics/component-history.test.js` (undo, redo, header button, inspector); fixtures in `test/fixtures/component/`.

## Not yet
- The selection is not replaced by an instance of the new component; the frame stays as it was.
- No props are inferred; text and attributes are literal.
