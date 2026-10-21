# FEATURES: napkin

Extracted 2026-10-18 from [docs/guide/](docs/guide/README.md), which turns the final landing copy (`site/copy.md`) into workflows. INTENT.md wins every disagreement. Open questions are in [docs/guide/GAPS.md](docs/guide/GAPS.md).

**Status: Phase 4 started 2026-10-20 (David).** The **First build** list at the bottom is in progress. The **Build first** spike (2026-10-18) is done. File format: React TSX, decision 0003 (G1); variants: base + overrides (G3).

Proving demo (INTENT): *an agent and David edit the same component live on the canvas, and the result is a real, reusable component file.*

Priorities: **P0** the proving demo can't happen without it. **P1** a major benefit. **P2** nice to have. Benefits: **T** Work on it together, **V** Change every version at once, **F** Keep plain files you own.

## Feature table

| ID | Feature | Workflow · benefit | User-visible acceptance check | Size | Depends on | Priority |
|---|---|---|---|---|---|---|
| F01 | Component file on disk is the source of truth, written in a stable order | keep-your-files · F | Open and save a component with no edits: the file is byte-identical. Change one property: `git diff` shows one changed line. | M | none | P0 |
| F02 | One edit path for every writer: batches of set / insert / delete / move, validated, all-or-nothing | edit-together, keep-your-files · T, F | A batch with one invalid edit leaves the file and canvas unchanged and returns an error naming the edit. | M | F01 | P0 |
| F03 | Revisions: each edit carries a base revision; stale edits are rejected; edits to different properties at the same moment both land | edit-together · T | You set the title weight while the agent adds a version from the same revision: both are in the file. An edit against an old revision returns `stale revision`. | S | F02 | P0 |
| F04 | Canvas renders the component file as real HTML/CSS in the browser | all · T | `napkin open` shows the component, and it matches the same markup opened as a plain page. | M | F01 | P0 |
| F05 | Hand edit of a property from the canvas side panel, through F02 | edit-together · T | Change Padding in the panel: the canvas and the file both show the new value. | M | F02, F04 | P0 |
| F06 | MCP server (`napkin mcp`) with `list_components`, `read_component`, `apply_edits` | connect-your-agent, edit-together · T | An MCP agent asked to "list napkin components" gets the list; asked to change a property, the file changes. | M | F02 | P0 |
| F07 | Live sync: file watcher plus push to canvas and change notices to agents | edit-together, keep-your-files · T, F | An agent edit appears on the canvas without reload; a canvas edit reaches the agent as a notice with the new revision; `git restore` shows on the canvas within a second. | M | F01, F04, F06 | P0 |
| F08 | `napkin init` / `napkin open` and `napkin.json` | quickstart, connect-your-agent · T | In a fresh repo, `napkin init` then `napkin open` prints the canvas address and the agent command. | S | F04, F06 | P0 |
| F09 | Stable component IDs, separate from names (salvage INV-08) | connect-your-agent · F | Rename Button to PrimaryButton: `list_components` shows the same ID. | S | F01 | P1 |
| F10 | Tokens: read the token file, show token names in the panel, `list_tokens`, mark off-token values | start-a-component · T, V | Padding shows `space-4`, not `16px`; a hard-coded colour shows an orange dot. | M | F01, F05, F06 | P1 |
| F11 | `create_component` for agents | start-a-component · T | "Make a napkin Card ..." creates `components/Card.*` and it appears on the canvas. | M | F06, F07 | P1 |
| F12 | Draw a new component on the canvas (New component, box, text, image slot) | start-a-component · T | Press N, name it Card, draw a box and text: the file exists and reopens identically. | L | F05 | P1 |
| F13 | Settings (props): "Make setting" on canvas, settings in `read_component` | start-a-component · V | Make the title a setting: it shows in the panel and in `read_component`. | M | F05 | P1 |
| F14 | Versions grid with a base and per-version overrides, plus Reset to base | change-every-version · V | Change the base radius on a 9-version Button: all 9 update and `git diff` shows one line; an overridden version keeps its value and shows a dot. | L | F05, F13 | P1 |
| F15 | Add a version (+ Size, + State, or by agent) | change-every-version · V | "Add an xl size" adds a column to the grid and one block to the file. | M | F14 | P1 |
| F16 | Presence label showing what the agent is editing | edit-together · T | While the agent works, the canvas shows "agent: editing Card / compact"; it clears when done. | S | F07 | P1 |
| F17 | Same-property clash rule | edit-together · T | Defined once G2 is answered. | M | F03 | P1 (blocked on G2) |
| F18 | Open components that already exist in a repo | start-a-component · F | Defined once G4 is answered. | L | F01, G1 | P2 (blocked on G4) |
| F19 | `dry_run` on `apply_edits` | connect-your-agent · T | A dry run returns the result and leaves the file unchanged. | S | F02 | P2 |
| F20 | HTTP API mirroring the MCP tools | connect-your-agent · T | `curl localhost:4810/api/components` returns the component list. | S | F02 | P2 |
| F21 | "agent connected" status in the canvas | connect-your-agent · T | Starting the agent shows "agent connected"; stopping it clears it. | S | F06, F07 | P2 |
| F22 | Survive a broken hand edit: keep the last good version and show the error line | keep-your-files · F | Save a file with a syntax error: the canvas keeps the old Card and names the line. | S | F07 | P2 |
| F23 | Reload cleanly on git branch switch | keep-your-files · F | Switch branches: every changed component reloads; in-flight edits get `stale revision`. | S | F03, F07 | P2 |
| F24 | In-app undo and per-edit attribution | edit-together, keep-your-files · T, F | Defined once G5 is answered. | M | F02 | P2 (blocked on G5) |
| F25 | Agent permissions | connect-your-agent · T | Defined once G6 is answered. | M | F06 | P2 (blocked on G6) |

