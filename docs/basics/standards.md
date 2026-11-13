# napkin basics: interaction standards

Status: proposed. Written 2026-11-13 for decision 0023. Judge every base component against this file.

## Summary: the ten rules that matter most

1. Tools live in the sidebars and the top bar. Nothing opens over the canvas: no modal, no full-window editor.
2. One right panel. It follows the selection. Wider or taller reveals more controls; nothing else does.
3. Select (V), Frame (F), Text (T) and Image (I) all work on empty canvas. Click makes a default; drag makes a sized one.
4. After one use a tool returns to Select (Figma and tldraw both do this). A tool lock is TBD.
5. Escape always backs out one step: cancel the drag, leave the edit, leave the tool, go up a level, clear the selection.
6. Click selects the top-level thing; double-click or Enter goes one level in; Shift+Enter goes up.
7. Every command exists once in the registry and appears in the palette, the key map and the right-click menu, with its shortcut shown.
8. A frame drawn on the canvas is its own HTML file; its label is its file name; double-click the label to rename.
9. A component is made from a selection (Create component, Ctrl+Alt+K), then named. The file is TSX; uses are instances.
10. One 4 px spacing scale, three control heights, one icon size, one focus ring, one motion duration for state changes.

Source key. [F] Figma Help Center, [T] tldraw docs, [P] Paper. Paper's public docs list only MCP, Snapshot, Tokens, Support, Paste and SVG pages (https://www.paper.design/docs); they say nothing on basic canvas behaviour. Every Paper rule here is TBD. Where no source was reachable, the rule says "no source" and is a proposal, not a finding.

---

## 1. Top bar

**Purpose.** Global actions and the tool set. It never holds per-selection properties (those are in the right panel).

**Current state.** `public/index.html` has brand, `#toolbar` (V F T I plus New component), a search button, then revision, agent status, presence, theme toggle on the right.

**How the best do it.**
- Figma UI3 puts the navigation panel (file name, pages, layers) on the left and a floating toolbar at the bottom of the canvas. Floating side panels were tried in beta and reversed to fixed, resizable ones because they cramped the canvas. https://www.figma.com/blog/our-approach-to-designing-ui3/ and https://help.figma.com/hc/en-us/articles/360039831974-Navigate-the-UI-in-Figma-Design
- tldraw puts the main menu top-left, the toolbar in the bottom zone, and the style panel top-right on desktop. https://tldraw.dev/sdk-features/ui-components
- Both keep the tool group in one place, centred; neither crowds status text next to it.

**Recommendation for napkin.** Keep the toolbar in the top bar (the bar already exists; a bottom toolbar would cover canvas, which breaks rule 1). Centre it.

**Rules.**
1. Left: brand mark (opens a main menu: file, view, help), then project/folder name. Width is fixed to the left panel width so the centre does not shift when panels resize.
2. Centre: one tool group in this order: Select, Frame, Text, Image. Then a separator, then the command palette button (Ctrl+K). "New component" is removed from the group; components come from a selection (section 9).
3. Right: revision, agent/presence, theme toggle, zoom control. Nothing else. Status text is muted and never takes focus.
4. The bar height is 40 px (section 10). Gaps: 4 px inside a group, 8 px between buttons of different groups, 16 px between the three zones' minimum clearance.
5. Click a tool arms it. Click the armed tool again does nothing (it does not toggle off; Escape or V leaves it).
6. Toolbar is `role="toolbar"`; arrow keys move between buttons (roving tabindex); Enter/Space arms.
7. The bar never wraps. Below 720 px wide, the right zone collapses into a "..." menu.

**States.**
| State | Look |
|---|---|
| rest | icon in text-muted, no fill |
| hover | fill `--hover` (8% ink), tooltip after 500 ms: "Frame  F" |
| armed | fill `--accent-soft`, icon in accent, `aria-pressed=true` |
| focus | 2 px focus ring, 2 px offset (keyboard focus only, `:focus-visible`) |
| disabled | 40% opacity, no hover, tooltip says why |

---

## 2. Tools and arming

**Purpose.** Choose what a pointer gesture does on the canvas.

**Current code.** `public/canvas/tools.js` draws only inside a rendered component and inserts a node into the element under the pointer. On empty canvas the tools do nothing. That is the fault to fix.

