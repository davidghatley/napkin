# 0021: agents lane: runs, review and the shared surface

Status: proposed (D3 round 1, agents lane)

## Context
DREAM 3 D5: any harness connects in one line and gets runs, steps, artifacts, proposals, questions, presence, an event
stream and the same instruments the person holds. napkin already had an MCP server for components, presence and component
proposals (`src/api.js`).

## Decisions
1. **A separate store for runs and file proposals** (`src/agents/store.js`), not an extension of `api.proposals`. The
   existing proposals hold edits against a component revision; run proposals hold a whole file or an instrument change and
   belong to a run. The two share the vocabulary (accept, reject, resolved event) and the identity and permission checks.
   Both trays exist; unifying them is a later change.
2. **State outside the folder.** Runs, the event log, held proposal bytes, the board and agent cursors live under the
   state directory (`NAPKIN_STATE_DIR`, hashed by folder). Only artifacts and approved files are written into the folder.
3. **One durable event log is also the audit trail.** Every write has `seq`, `at`, `by`. Agents read it with a per-name
   cursor (`read_events`); the canvas gets the same events on `/api/events` and can replay with `?since=`.
4. **Nobody reviews their own work**, enforced by the server by caller name.
5. **No silent overwrite.** A different file at an artifact path is a 409 unless `overwrite`; an approved proposal for a
   file that changed since is a 409 and stays open. Control edits and the board use revisions.
6. **`/api/board` lives here for now** (`src/agents/board.js`): the bench's `get_board` and `set_board` need a route and no
   other lane owns one yet. It stores groups, arrangement and views, and holds the person's selection and viewport (reported
   by the canvas, not persisted). Whoever owns D4 can replace it; the MCP tools only forward.
7. **No new dependencies.**

## Consequences
- The shared files touched: `src/server.js` (mount), `src/mcp.js` (tool list), `public/canvas/main.js` (one import, one
  call, one frame branch), `public/canvas/actions.js` (two actions and one handler count), `src/cli.js` (harness lines).
- Existing tests that listed the exact MCP tool set now filter out the shared-surface tools, which have their own test.
