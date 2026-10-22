# Edit together

Connect an agent with [propose mode](connect-your-agent.md). Ask it to read a
component, then change one property. Review the proposal's before and after
cells. Accept writes the proposed change. Reject leaves files unchanged.

You can edit while the agent works. Each request names a base revision and the
keys it touches. Edits to different keys can land from an older revision. An
edit to a key changed since its base is refused as stale. The agent gets the
current revision and changed values. The canvas clash chip shows the competing
values and can reapply your value on the current revision.

Open History for attributed edits. Ctrl/Cmd+Z undoes your own last edit as a new
revision. Ctrl/Cmd+Shift+Z redoes it. Undo does not undo another caller's work.
If someone changed the same property later, undo refuses and identifies that
change. History preview does not write a file; Restore does.

Hand edits reload live. A broken save leaves the last good render visible and
shows an error. Fix the source and save again. A valid file outside the dialect
opens read-only. Proposals, undo stacks, and recent history are lost when the
server stops. Git keeps long-term history.
