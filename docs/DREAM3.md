# DREAM 3: the shared surface for all agentic work

Locked 2026-11-12 from David's direction (decision 0017). Builders never edit this file, `bench/`, `bench/corpus3/` or any test they did not write this round. Only the lead changes it, and only upward.

## North star
napkin is the place where a person and any number of agents do long work together and look at it together. Anything an agent can make (UI, images, video, audio, animation, datasets, charts, documents, 3D, generation workflows, its own plans and logs) lands on one canvas as a real file, organizes itself, and can be driven from the keyboard. Selecting anything hands you the instrument panel for that exact thing, and every instrument opens from a one-row dial into a full studio. Agents hold the same instruments through one protocol. ComfyUI is the generative engine behind it.

The floor (must clearly beat, each on its own ground): Paper and Figma (shared design canvas), tldraw (canvas feel), Storybook (component review), Tweakpane / Leva / lil-gui / dat.gui / DialKit (control panels), Theatre.js and Motion (animation tooling), the ComfyUI web UI (generation), and Claude artifacts / Cursor canvas (agent presentation). The dream is what those teams would ship together in five years. "As good as X" is a fail.

## What stays true (from INTENT)
Files on disk are the source of truth. napkin renders what it loads as it is and writes edits back into real files. Nothing is imposed on a folder that only gets looked at. Local first. Every existing bench (`bench/fidelity.js`, `bench/edits.js`, `bench/imposed.js`) and test stays green.

## Dimensions, marks and measures

### D1 Any media (evidence: `bench/kinds.js` on `bench/corpus3/`, screenshots)
- **Dream:** 40+ kinds open as first-class items with a purpose-built viewer, never a generic icon: html, tsx/jsx, css, svg, png/jpg/webp/avif/gif/apng, mp4/webm/mov, wav/mp3/flac/ogg, lottie json, css/waapi animation, csv/tsv/json/jsonl/parquet/sqlite/arrow, vega-lite and plain-data charts, md/txt/code (any language)/diff/patch/ipynb/pdf, glb/gltf/obj, woff2/ttf/otf, ComfyUI workflow json, agent run logs, zip (browsable), unknown binary (hex + strings, still useful). Each viewer shows the thing live at canvas scale (video scrubs on hover, audio shows a waveform, data shows a typed table with distributions per column, a font shows a specimen, a model turns).
- **Beat-the-best:** 25 kinds.
- measure: for every corpus file, `/api/items` lists it with the right `kind`; `/view/<id>` renders non-blank, kind-specific content (bench asserts DOM markers plus pixel variance); first paint p95 < 150 ms per item; a 1,000-item mixed folder opens in < 2 s and pans/zooms at p95 frame < 16.7 ms with no blank cards after 300 ms at rest; a 2 GB video and a 5 M-row parquet open without loading whole into memory.

### D2 Instruments (evidence: `bench/controls3.js`, screenshots at three depths, rubric)
- **Dream:** selection decides the panel. Every kind exposes sections, and every section has three depths: **dial** (one 32 px row, scrub the label), **bench** (the section opened: all related controls with live figures), **studio** (the section takes over a large pane: for color, a full perceptual picker with OKLCH planes, gamut and contrast maps, palette and ramp generators, harmony, image-sampled palettes, token binding, history; for type, an axis-aware specimen lab; for motion, a curve and spring editor with a live ghost; for data, an encoding shelf; for image, levels/curves/crop/mask; for generation, the whole sampler). Every control has a tiny live figure that shows what the value does (tasty_tunez is the reference), a modified dot, reset, fine/coarse scrub, typed entry with units and math, and copy/paste of values. A person never meets a bare number box. Controls are declared by one JSON schema ("dials schema") so agents and plugins add instruments without writing UI.
- **Beat-the-best:** 12 control types at three depths, color and motion studios, schema-driven panels for 10 kinds.
- measure: `/api/controls/<id>` returns ≥ 1 section for every corpus item; every control is keyboard-operable (bench drives each by keys only); each `POST /api/control` yields a real change (file bytes, or a recipe stored beside the file when the format cannot hold it, decision recorded) and undo restores bytes exactly; panel swaps on selection in < 50 ms; scrub-to-pixel latency p95 < 16.7 ms; blind rubric ≥ 8/10 against Tweakpane, Leva and DialKit screenshots.