## Build first: the co-editing spike

A small, throwaway-friendly spike that tests the one risky idea: **a person on a canvas and an agent over MCP edit the same component file live, and both edits survive in the file.** It runs on this machine, CPU only, on localhost, with a single hard-coded Card fixture. It doesn't settle the file format (G1): the spike picks a simple format and records it as a *proposed* decision in `docs/decisions/` before building.

Out of the spike on purpose: tokens, versions, drawing tools, `create_component`, presence, install. If the spike can't keep both edits, napkin's core idea needs rethinking before Phase 4.

| # | Features | What it proves | Test |
|---|---|---|---|
| 1 | F01 | The file can be the source of truth without noisy diffs | Load `fixtures/Card` and save with no edits: byte-identical. Set `padding` once: `git diff --numstat` reports 1 line added and 1 removed. |
| 2 | F02 + F03 | One safe edit path for both writers | Unit tests, rebuilt from the salvage test ideas: a rejected batch makes no change to the file; an edit against an old revision returns `stale revision`; two edits to different properties from the same revision both land. |
| 3 | F06 | An agent can read and edit through MCP | A scripted MCP client over stdio calls `read_component` then `apply_edits` (set title weight); the file on disk has the new value. |
| 4 | F07 | Changes flow both ways live | An edit written by the MCP client reaches a connected canvas socket in under 1 second; an edit sent from the canvas socket reaches the MCP client as a change notice with the new revision. |
| 5 | F04 + F05 | The proving demo, as one end-to-end test | Headless Chromium (CPU) opens the canvas and changes Padding in the panel while the scripted agent sets the title weight to 600. Afterwards the canvas shows both changes and the Card file contains both. Save the screenshot and terminal log to `docs/demo/`. |

## First build (Phase 4, from 2026-10-20)

Plan: approved by David 2026-10-20 (plan artifact "napkin First Build"). Each milestone ends with green tests and a commit.

| M | Features | Done when |
|---|---|---|
| M0 | decision 0003, INTENT, this list | written and committed |
| M1 | F01, F02, F03, F09 on TSX | `.tsx` load+save with no edits is byte-identical; one property change is a one-line diff; out-of-dialect files are read-only; a 200-edit fuzz keeps the file parseable and in the dialect |
| M2 | F04, F07, F22, F23 | the canvas renders the real component (esbuild + React) for every variant; file changes and `git restore` show without reload |
| M3 | F05, F13, F14, F15 | change the base on a 3×2 Button: all 6 update, one diff line; an override keeps its value and shows a dot; Reset to base removes it |
| M4 | F11 (canvas side), F12 | headless Chromium draws a Card from nothing (N, F, T, I) and the file reopens identically |
| M5 | F06, F11, F16, F19, F21 | the proving demo: David and an agent edit a Button at once (base radius + icon slot / `xl` size), both land, `examples/consumer-app` imports and renders every variant |

Out of this build: tokens panel (F10), opening other repos' components (F18), same-property clash rule beyond `stale revision` (F17), in-app undo (F24), agent permissions (F25), hosting.
