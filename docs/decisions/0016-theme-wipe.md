# 0016: How a frame is shown in another theme (the theme wipe)

Status: **proposed** · Date: 2026-10-30 · Written by the AI builder (Claude); David has not decided this yet.

## Context
Dream moment 5: a slider wipes one theme into another across the whole canvas. The themes are whatever the files define: `@media (prefers-color-scheme)`, `[data-theme="x"]`, a `.dark` class. Each component is an iframe of `/view/<id>`. A page cannot make an iframe report the other colour scheme: `prefers-color-scheme` comes from the browser. The file on disk must never change (decision 0013), and nothing may be added to the folder.

## Options
1. **Rewrite the media condition in each frame's style sheets (CSSOM), set the attribute or class, set `color-scheme`.** Everything is done to the frame's document in memory. No server work, no changes to `/view`.
2. **Ask `/view` for a theme** (`?theme=dark`) and let the server rewrite the CSS text it serves. Works without scripting the frame, but the server would then serve text that differs from the file, which breaks "the canvas, the reference and the file opened directly agree" (decision 0014).
3. **Browser emulation** (the DevTools `Emulation.setEmulatedMedia` call). Exact, but only a debugger can use it; a normal page cannot.
4. **A CSS filter** (`invert`, `hue-rotate`). Fast and always works, but it is not the file's dark theme; it would mislead a designer.

## Decision (proposed): option 1
For a frame that should show theme T:
- Every `@media` and `@import` media condition that mentions `prefers-color-scheme` has that clause replaced in the CSSOM: `(prefers-color-scheme: T)` becomes `(min-width: 0px)` (true) and the other scheme becomes a clause that is never true. Other clauses in the same query are kept, so `(prefers-color-scheme: dark) and (min-width: 600px)` still means what it said. The first text is remembered, so a frame can be switched between themes any number of times. `media` attributes of `<link>` and `<style>` get the same treatment.
- The attribute the files use (`[data-theme="dark"]`, `[data-mode=...]`, found by reading their selectors) is set on `<html>` and `<body>` to T's value if the files define it, and taken off if they do not; a theme class (`.dark`, `.theme-sepia`) likewise.
- `:root { color-scheme: T !important }` is added in a `<style data-napkin>` so `light-dark()`, form controls and the frame's canvas colour follow.
- The wipe renders each frame twice (the second iframe is the same `/view` page, in the other theme) and clips the top copy at the wipe line, in the frame's own pixels. Closing the wipe removes the copies and loads the frames again, which puts them back exactly as the file draws them.

## Why
- The browser does the real work: every rule of the file applies as it would in that theme, including rules the AI never saw.
- The file, `/view` and the folder are untouched.
- No new dependency.

## What it cannot do
- A theme chosen by script that reads `matchMedia` at run time (JavaScript that decides colours itself) is not changed until the script runs again. Static files, which are the common case, are fully covered.
- A theme that is a different stylesheet swapped by script is not found.
- Two copies of each frame while the wipe is open (about twice the memory for the visible frames). Only while it is open.
- A frame that sets `color-scheme` on an element other than `:root` keeps its own value there.

## Consequences
- Measured in `test/stage/stage.test.js` (moment 5): the frame and its copy read different colours, the line cuts every frame where it is on screen, the folder's bytes are identical before and after, and closing restores the frames.