### D3 Keyboard (evidence: `bench/keys3.js` journeys, the `?` map)
- **Dream:** the mouse is optional for everything. Spatial focus (arrows walk the canvas by geometry), a palette (Ctrl K) that searches items, controls, commands and agent actions with previews, mnemonic leader keys, numeric entry while scrubbing, vim-style counts, a `?` map generated from the real bindings, rebindable. Every pointer gesture has a key path of no more than twice the pointer's steps.
- **Beat-the-best:** 100% of commands reachable by keys; the 12 journeys below pass keys-only.
- measure: `bench/keys3.js` runs 12 scripted journeys with no pointer events (open folder → find item → group → tune a color to a target value → compare variants → approve an agent proposal → generate → arrange → present), each within its keystroke budget; focus is always visible (screenshot diff); axe: 0 violations.

### D4 Organization (evidence: `bench/board.js`, screenshots, film of transitions)
- **Dream:** a folder of 1,000 mixed files arrives already sensible: grouped by what it is, by run, by time, by similarity (visual and semantic), with named sections you can re-cut in one keystroke (by kind, folder, agent run, tag, date, status, any metadata or data column), stacks that fan out, pinned manual layouts that survive re-sorting, saved views, and animated transitions that keep your eye on each item as it moves. Any grouping the person can describe is one command or one sentence to an agent. Layout state never dirties a folder unless the person asks for it to travel with the folder.
- **Beat-the-best:** 6 arrange modes, nested groups, saved views, manual pins, 1,000 items.
- measure: `/api/board` round-trips groups and arrangement; each arrange mode is deterministic (same input, same layout); re-arranging 1,000 items animates at p95 frame < 16.7 ms; `git status` of the folder stays clean after organizing.

### D5 Agents (evidence: `bench/agents3.js` scripted over MCP only, a real Codex and a real opencode run)
- **Dream:** any harness (Claude Code, Codex, opencode, a raw script) connects in one line and gets the whole surface: read what the person sees and has selected, place and group work, hold every instrument the person holds, propose instead of write, ask a question that appears on the canvas and wait for the answer. Long-horizon work is a first-class **run**: a plan with steps, live status, artifacts landing in the run's section as they are made, a review queue the person clears from the keyboard (approve, reject, comment, send back), checkpoints and resume after a restart. Several agents at once, each with a visible presence and an audit trail. Zero dropped or clobbered edits.
- **Beat-the-best:** the 30-step scripted run passes; two real harnesses complete the proving task unaided from the README line.
- measure: `bench/agents3.js` (MCP only): start a run, place 12 artifacts of 6 kinds, group, tune 5 controls, raise 3 proposals and 1 question, read the person's answers, resume after a server restart; event latency p95 < 100 ms; 0 lost edits under 4 concurrent writers.

### D6 Generation (evidence: `bench/gen.js` on a mock ComfyUI, one real GPU smoke through the shared lock)
- **Dream:** a ComfyUI workflow json is an item; its inputs become instruments automatically with sensible figures; Generate lands a placeholder with stage-by-stage progress and then the result, which keeps its exact settings and seed so any output can be reopened, varied, swept (a grid over any two parameters) or handed to an agent. Images, video, audio and 3D all flow through the same path. Works with whatever models the person's ComfyUI has; never assumes a model.
- **Beat-the-best:** workflow → instruments → queued → result with provenance → variation grid, on the mock and once for real.
- measure: `bench/gen.js` asserts the above against a mock ComfyUI server (queue, progress websocket, outputs); provenance round-trips (reopen → identical request).

