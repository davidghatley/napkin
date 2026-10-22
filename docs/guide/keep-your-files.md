# Keep and review files

Components are React TSX files. Import their named exports in an app. There is
no napkin runtime or export step. Inspect's Copy usage includes an import and
the JSX for the selected cell. Its path starts at the opened components folder;
adjust the import for your app's source layout or alias.

The [consumer app](../../examples/consumer-app/App.tsx) uses a direct Button
import. After making the sample in the [quickstart](quickstart.md), build it:

```sh
node examples/consumer-app/build.mjs ./sample-40/components ./sample-40/consumer
```

This writes a static app into the sample's consumer folder. Serve it with your
usual static server. Import your token CSS too when using token-bound styles.

Open Code to inspect live source. Click a line to select its node. Changes shows
component differences against git HEAD, including a line diff and before/after
pictures. A newly initialized sample has no HEAD until you make its first commit.
napkin never makes commits. Review and version source through your normal git
workflow.

A component's sidecar saves canvas position, identity, preview widths, and slot
preview text. It appears when those settings need saving or a rename needs a
stable identity. Opening, bundling, and reading do not create sidecars. Existing
sidecars are preserved. The `.napkin/` folder holds the project writer lock; the
sample ignores it in git. In an unconfigured repository, `open` keeps the lock
outside the repo and disables sidecar writes unless `--write-sidecars` is set.

Undo and redo are in the canvas. History is session memory; source and saved
sidecars persist. Keep sidecars with components when moving files between repos.
Hand saves reload through the file watcher. Broken source retains its last good
render until fixed. Unsupported TSX stays read-only. An agent can propose
adoption of supported simple components through `propose_adoption`; inspect its
source and diff through the proposals API. Accept writes it; Reject does not.
