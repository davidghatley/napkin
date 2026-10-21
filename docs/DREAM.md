# DREAM: napkin

The plain-text copy of the approved dream. The visual version, with scenes and figures, is the review page (docs/dream/dream.html, published privately as "napkin Dream"). Drafted by Claude 2026-10-21; approved by David 2026-10-21 (every criterion kept; N1-N8 yes; chapter "never be" removed at his request).

## How a criterion passes
Each row names its **evidence** and its **bar**: a number the critic measures itself, a blind comparison against a named public reference (win or tie), a test, or a walk (a fresh agent runs the scene). A critic in a fresh context, who never sees the builder's reasoning, gives the verdict. Unverifiable is not pass.

Every criterion also keeps the six invariants (INV-01..06): files are the truth; a no-op save is byte-identical; small edits give small diffs; out-of-dialect files open read-only and are never rewritten; one commit path with revisions and stale rejection; components have no runtime dependency on napkin.

## Scenes
- **S1 Open 40:** `napkin open` on a 40-component repo; ⌘K to Badge; drag the base radius; all cells follow; git diff shows one line.
- **S2 Agent beside me:** an agent builds a Tooltip in propose mode while you tune Button; presence shows where it works; accept 3 of 4 proposals; the rejected one never touched the file.
- **S3 Napkin to app:** draw a Card with auto layout, make the title a setting, drop in a Button instance, copy usage into an app: pixel-identical.
- **S4 A bad morning:** a broken hand edit keeps the last good render and names the line; a branch switch reloads everything; the agent's in-flight edit is stale and retries; ⌘Z undoes only your edit.
- **S5 Tokens day:** token names in the panel, off-token dots, theme switch across every cell.

## INV: Invariants

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| INV-01 | Files are the truth: after a kill at any moment and a restart, the canvas shows exactly what is on disk. Only the sidecar (id, position) and in-memory revisions live elsewhere. | test/invariants/truth.test.js | 100/100 random kill points | test |
| INV-02 | Open and save with no change gives the same bytes, for every fixture and a 40-component corpus. | test/invariants/noop.test.js · sha256 before/after | 40/40 identical | test |
| INV-03 | Every edit type stays within its diff budget (Fig. 4.12). | 200-op fuzz · git diff --numstat per op | 0 ops over budget | num |
| INV-04 | Out-of-dialect files open read-only with the reason and line, and every write path refuses them. | 50-file out-of-dialect corpus · every tool tried | sha256 unchanged 50/50 | test |
| INV-05 | One commit path: panel, tools, MCP, HTTP, undo and accepting a proposal all write through `store.apply`, with revisions and stale rejection. | fs-write spy in test/invariants/one-path.test.js | 0 component writes outside apply | test |
| INV-06 | Components need nothing from napkin at run time. | examples/consumer-app build · grep imports · tsc --strict | 0 napkin imports; build + typecheck pass | test |

