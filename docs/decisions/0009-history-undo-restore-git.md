# 0009: How undo, restore, git attribution and assets work

Status: **proposed** · Date: 2026-10-21 · Written by the AI builder (Claude) for the history lane; David has not decided on this yet.
Builds on 0005 (G5: undo only your own edits, refused when someone else touched the same keys).

## Decisions
- **Undo is a document difference, not a recorded inverse.** `diffToEdits(after, before)` builds ordinary edits and checks them by applying them; if the result is not the earlier document exactly, undo says so and does nothing. This covers every op with one function, and restore reuses it (`diffToEdits(now, past)`), so restore is one revision.
- **Stacks are per caller name, in server memory** (100 steps). An agent can undo its own edits through the same route. Approving a proposal does not put it on the approver's stack.
- **New `at` hint on `set`** (undo and restore only) and a writer change: a new style key goes after the key before it in the model's order, so an undo puts a removed line back where it was. Ordinary adds still land at the end.
- **Git attribution uses git's own traces**: the HEAD reflog (a verb other than `commit`) or an index rewrite plus "the file equals its HEAD or index blob", within 4 seconds. A hand edit stays `file`. It can mislabel a hand edit that equals HEAD within 4 s of a git command; accepted.
- **Assets:** `assets/<sha8>.<ext>` next to the components, a relative `src`; the server serves any image path from the components folder or repo. Asset files are written atomically but outside `commit.js` (they are not component files; the INV-05 allow-list names `assets.js`).
- **Change frames now carry the file text** (`source`) so the code strip updates without a request.

## Consequences
History lives for the server's session (500 revisions, as before). Undo of a file the files lane re-keys with content hashes still works: only equality of revisions is used.

## Amendment after the critic (2026-10-21)
- Undo conflicts use precise keys (the node an insert or move concerns, not its parent's child list), and a refused step can be skipped so the stack is never trapped. Restore names whose later work it takes back and needs a confirm click on the page.
- Git attribution needs a git trace AND a blob git wrote; stash text is remembered before a pop drops it.
- `napkin docs` opens the folder read-only (no sidecars, no lock). The catalog has a playground that runs the component's own bundle offline.
- The render host paints an empty page before every cell so a cell's bytes do not depend on what was drawn before it.