**How the best do it.**
- Figma: Frame tool is F (or A). Click the canvas makes a top-level frame (first is 100 x 100; later ones reuse the last size). Click inside a frame adds a nested 100 x 100 frame. Click-drag makes a custom size. https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
- tldraw: tools like geo, arrow and note "normally return to select after creating a shape". Tool lock is a flag; when set, the tool stays active. The state machine does not enforce it; each tool checks it. https://tldraw.dev/sdk-features/tools
- tldraw text: Escape exits the text tool and returns to select. https://tldraw.dev/sdk-features/text-shape
- Figma tool-return behaviour for Frame and Text: no source reached. Observed in use: the tool returns to Move after one shape. Treat as unverified.

**Difference.** Figma and tldraw agree: one use, then back to Select. tldraw adds an optional lock. **Recommend: one use, return to Select; add lock later** (TBD whether lock is a double-tap of the key or a button). Reason: it prevents the "why is everything a frame" trap and both references do it.

**Rules.**
1. V arms Select. F arms Frame. T arms Text. I arms Image. Keys are ignored while typing in an input or editing text.
2. Armed tool shows in the toolbar (section 1) and in `body[data-tool]`. The status area says what a click will do: "Click or drag to draw a frame."
3. Cursor: Select = arrow; Frame, Text, Image = crosshair; over a text-editable element with Text armed = I-beam; while dragging a new shape = crosshair; over a resize handle = the matching resize cursor; while panning (Space held) = grab/grabbing.
4. With Frame armed, a click on empty canvas creates a frame at the click point, top-left at the pointer. Default size 320 x 180 (tldraw's default; Figma's 100 x 100 is too small to read as a screen).
5. A press-drag of more than 4 px draws a rectangle from the press point to the pointer. Shift constrains to a square. Alt/Option draws from the centre. Release creates the frame at that size, minimum 48 x 32.
6. After creating, the tool returns to Select, the new item is selected, and (for Text) it is in edit mode. The creation is one undo step.
7. With Frame armed, click inside an existing frame creates a nested frame (section 3 rule 9). Click on empty canvas creates a top-level one.
8. Text armed: see section 4. Image armed: click or drag creates an empty image slot (default 160 x 120) on the canvas or inside the frame under the pointer; the file picker opens at once (no modal editor; a native picker is allowed). Cancel in the picker removes the empty slot.
9. Escape while dragging a new shape cancels it and creates nothing. Escape while a tool is armed and idle returns to Select. Escape in Select clears the selection.
10. Pressing another tool key while armed switches tool. Pressing a tool key mid-drag is ignored.
11. Space held pans in any tool. Middle-mouse drag pans. Scroll zooms with Ctrl/Cmd, pans otherwise. (No source; common to all three tools. Confirm.)
12. A tool never opens a form or dialog on the canvas. (Today's "New component" name form goes away.)

**Path summary.** Pointer: click toolbar button, then click or drag canvas. Keys: letter, then click or drag. Palette: "Frame tool".

---

## 3. Frames

**Purpose.** A frame is an artboard. On napkin it is one HTML file in the folder, drawn at its place on the canvas.

**How the best do it.**
- Figma: top-level frames cannot sit inside anything; nested frames can. Top-level frame names show bold in layers. Enter selects a child, Tab the next sibling, Shift+Enter the parent. Resize by dragging a handle; Ctrl/Cmd ignores child constraints; W/H fields in the properties panel take arithmetic like `+100`. https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
- Figma: the label of a top-level frame sits above its top-left corner; double-clicking it renames (the Frames article does not cover this; no source).
- tldraw: each frame has a heading above its top edge; click the heading to edit. Pressing Enter with the frame selected does not open name editing. Default 320 x 180. Children are clipped; when a frame is drawn around existing shapes, shapes fully inside become its children. Unnamed frame shows "Frame". https://tldraw.dev/sdk-features/frame-shape

**Recommendation.** Label above the frame; double-click label renames (Figma). F2 also renames (Figma layer rename key; no source reached, common convention). Auto-name "Frame 1", "Frame 2" (Figma-style numbering; tldraw has none).

**Rules.**
1. Creating a frame on the canvas writes a new `.html` file in the open folder. Its file name and its label are the same: `frame-1.html` shows "frame-1". Next free number is used; never overwrite.
2. The label sits 4 px above the frame's top-left, 11 px text, muted at rest, ink when hovered or selected, truncated with an ellipsis at the frame width.
3. Double-click the label: it becomes an input with the text selected. Enter commits and renames the file. Escape cancels. Blur commits. An empty name or an existing name is refused with an inline message and the input stays open.
4. Click the label selects the frame. Drag the label moves the frame.
5. Click anywhere on the frame's empty background selects the frame. Drag moves it (4 px threshold). Arrow keys nudge 1 px; Shift+arrow 10 px.
6. Eight handles (corners and edges) on the selected frame. Drag resizes; Shift keeps aspect; Alt resizes from the centre. Size appears in a small tag below the frame while resizing ("320 x 180"). Min 48 x 32.
7. The right panel has W and H fields. Typing `+100`, `*2` is accepted. Enter commits, Escape reverts.
8. Moving or resizing a frame is one undo step and writes the frame's stored position/size (where that lives is TBD with David: the HTML file or a canvas layout file; INTENT says files are the source of truth, so prefer data the file owns).
9. Nesting: with Frame armed, clicking inside a frame creates a frame inside it (an element in that file). Dragging an element onto another frame re-parents it into that frame's file; dropping it on empty canvas leaves it in its own frame. A drop target frame is outlined 2 px in accent while a drag hovers it.
10. Children are clipped to the frame. Hit-testing respects the clip.
11. Delete or Backspace removes the selected frame; the file goes to the project trash, not unlinked (so undo restores it). Duplicate is Ctrl+D and makes `frame-2.html`.
12. Enter on a selected frame selects its first child. Shift+Enter selects the parent.

**States.** Hover: 1 px accent outline plus label turns ink. Selected: 2 px accent outline, handles. Focus (keyboard): same as selected plus the ring on the label. Disabled (read-only file): lock glyph in the label, no handles.

---

## 4. Text

**Purpose.** Place and edit copy on a frame.

**How the best do it.**
- tldraw: click with the text tool makes an auto-size shape at the click and enters edit mode at once. A held horizontal drag (at least 150 ms, past a threshold) makes a fixed-width shape; short drags stay auto-size. Double-click or Enter on a selected text shape edits. Cmd/Ctrl+Enter confirms. Escape exits the tool. Empty or whitespace-only text deletes itself when editing ends. Dragging a side handle converts auto-size to fixed width. https://tldraw.dev/sdk-features/text-shape
- Figma: auto width makes a new line only on Enter; fixed size wraps. The reached article does not cover click vs drag or Escape. https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties (Figma: click makes auto width, drag makes fixed width; stated as common knowledge, no source reached.)

**Recommendation.** Follow tldraw's rules (they are written down). Escape commits (Figma behaviour; no source) rather than discards, because losing typed text is worse than keeping it.

**Rules.**
1. Text armed, click on a frame: a text element (auto width, default 16 px, ink colour) is inserted at the pointer inside that frame and the caret is in it. Click on empty canvas (no frame): a new frame file is created at the pointer, sized to hug the text, with the text inside and the caret in it (agreed in the plan David approved, 2026-11-13). If the text is left empty, the new frame is removed again.
2. Press-drag of more than 4 px draws a box; release creates fixed-width text with that width, height auto. Text wraps at the width.
3. While editing: typing inserts; Enter makes a new line; Shift+Enter is a soft line break (TBD if the HTML needs both). Ctrl+B/I/U toggle styles. The edit is in place on the canvas; no modal.
4. Commit: Escape, click outside, or Ctrl/Cmd+Enter. Commit writes the HTML and is one undo step. After commit the tool is Select and the text stays selected.
5. Empty or whitespace-only text is deleted on commit. This is not an undo step of its own; creating and deleting leave no trace.
6. Double-click an existing text element (Select tool) enters edit with the word under the pointer selected. Enter on a selected text element enters edit with all text selected. F2 same as Enter.
7. A side handle drag converts auto width to fixed width; double-click a side handle converts back.
8. Right panel for text: Typography section (font, size, weight, line height, align, colour).
9. Arrow keys move the caret while editing; they nudge the element only when not editing.

---

## 5. Selection

**Purpose.** Pick what the right panel, menus and keys act on.

**How the best do it.**
- Figma: click selects (the top-level ancestor of a nested object by default); Shift-click adds or removes; marquee from empty canvas, Ctrl/Cmd includes nested layers; double-click or Enter goes one level down; Shift+Enter up; Tab / Shift+Tab sibling; Ctrl/Cmd-click deep-selects directly; Escape or click on empty canvas clears; Ctrl+Shift+A inverts. https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects
- Figma: hovering a layer in the Layers panel highlights it on canvas (a preference). Same page.
- tldraw: Tab / Shift+Tab move between shapes; Ctrl/Cmd+arrows move to the nearest shape in that direction; Ctrl/Cmd+Shift+Up selects the parent (only for a single selection); locked shapes cannot be clicked or brushed. https://tldraw.dev/sdk-features/selection and https://tldraw.dev/sdk-features/accessibility
- Canvas hover outlines: no source reached (Figma draws a thin outline; recommend same).

**Difference.** Figma goes up with Shift+Enter; tldraw with Ctrl/Cmd+Shift+Up. **Recommend both** (one registry command "Select parent"). Escape: in Figma it clears; here Escape goes up a level first and clears at the top (the owner's wish for "Escape to go up a level"; no reference does this, so confirm).

**Rules.**
1. Click on an element: select the highest ancestor that is a direct child of the current scope. The scope starts at the canvas (so frames are picked first).
2. Double-click on a selected container: select the child under the pointer (and set the scope to the container). Enter: select the first child. Double-click on text: edit (section 4).
3. Ctrl/Cmd-click: select the deepest element under the pointer, ignoring scope.
4. Shift-click toggles one item in the selection. Selection is always same-scope: Shift-clicking an item in another frame replaces the scope.
5. Press on empty canvas and drag: marquee. A marquee selects items it touches at the current scope. Hold Ctrl/Cmd to include nested. The marquee is a 1 px accent outline with 8% accent fill. Release with no item clears the selection.
6. Click on empty canvas: clears the selection, scope returns to canvas.
7. Escape: if scope is deeper than the canvas, select the parent and go up one level; otherwise clear the selection.
8. Shift+Enter or Ctrl/Cmd+Shift+Up: select the parent. Tab / Shift+Tab: next or previous sibling. Ctrl+A: all in scope.
9. Hover: the element under the pointer (at the current scope) gets a 1 px accent outline. Hovering a layer row outlines its element on canvas. Hover outline is hidden for already-selected items and while dragging.
10. Selection state is shown in three places at once: canvas outline and handles, the highlighted layer row, the right panel. They always agree.
11. Locked items cannot be clicked on canvas; they can be selected from layers.

---

## 6. Left panel (layers)

**Purpose.** The outline of the open files and the elements inside them.

**How the best do it.**
- Figma: the left panel lists file, pages and layers in one linear hierarchy; new layers go to the top of their parent or just above the selection; "Collapse layers" is in the panel's top right; hovering a row highlights it on canvas; drag layers in or out of a group; top-level frames are bold. The width is set by dragging the right edge. Minimize UI is Ctrl/Cmd+Shift+\ . https://help.figma.com/hc/en-us/articles/360039831974-Navigate-the-UI-in-Figma-Design , https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
- Rename-by-double-click, Alt+Ctrl+click lock/hide: no source reached; both are Figma behaviour in use.

**Rules.**
1. Top of panel: one heading "Layers" and a Collapse-all button and a search field (Ctrl+F when the panel has focus). Remove the Layers/Styles/Changes tab strip from the base build; "Changes" is on hold with the other lanes.
2. Rows: top-level frames (files) bold; children indented 12 px per level. Each row: disclosure triangle (if children), 14 px type icon, name, and on hover the hide and lock buttons at right.
3. Order: top of the list = front of the stack (Figma). Default is z-order, as in Figma.
4. Click selects. Shift-click selects a range. Ctrl/Cmd-click toggles. Selection syncs with the canvas (section 5 rule 10).
5. Triangle click toggles one row. Alt+click toggles the row and all descendants. Right arrow expands a collapsed row, then moves to the first child; Left arrow collapses, then moves to the parent. Up/Down move. Home/End jump.
6. Selecting an item on canvas expands its ancestors and scrolls its row into view.
7. Double-click a row name, or F2 on a focused row: rename in place. Enter commits, Escape cancels. A frame row rename renames the file (section 3 rule 3).
8. Drag a row to reorder. A 2 px accent line shows the drop slot; dropping onto the middle of a container row makes it a child, with the row highlighted. Escape cancels the drag. Reorder writes the file(s) and is one undo step.
9. Hide (eye) sets `display:none` visually in napkin only? TBD: whether hide edits the file or is a view-only flag. Default: view-only flag, not written.
10. Collapse the whole panel with Ctrl/Cmd+Shift+\ (all panels) or a chevron in the panel header (this panel only). Collapsed, the canvas takes the width and a 16 px edge handle remains to reopen. State is remembered.
11. Resize: drag the right edge; cursor changes to col-resize; width 200 to 400 px, default 240; double-click the edge resets. Width is remembered.
12. Empty state: "No frames yet. Press F and draw one." with the tool glyph.
13. Rows are a `role="tree"`; each row `role="treeitem"` with `aria-expanded`, `aria-selected`. One tab stop for the tree.

**States.** rest: ink text; hover: `--hover` fill; selected: `--accent-soft` fill and accent text; hover-from-canvas: dotted outline; focus: ring inside the row; disabled/locked: 50% text with lock glyph.

---

## 7. Right panel (properties)

**Purpose.** One panel for the current selection. The owner's rule: tools stay in the sidebar and never cover the canvas. Making the panel wider or a section taller reveals more controls. No modal or full-screen editors.

**How the best do it.**
- Figma Design tab: with nothing selected it shows page-level items (local styles and variables, canvas background, export). With a layer selected it shows layer controls: fill, stroke, effects, export. Property labels can be turned on from the zoom menu. https://help.figma.com/hc/en-us/articles/360039832014-Design-tab-properties-panel (the reached page did not give section order or resizing).
- UI3: the properties panel puts component controls first, unifies layout options, shows constraints expanded by default, and always shows pixel values and resize mode for Auto Layout. Panels are fixed but resizable. Blend modes appear inline only when set to a non-default value. Visible labels match screen-reader labels. https://www.figma.com/blog/our-approach-to-designing-ui3/
- Figma order (from use, not from a fetched page): position/layout, appearance (opacity, corner radius), typography (text only), fill, stroke, effects, export. Confirm against UI3 before building. Source for exact order: TBD.
- tldraw: the style panel shows only the styles that apply to the selection, top right on desktop. https://tldraw.dev/sdk-features/ui-components
- Paper: TBD.

**Rules.**
1. There is exactly one right panel (`#inspector`). The second panel and the full-window studio are removed.
2. Content follows the selection. Nothing selected: page/canvas settings (background, zoom, grid, tokens link). One item: that item's sections. Several items: only sections common to all; mixed values show "Mixed" and editing sets all.
3. Header: item name (editable like a layer name), type glyph, and for HTML elements the tag. Under it, a segmented row of the item's actions (Create component, Duplicate, Delete) is TBD; first build has the name only.
4. Sections in this order: Layout (X, Y, W, H, rotation, display/flex), Appearance (opacity, radius, overflow), Typography (text only), Fill, Stroke, Effects, Component (props and variants, component items only). A section shows only when it applies.
5. Section header: label (12 px, medium), a collapse chevron, and a "+" where a list can grow (fills, strokes). Click the header toggles. Collapsed state is remembered per section.
6. Progressive disclosure, three levers and no others:
   a. Selection: only relevant sections show.
   b. Panel width: at the default 280 px each row has label, field. At 360 px or more, rows gain a second column (for example X/Y beside W/H, and the extra unit and token pickers). Below 240 px the labels hide and icons stay.
   c. Section height: a section's list is capped at 6 rows with a drag handle at its bottom edge; dragging it down shows more rows (long CSS rule lists, many fills). A "Show all" link also works.
7. Advanced options (individual padding sides, per-corner radius, blend mode, CSS variables) sit behind a small toggle button at the right of the row. They open inline, inside the panel, never as a popover over the canvas. Non-default advanced values show inline without the toggle (UI3 does this for blend mode).
8. Resize: drag the left edge; col-resize cursor; width 240 to 480 px, default 280; double-click the edge resets; width is remembered. Collapse with the chevron or Ctrl/Cmd+Shift+\ (panel returns when an item is selected while minimised, as in Figma Minimize UI). https://help.figma.com/hc/en-us/articles/360039831974-Navigate-the-UI-in-Figma-Design
9. Fields: click focuses and selects all. Enter commits and keeps focus; Tab commits and moves on; Escape reverts the field and returns focus to the canvas. Up/Down arrow change a number by 1; Shift+arrow by 10; drag on the label scrubs the number. Math is accepted (`+8`, `*2`).
10. Every edit applies live and is one undo step per commit (scrubbing is one step on release).
11. Colour fields open a small popover anchored to the field and inside the panel's bounds if it fits, never covering the selected item (the colour popover is the one allowed floater; TBD whether to inline it instead).
12. Labels are visible always; no icon-only fields except where the field has a text tooltip and `aria-label`.
13. Empty state, nothing selectable: "Select something to edit it."

---

## 8. Right-click context menus

**Purpose.** The same commands as the palette and keys, placed where the pointer is.

**How the best do it.**
- tldraw exposes a `ContextMenu` slot that is customisable; the reached page does not list contents or keyboard operation. https://tldraw.dev/sdk-features/ui-components
- Figma's right-click menu contents (from use, not a fetched source): clipboard group (Copy, Paste here, Copy as...), order (Bring to front, Send to back), group/ungroup/frame selection, Create component, Show/Hide, Lock, Flatten. Right-click on selection shows "Create component" per https://help.figma.com/hc/en-us/articles/360038663154 . Full list: TBD.
- Paper: TBD.

**Rules (all menus).**
1. Open by right-click, Shift+F10, or the Menu key when the canvas or layers panel has focus. Opens at the pointer; with keyboard, at the selection's top-left.
2. Right-clicking an unselected item first selects it (and clears others); right-clicking a selected item keeps the whole selection.
3. Items: label at left, shortcut at right (muted, platform-formatted: Ctrl+D, Cmd+D). Submenu: chevron at right; opens on hover after 150 ms or on Right arrow or Enter. Groups are divided by a 1 px separator. Max one level of submenu.
4. Disabled items stay visible at 40% opacity (so the menu shape stays stable). Items hidden only when they cannot ever apply.
5. Keyboard: Down/Up move (wrapping); Home/End; Right opens a submenu, Left closes it; Enter or Space runs the item; Escape closes one level then returns focus to the canvas; typing a letter jumps to a matching item. `role="menu"`, items `role="menuitem"`.
6. Click outside, scroll, or tool change closes it. The menu opens within the viewport (flips at edges).
7. Items come from the command registry; a command not in the registry cannot appear in a menu.
8. The menu is the only thing that opens at the pointer; it never contains a form.

**Contents by target.** Group order is the same everywhere: edit, arrange, create, view, delete.

| Target | Items |
|---|---|
| Empty canvas | Paste here (Ctrl+V); Add frame (F); Add text (T); Add image (I); separator; Select all (Ctrl+A); Zoom to fit (Shift+1); Zoom to 100% (Shift+0); Show grid; Show layers (panel toggle) |
| A frame | Cut, Copy, Paste inside; Duplicate (Ctrl+D); Rename (F2); separator; Bring to front, Send to back (submenu: Order); Add frame inside; separator; Create component (Ctrl+Alt+K); Open file in editor; Reveal in file manager; separator; Hide, Lock; Delete |
| Element inside a frame | Cut, Copy, Paste; Duplicate; Rename; separator; Select parent (Shift+Enter); Select children; Bring forward / Send backward (Order); Wrap in frame (Ctrl+Alt+G); separator; Create component; Copy as HTML; Copy CSS; separator; Hide, Lock; Delete |
| Several selected | Cut, Copy; Duplicate; separator; Align (submenu); Distribute (submenu); Wrap in frame; Group (Ctrl+G); Ungroup; separator; Create component (single container only, else disabled with reason); separator; Hide, Lock; Delete |
| Layer row | Same as the item's menu, plus Rename (F2), Collapse/Expand, Collapse all children, Reveal on canvas |
| Component instance | Go to main component; Detach instance; Reset overrides; plus the element menu |

Shortcuts shown must match the key map exactly; a test compares the menu against the registry.

---

## 9. Component from selection

**Purpose.** Turn selected HTML into a reusable TSX component. Per decision 0023 a component is made from a selection, not named up front.

**How the best do it.**
- Figma: select layers, then Create component by button next to the selection name in the right panel, by right-click, or by Option+Command+K / Ctrl+Alt+K. Figma wraps the selection in a component frame; the layers become its children. The main component shows a purple component icon in layers. Bulk: Create multiple components makes one per frame, group, boolean operation or path. https://help.figma.com/hc/en-us/articles/360038663154
- Figma: an instance is "a copy of the component you can reuse"; it stays linked to the main component. Right-click an instance, Go to main component. Insert instances from Assets, or Shift+I quick insert. https://help.figma.com/hc/en-us/articles/360039150173-Create-and-insert-component-instances , https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma
- Naming at creation: not described by the reached article. The new component takes the selection's layer name; rename is the normal layer rename.

**Mapping to napkin.**
| Figma | napkin |
|---|---|
| Selection | An element or elements in an HTML frame |
| Main component | A `Name.tsx` file whose default export is the component |
| Instance | A `<Name />` use in the frame's HTML/TSX; the frame file keeps the use, not a copy |
| Component frame | The new file's root element |
| Purple icon | Component glyph on the layers row of the main file and of each instance |

**Rules.**
1. Enabled when the selection is one element, or several siblings in the same frame (wrapped in a new root). Otherwise disabled with the reason in its tooltip.
2. Triggers: Ctrl+Alt+K; right-click, Create component; the button beside the name in the right panel's header; palette.
3. On trigger the component is created at once, with an auto name from the selection (the root tag or text, PascalCased: `Card`, `Button`; a clash gets a number: `Card2`). No dialog appears first.
4. After creation the layers row for the new component is in rename mode with the name selected, so naming happens after (the owner's rule). Enter commits (renames the file and every use); Escape keeps the auto name.
5. The extracted file is `src/components/Name.tsx` (folder TBD with David). The selected HTML becomes JSX (class to className, style strings to objects, void tags closed). Text content stays inline. The original selection is replaced by one instance, selected.
6. If the HTML cannot convert (inline script, unknown attributes), nothing changes and the hint names the problem. No partial result.
7. Editing a main component updates all instances live. Editing an instance writes only props/overrides (TBD: prop model from extracted text and colours is a later pass).
8. Right-click an instance: Go to main component (opens and selects it), Detach instance (inlines the HTML again), Reset overrides.
9. Undo reverses the whole operation (file created, selection replaced) as one step.
10. The "New component" tool button and its name form are removed.

---

## 10. Visual tokens for chrome

**Purpose.** Few values, used everywhere in the chrome. Canvas content is user HTML and is not styled by these.

**How the best do it.**
- Figma UI3: hand-drawn icons, visible labels, inline dropdowns over icon menus; no published pixel values (https://www.figma.com/blog/our-approach-to-designing-ui3/). So the numbers below are proposals, not Figma's. Figma's real values: TBD (not in public docs).
- tldraw: no published chrome tokens found in the pages reached; TBD. https://tldraw.dev/sdk-features/ui-components
- Reduced motion: tldraw follows `prefers-reduced-motion` and exposes a setting. https://tldraw.dev/sdk-features/accessibility

**Proposed values.**

| Token | Value |
|---|---|
| Space scale (4 px base) | 4, 8, 12, 16, 24, 32 (`--s1` ... `--s6`). Nothing else. |
| Control height | 24 (compact: fields, rows), 32 (buttons, toolbar buttons), 40 (top bar) |
| Row height, layers | 28 |
| Icon size | 16 (stroke 1.5); a 14 px glyph is retired |
| Hit target | at least 24 x 24 even when the icon is 16 |
| Panel padding | 12 (section), 8 (inside rows); section gap 0 with 1 px dividers |
| Type, sizes | 11 (labels, shortcuts), 12 (body, fields, rows), 13 (menu items, panel headings), 14 (empty-state text). One family (Inter, already bundled); weights 400 and 600 |
| Line height | 16 for 11 and 12; 20 for 13 and 14 |
| Border | 1 px, `--line` |
| Radius | 4 (fields, rows, buttons), 8 (menus, popovers). Nothing else. |
| Focus ring | 2 px solid `--accent`, 2 px offset, `:focus-visible` only. Same on every control. |
| Selection outline on canvas | 2 px accent; hover 1 px accent |
| Menu shadow | one: 0 4px 16px at 18% black. No other shadows in the chrome. |
| Motion | 120 ms ease-out for hover, press, focus fills; 180 ms ease-out for panel collapse and menu appearance; 0 for canvas drag feedback. With `prefers-reduced-motion`, all go to 0. |
| Colour roles | `--bg`, `--panel`, `--line`, `--ink`, `--ink-muted`, `--hover`, `--accent`, `--accent-soft`, `--danger`. Light and dark. Contrast: text at least 4.5:1, outlines at least 3:1. |
| Panel widths | left 200-400 (240 default); right 240-480 (280 default) |

**Rules.**
1. Chrome CSS uses only these tokens as CSS custom properties. A lint check rejects raw px values outside the scale and raw hex colours.
2. Every interactive control has the five states of section 1 and the same focus ring.
3. Disabled never means invisible, except menu items that can never apply (section 8 rule 4).
4. Cursor changes follow section 2 rule 3.

---

## Open items

Settled by the lead (2026-11-13), to be confirmed by David on the running app:
1. Tool lock: tools always return to Select after one use. A lock comes later if wanted.
2. Escape backs out one step at a time, including up one level, before it clears the selection.
3. Text on empty canvas creates a frame around it (plan, approved).
4. A frame's canvas position stays in napkin's layout state, as card positions do now. It is not written into the HTML file. It travels with the folder only when the person asks (INTENT).
5. Hide on a layer is view-only. It does not edit the file.
6. Create component runs at once with an automatic name, then the name is editable in place. The file goes in `components/` beside the frame's file unless the folder already has a components folder.

Still open: none that block the first passes.

## Sources reached

- Figma Frames: https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
- Figma Select layers: https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects
- Figma Navigate the UI: https://help.figma.com/hc/en-us/articles/360039831974-Navigate-the-UI-in-Figma-Design
- Figma UI3 design blog: https://www.figma.com/blog/our-approach-to-designing-ui3/
- Figma Design tab: https://help.figma.com/hc/en-us/articles/360039832014-Design-tab-properties-panel
- Figma Create components: https://help.figma.com/hc/en-us/articles/360038663154
- Figma Instances: https://help.figma.com/hc/en-us/articles/360039150173-Create-and-insert-component-instances
- Figma Text properties: https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties
- tldraw Tools: https://tldraw.dev/sdk-features/tools
- tldraw Text shape: https://tldraw.dev/sdk-features/text-shape
- tldraw Frame shape: https://tldraw.dev/sdk-features/frame-shape
- tldraw Selection: https://tldraw.dev/sdk-features/selection
- tldraw Accessibility: https://tldraw.dev/sdk-features/accessibility
- tldraw UI components: https://tldraw.dev/sdk-features/ui-components
- Paper docs index: https://www.paper.design/docs

Not reached or empty on the point: Figma keyboard-shortcut page (returned a plan table), Figma Layers panel article (thin), tldraw context-menu and keyboard-shortcut pages (404), Figma UI3 help article (404), all Paper canvas behaviour.

## Amendments after pass 1 (2026-11-13)

These replace anything above that disagrees.
1. Top bar right group, left to right: people (presence circles), Jump to…, theme. Right-aligned and flush to the bar padding, with the same 4 px gap as the tool group. People are leftmost so that more of them grow into free space; beyond five, a "+N" chip (David).
2. Top bar left group: glyph, folder name, panel toggle, with the same tight gap, in both panel states (David).
3. The left panel collapses with the top-bar toggle or Ctrl+\. No edge handle, no collapse animation; the picture on the canvas stays still.
4. Key labels follow the platform through one helper (`public/canvas/keylabel.js`): Ctrl K on Linux and Windows, the Command sign on macOS.
5. Chrome colours are written once with `light-dark()`; chrome tokens are the `--nk-` set in `public/canvas/canvas.css`.
