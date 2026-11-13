# 0018 — Kinds: registry, bounded readers, and viewer recipes

Status: accepted

Every file is an item. A registry entry owns detection, metadata, rendering, instruments,
and edits. HTML and JSX continue through the document engine; the registry delegates to
it rather than replacing its editing and rendering rules. Explicitly installed trusted
modules may register kinds through `NAPKIN_KIND_PLUGINS`. Opening a folder never executes
plugins from that folder.

Indexing reads at most 64 KiB per file and caches by file identity and modification time.
Viewers request bounded windows. Media uses HTTP byte ranges. Archive directories and
Parquet metadata are read from the tail, with limits. SQLite uses Node's read-only driver.
There are no new runtime packages. Optional local ffmpeg supplies decoded audio peaks;
playback still works without it. Large source edits are refused rather than silently
truncating a file.

Controls edit native values where the format holds them: JSON leaves, CSS variables,
SVG attributes, delimited cells, markdown front matter, and text. Settings that the
format cannot hold (poster time, playback gain, image exposure, model view, binary
window) live in `<filename>.napkin-recipe.json`, created only by an explicit edit.
Recipes are themselves ordinary items. Looking at files creates no recipe.

A revision covers both the source identity and recipe bytes. Each edit checks the
revision, validates the value, writes atomically, and records an exact byte snapshot.
Undo checks that the result is still current before restoring it, and removes a recipe
when undoing its creation. Histories are bounded and kept in memory for this first round;
restart-persistent kind history needs a later shared history integration.