## CAN: Canvas & navigation

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| CAN-01 | Pan (space-drag, wheel, trackpad) and zoom to the cursor (⌘/Ctrl-wheel, pinch, + / −) from 5% to 800%. `⇧1` fits all, `⇧2` fits the selection. | test/canvas/nav.test.js (CDP input) | point under cursor drifts ≤ 1 px per step; every binding works | test |
| CAN-02 | Each component is a frame you can drag on the canvas. Its position is saved in the sidecar only. | test + git diff after a drag | .tsx byte-identical; sidecar ≤ 2 lines | test |
| CAN-03 | Quick open (`⌘K`): fuzzy search over components, nodes and actions, then Enter flies there. | timing on bench/corpus-200 | results < 50 ms p95; flight ≤ 300 ms (none with reduced motion) | num |
| CAN-04 | A layers tree mirrors the JSX. Selection syncs both ways; rename and drag-reorder are one edit each. | screenshot pair, blind | wins or ties Figma's layers panel | blind |
| CAN-05 | Multi-select (shift-click, marquee). The panel shows mixed values; one change is one batch. | test: revision count | 1 revision per multi-edit | test |
| CAN-06 | The variant grid is a matrix: one axis across, one down, a third as groups, with axis headers. | screenshot pair, blind; 4×4×4 fixture | wins or ties Figma's variant set; every caption legible at fit | blind |
| CAN-07 | Hold `Alt` to measure the distance between the selection and the hovered node. | test vs getBoundingClientRect | within 0.5 px | test |
| CAN-08 | Focus a component (Enter) and come back (Esc). The view deep-links (#Button/label) and a reload restores it. | test/canvas/focus.test.js | view restored after reload | test |

## LAY: Drawing & layout

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| LAY-01 | Auto layout: direction, gap, padding (linked or per side), the 3×3 alignment matrix and wrap, written as flexbox. | screenshot pair, blind · diff per control | wins or ties Figma auto layout and Framer stacks; 1 line per control | blind |
| LAY-02 | Hug / Fill / Fixed per child, plus min/max, written as width:auto / flex:1 / px. | 12-case render matrix test | 12/12 render to the expected size | test |
| LAY-03 | Grid: columns, rows and gap in fr/px. Dragging a child into a cell sets gridColumn/gridRow. | test + diff | 1 line per placement | test |
| LAY-04 | Absolute children with pins (left/right/top/bottom/centre) written as inset CSS. They behave like Figma constraints when the parent resizes. | 8-case constraint test | 8/8 | test |
| LAY-05 | Direct manipulation: resize handles, on-canvas padding and gap handles, drag-reorder with an insertion line. | CDP trace during drags · revision count | 1 revision per gesture; p95 frame ≤ 16.7 ms | num |
| LAY-06 | Smart guides and snapping to siblings, parent edges and a 4/8 px grid; `⇧` constrains. | test/canvas/snap.test.js | snaps within 4 screen px | test |
| LAY-07 | Type controls: font from the repo, size, weight, line height, tracking, alignment, colour; inline editing that works with IME. | screenshot pair, blind · IME test | wins or ties Figma's text section | blind |
| LAY-08 | Fill, border, per-corner radius, shadow, opacity, with a colour picker (hex, rgb, oklch) and eyedropper. Values are written in the format the file already uses. | screenshot pair, blind · format test | wins or ties Figma fill & effects | blind |
| LAY-09 | Wrap in frame (`⌘⌥G`), unwrap, duplicate (`⌘D`), copy and paste nodes between components with fresh ids. | pixel diff of pasted subtree | 0 px difference | test |
| LAY-10 | Paste in: SVG or PNG from the clipboard becomes an image; an HTML snippet becomes dialect nodes if it fits, otherwise it's refused with the reason. | 10-snippet corpus | fits converted, others refused, 0 approximations | test |
| LAY-11 | Drag a cell's width to watch it reflow. Preview widths live in the sidecar. | test + sha | .tsx unchanged | test |

## CMP: Components

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| CMP-01 | Props editor: add, remove, rename and reorder string, boolean and enum props, with defaults and descriptions (JSDoc). A rename updates every reference in one edit. | screenshot pair, blind · rename diff | wins or ties Storybook Controls; rename = 1 revision | blind |
| CMP-02 | Variant axes: add an axis; add, rename, reorder or remove values. A rename changes only the lines that name the value. | test + diff | 0 unrelated lines | test |
| CMP-03 | Each property shows where its value comes from (base or axis=value), with an override dot, Reset, and Move to base. | screenshot pair, blind | wins or ties Figma's override display | blind |
| CMP-04 | Boolean props show or hide a node (`{icon && …}`). | test + consumer app | renders both states in the app | test (dialect 0004) |
| CMP-05 | Slots: `children` and named ReactNode props appear as drop zones. Preview content lives in the sidecar. | test + sha | .tsx has no preview content | test (dialect 0004) |
| CMP-06 | Composition: a component renders another by import. The nested instance is selectable and its props edit as JSX attributes. | timing on Card ⊃ Button · diff | a Button base edit shows in every Card < 100 ms; 1 line in Button.tsx only | num (dialect 0004) |
| CMP-07 | Swap an instance (Button → IconButton) and keep the props both share. | test | matching props kept | test (dialect 0004) |
| CMP-08 | Extract component: select a subtree, and get a new file plus an instance in its place. | consumer-app pixel diff before/after | 0 px difference | test (dialect 0004) |
| CMP-09 | Play mode (`P`): cells become live React you can click and type into, without leaving the canvas. | timing | toggle < 100 ms | num |
| CMP-10 | Large matrices (4×4×4 = 64 cells) collapse and filter by axis value. | critic task | any cell reached in ≤ 2 actions | walk |

## TOK: Tokens & themes

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| TOK-01 | Read tokens from a configured file (secret-sauce tokens.json or CSS custom properties). `list_tokens` over MCP. | test | every token listed with value and mode | test |
| TOK-02 | Bind a property to a token: it writes `var(--space-4)` and the panel shows `space-4`. | diff · consumer app | 1 line; app renders with plain CSS vars | test |
| TOK-03 | Off-token values get an orange dot and a "snap to nearest token" action. | screenshot + test | 100% of off-token values flagged | test |
| TOK-04 | A theme switch previews every cell in each token mode. | timing at 200 components | switch < 300 ms | num |
| TOK-05 | Edit a token's value: the token file changes by one line, and every bound cell updates. | diff · timing | 1 line; < 100 ms | num |

## OPN: Open existing repos

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| OPN-01 | `napkin open <repo>` classifies every .tsx as editable or read-only with the reason, and prints a report. | report on a pinned repo | every file classified, 0 files written | test |
| OPN-02 | Read-only components still render on the canvas with their default props. | screenshot | renders or names the build error | test |
| OPN-03 | Adopt into the dialect: an agent proposes a rewrite as a diff you review. It is never applied silently. | proposal flow test | sha unchanged until Accept | test |
| OPN-04 | Coverage on shadcn/ui at a pinned commit: the share of components that open editable. | report | bar set by you | num |

## AGT: Agents

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| AGT-01 | The MCP surface is complete: list, read, apply (dryRun, propose), add_variant, create, rename, delete, render, search and subscribe, each with a schema and a contract test. | test/mcp/*.test.js · MCP inspector | every tool tested and listed | test |
| AGT-02 | `render_component` returns a PNG of any cell, so agents can see. | timing · pixel compare to canvas | < 500 ms p95; matches the canvas cell | num |
| AGT-03 | Presence: each agent has a colour, a name and an outline on the node it's editing. Two agents at once are told apart. It clears when they're done. | screenshot pair, blind · timing | wins or ties Figma cursors; clears ≤ 1 s | blind |
| AGT-04 | Review mode: proposals show as ghost before/after cells. Accept or reject each one, or all. Accept goes through apply; reject leaves the file untouched. | test/agents/propose.test.js · critic walk | reject → sha unchanged; critic wowed | walk |
| AGT-05 | Attribution: every revision records who made it (you, an agent's name, file, git). | test | 100% of revisions attributed | test |
| AGT-06 | A stale error lists the changed keys and their current values, so an agent can retry once and succeed. | scripted agent, 100 races | 100/100 recover in 1 retry | num |
| AGT-07 | Agents learn the dialect from napkin itself: the MCP serves a guide as a resource and a prompt. | agent eval: fresh Sonnet, only the MCP, 10 tasks | ≥ 8/10 tasks done | num |
| AGT-08 | MCP works with no canvas running: it falls back to its own store with a single-writer lock (0002's noted fallback). | test | edits land; a canvas started later shows them | test |
| AGT-09 | Activity feed: a live list of agent actions. Click one to focus its node. | screenshot + test | every apply listed ≤ 200 ms | test |
| AGT-10 | Same-property clash rule (G2). | test once defined | defined by you | test |
| AGT-11 | Agent permissions: read-only, propose-only or write, per agent (G6). | test once defined | defined by you | test |

## HIS: History & undo

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| HIS-01 | `⌘Z` / `⇧⌘Z` undo and redo your own edits as new, attributed revisions. They never undo an agent's. | test · diff | the reverse diff of the original | test |
| HIS-02 | Undo is refused, with who and when, if someone else changed the same property afterwards. | salvage test idea, rebuilt | refused 100% in the race test | test |
| HIS-03 | History panel: a timeline of revisions (who, what, when). Scrub to preview; Restore makes a new revision. | screenshot + test | restore = 1 revision | test |
| HIS-04 | Revisions are content hashes, so they survive a server restart (0002's note, borrowed from B). | test | a pre-restart revision commits if the file is unchanged | test |
| HIS-05 | Git awareness: a dot for components changed since HEAD, and a diff view. napkin never commits on its own. | test | 0 commits made by napkin | test |

## AST: Assets

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| AST-01 | Drop an image on an image slot: it's copied into the configured assets folder under a content-hash name, and src is set. | diff | 1 line + 1 new file | test |
| AST-02 | An asset browser lists the repo's images and SVGs, and you can drag them onto the canvas. | test | every asset listed | test |
| AST-03 | A missing asset shows a badge with the path. Nothing crashes. | test | badge shown; 0 errors | test |
| AST-04 | The same image dropped twice is stored once. | test | 1 file | test |

## INS: Inspect & handoff

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| INS-01 | Code strip: the live TSX beside the canvas, with the selected node's lines highlighted. Click a line to select its node. | timing · test | updates < 100 ms after any edit | num |
| INS-02 | Inspect: the computed CSS of a node in any cell, with where each value comes from. | test vs getComputedStyle | 100% match | test |
| INS-03 | Copy usage gives `<Button size="sm" label="Pay" />` for the cell; pasted into the consumer app, it renders that cell. | pixel diff | 0 px difference | test |
| INS-04 | `napkin docs` writes a local static catalog: props table, variant grid, usage lines. | screenshot pair, blind | wins or ties Storybook Autodocs | blind |
| INS-05 | Visual diff: before/after images of every cell, for the working tree against HEAD. | test | every changed cell shown, unchanged hidden | test |

## PRF: Performance

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| PRF-01 | Cold open of a 40-component repo until every cell is drawn. | CDP timing, 5 runs | ≤ 1.5 s p50 | num |
| PRF-02 | At 200 components (≥ 1,000 cells), a panel edit reaches the pixels quickly. | CDP: input → next paint | < 100 ms p95 | num |
| PRF-03 | At 200 components, an agent edit reaches the pixels quickly. (Today: 0.7 ms p50 to the socket, one Card.) | CDP + MCP client | < 100 ms p95 | num |
| PRF-04 | Panning and zooming at 200 components stays smooth. | CDP trace, scripted 5 s pan | p95 frame ≤ 16.7 ms | num |
| PRF-05 | Rebuild after an edit (esbuild, per component). | bundle.js timings | ≤ 50 ms p95 | num |
| PRF-06 | Edit cost stays flat over a long session. (Today: 0.03 ms after 2,000 edits, store only.) | bench | edit #2000 ≤ 2× edit #1 | num |
| PRF-07 | Memory at 200 components. | RSS · JS heap | server ≤ 500 MB, page ≤ 400 MB | num |
| PRF-08 | Typing into a panel field. | CDP input → paint | ≤ 50 ms p95 | num |

## FMT: File format & diffs

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| FMT-01 | docs/dialect.md lists every construct, each with a test. A reader can write a valid component from it alone. | critic writes one cold | opens editable on the first try | walk |
| FMT-02 | Every edit type has a diff budget (Fig. 4.12), checked per op. | table test | 0 over budget | test |
| FMT-03 | Files napkin creates or edits pass prettier (default config) in the regions it wrote, plus `tsc --strict` and eslint react rules. | CI script | 0 findings | test |
| FMT-04 | Git-merge friendly: two branches that change different properties merge without conflict. | 20 branch pairs | 20/20 clean merges | test |
| FMT-05 | A 2,000-edit fuzz keeps every file parseable, in the dialect, and round-tripping. (Today: 200.) | fuzz test | 2,000/2,000 | test |
| FMT-06 | The sidecar is minimal and stable: sorted keys, only id, position and preview data. | test | moving a component = sidecar diff only | test |
| FMT-07 | A hand edit in your editor while the canvas is open becomes a revision. No canvas edit is lost. | test | shows ≤ 1 s; 0 lost edits | num |

## ONB: Onboarding

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| ONB-01 | `napkin init` in an empty folder writes napkin.json and components/ with a starter, then prints the canvas address and a ready-to-paste .mcp.json snippet. | cold critic run, timed | first render ≤ 60 s from the README alone | walk |
| ONB-02 | The empty canvas teaches the first actions (N, F, T, I, ⌘K). | screenshot pair, blind | wins or ties Paper's new-file state | blind |
| ONB-03 | A shortcut sheet (`?`) and the command palette list every action. | audit script | 100% of actions listed | test |
| ONB-04 | Every error names the file, the line and what to do next. | audit of all error strings | 100% pass | num |
| ONB-05 | The README quickstart runs as written on a clean clone (`npm ci`). | cold critic run | 0 deviations | walk |

## REL: Reliability

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| REL-01 | Kill -9 during writes: the file holds either the old bytes or the new ones, never a partial write. | 200 trials | 200/200 whole | test |
| REL-02 | A second server on the same folder refuses to start, with a clear message. | test | refused, message names the PID | test |
| REL-03 | After a server restart the page reconnects. In-flight edits get stale, never silently lost. | test | reconnect ≤ 2 s; 0 silent losses | num |
| REL-04 | A 30-minute soak (canvas plus two scripted agents making random edits). | soak log | 0 errors; RSS growth ≤ 20%; files valid | num |
| REL-05 | A branch switch with 40 components reloads all of them. | timing | ≤ 2 s | num |

## FEEL: Look & feel

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| FEEL-01 | The whole canvas, with the same 6 components loaded, at 1440×900. | screenshot pair, blind | wins or ties Paper | blind |
| FEEL-02 | The design panel reads like a design tool: sections, human labels ("Corner radius", not `borderRadius`), scrubbable numbers, units. Today it's raw CSS fields (Fig. 3.1). | screenshot pair, blind | wins or ties Figma's design panel | blind |
| FEEL-03 | Light and dark chrome, both accessible. | axe-core (test-only dependency) | 0 serious or critical violations | test |
| FEEL-04 | Nothing jumps when an edit lands somewhere else, and the selection overlay keeps up. | CDP layout-shift · frame trace | CLS 0; overlay ≤ 1 frame behind | num |
| FEEL-05 | S1 can be done with the keyboard alone. | critic walk, no mouse | completed | walk |

## SCN: Scenes

| ID | Criterion | Evidence | Bar | Kind |
|---|---|---|---|---|
| SCN-1 | S1 · Open 40: find, tune, one line. | whole-product critic run + log | done cold; timings hold; diff = 1 line | walk |
| SCN-2 | S2 · The agent beside me: presence, proposals, accept 3 / reject 1. | whole-product critic run + log | done; rejected edit never in file | walk |
| SCN-3 | S3 · From napkin to app: draw, compose, import. | whole-product critic run + log | done; app pixel-identical | walk (dialect 0004) |
| SCN-4 | S4 · A bad morning: broken file, branch switch, undo. | whole-product critic run + log | done; 0 lost edits | walk |
| SCN-5 | S5 · Tokens day. | whole-product critic run + log | done | walk |

## Decided by David (was "Needs David")

- **N1 Tokens & themes (area 4.5)**: approved 2026-10-21. INTENT: "no token panel yet", but also "reads/writes … design tokens (from secret-sauce)". The dream wants token binding, off-token marks, theme preview and editing tokens in place.
- **N2 Opening existing repos' components (area 4.6)**: approved 2026-10-21. INTENT: "not (yet) a way to open arbitrary existing components". The dream wants classify, read-only render, and agent-assisted adopt as a reviewed diff.
- **N3 Widen the dialect: decision 0004**: approved 2026-10-21. 0003 (which you accepted) keeps the dialect narrow: no conditionals, maps or imports. Slots, booleans that hide nodes, and composition (Card uses Button) all need it widened. I'd draft 0004 as proposed for you to accept.
- **N4 Same-property clash rule (G2)**: approved 2026-10-21. Today the rule is "stale revision" and retry. Proposal: keep that, and show a clash chip with both values so you pick one.
- **N5 In-app undo (G5)**: approved 2026-10-21. The README says "use git". Proposal: ⌘Z undoes only your own edits, as a new attributed revision, refused on conflict (Fig. 4.8).
- **N6 Agent permissions (G6)**: approved 2026-10-21. Proposal: per-agent read-only, propose-only or write, set in napkin.json, with write as the default (as today).
- **N7 Outside services for the loop**: approved 2026-10-21. (a) Codex and free Opencode models get repo code: OK? Free models may keep prompts. (b) Paper and Figma need accounts for true same-way captures: use public imagery only (weaker bars), or will you provide captures or a login? (c) Run ccusage via npx with a pinned version?
- **N8 Hosting & multiplayer between people**: approved 2026-10-21. INTENT: local, one person and their agents. The dream never builds these. Listed so the loop doesn't wander. No answer needed unless you want to change INTENT.

N8 note: hosting and multiplayer between people are still not built; INTENT keeps "not hosted (for now)" until David says what his "yes" on N8 means.