### D7 Motion and time (evidence: screenshots, `bench/motion.js`)
- **Dream:** any animated item has a timeline: scrub, loop a range, keyframes for CSS/WAAPI/SVG and for instrument values, an easing and spring editor with a ghost trail, and edits written back as real CSS or code. The interface itself moves with the same craft (interruptible, under 200 ms, reduced-motion honoured).
- measure: timeline scrub latency p95 < 16.7 ms; a keyframe edit round-trips to the file and back; reduced-motion disables non-essential motion.

### D8 Craft (evidence: screenshots, blind rubric, slop audit, perf traces)
- **Dream:** a designer screenshots it unprompted. Dense, calm, legible; every tool explains itself by drawing what it does; nothing looks generated. Light and dark. Cold start < 1 s.
- measure: blind rubric ≥ 8/10 from two fresh critics against the floor products' screenshots; slop audit 0 tells; axe 0 violations.

## The contract the measures use (black box over HTTP; additive to the DREAM 2 contract)
- `GET /api/items` → `{ items: [{ id, path, kind, mime, bytes, meta }] }` for every file in the folder (skip list unchanged).
- `GET /view/<id>` renders one item alone, no chrome, with `data-napkin-kind="<kind>"` on the root.
- `GET /api/controls/<id>` → `{ revision, sections: [{ id, label, controls: [{ id, type, label, value, depth: 1|2|3, min?, max?, step?, unit?, options?, figure? }] }] }` (the dials schema; `type` is open-ended, additive).
- `POST /api/control { item, control, value, baseRevision }` → `{ ok, revision }`; `POST /api/undo { item }`.
- `GET|POST /api/board` → `{ arrange: { by }, groups: [{ id, name, items, groups?, pinned? }], views: [...] }`.
- Runs: `POST /api/runs`, `POST /api/runs/<id>/steps`, `POST /api/runs/<id>/artifacts`, `POST /api/questions`, `GET /api/events` (SSE or WS); MCP tools mirror every route.
- Generation: `POST /api/generate { workflow, inputs }` → `{ job }`; progress on the event stream; `NAPKIN_COMFY_URL` selects the backend.

## Pass rule
A piece passes at rubric ≥ 8/10 from a fresh critic with every measure for its dimension met and no other dimension regressed. Beat-the-best is a milestone; the loop keeps going toward the dream.

## Contract addendum (lead, 2026-11-12, after measures round 4)
The builder-facing contract table in `bench/README.md` is part of this contract: the DOM hooks the benches look for, the palette command phrases, the extra `/api/board` fields and the keyframe record shape. In brief:
- Hooks: every card carries `data-item-id`; the panel is `[data-controls-for=<item id>]`; each control row carries `data-control-id`; a studio is `[data-studio-for=<control id>]`; also `[data-modified]`, `[data-proposal-id]`, `[data-variant]`, `[data-group-id]`, `[data-presenting]`. The palette and key map are `[role=dialog]` with `[role=option]` entries.
- Palette: typing a command's exact phrase and pressing Enter runs it; exact and prefix matches rank above fuzzy ones. Commands: `Select <path>`, `Control <label>`, `Dial|Bench|Studio <label>`, `Reset <label>`, `Arrange by <kind|folder|date|similarity|tag|status|run|meta.<column>>`, `Present`, `Compare variants`, `Approve`, `Reject`, `Generate`, `Open folder`, `Group`, `Rebind <command> to <keys>`.
- `GET /api/board` also returns `selection: [id]`, `compare: { item, variants }`, `presentation: boolean`.
- Cards show the item's own content; every control row shows a live figure that changes with the value; a keyframe value is an array of at least two frame records that include `transform`, written back as live code.
- Judged gates (blind rubric, slop audit, real-harness runs, GPU smoke) are signed by the lead; the bench holds only the public key.
Where the README table and this file disagree, this file wins and the lead fixes the README.
