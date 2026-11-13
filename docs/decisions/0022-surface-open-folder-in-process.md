# 0022 surface: Open folder switches the running napkin to another folder

Status: accepted (surface lane, round 2)

## Context

DREAM 3 lists `Open folder` as a palette command and the keys bench uses it to open a second folder and come back,
on the same address, without restarting anything. Round 1 posted to `/api/folder`, which did not exist.

## Choice

`POST /api/folder { folder }` (routes in `src/surface/routes.js`) switches the one running process to another folder.

- `src/server.js` now builds the folder's session (lock, document engine, workspace, item registry, routes) in
  `openSession()`. `switchFolder()` opens and locks the new folder first, then closes the old one. A folder that is
  missing, is a file, has a broken `napkin.json` or is held by another napkin leaves the current folder open and answers
  with a plain error and a next step.
- The address, the event stream and agent presence stay. Bearer tokens (`POST /api/session`) are kept in one map that
  every session shares (`createApi` takes it as `sessions`), so a token issued before the switch is good after it.
- Board state (arrangement, groups, rebinds, kept colour palettes) is per folder, kept in napkin's state directory,
  so each folder comes back as it was left.
- Other open canvases get a `folder` frame on the event stream and reload.

## Why not restart the process

A restart drops the connection, so a caller that is polling `/api/items` sees a refused connection instead of the new
folder. It also needs a supervisor to keep the port. Swapping the session in place has neither problem.

## Costs

`server.js` gained a small amount of structure (module state became `let`, creation moved into a function); the other
lanes that add routes there must read `docs`, `items`, `ws` and `api` at call time, not capture them at start.
