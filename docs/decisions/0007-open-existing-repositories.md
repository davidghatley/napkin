# 0007: Open repositories without creating sidecars; review adoption

Status: **proposed** · Date: 2026-10-21 · Proposed by the open-lane builder (Codex); David approved opening other repos (N2), not these details.
Extends 0003 and 0005; does not widen the editable dialect.

An external repository (no napkin.json) is scanned recursively and opened without
sidecar writes. Every TSX is classified against the store’s dialect. Independent AST analysis
reports all blocking constructs with plain names and source lines, including
per-construct file counts. Editable files still pass the same reader.
Symlinks are not followed, and dependency/output/git folders are skipped.

Every server and fallback MCP shares a directory lock under the OS temp folder,
keyed by the resolved directory path. Ordinary projects additionally retain the
`.napkin/lock` contract. This keeps an external repo untouched while preventing
a fallback MCP from becoming a second writer. Existing local locks are honored.
`--write-sidecars` explicitly enables saved identity and position sidecars.

Adoption is a source replacement authorized only by accepting a proposal. The
converter recognizes a deliberately small subset (named functions with literal
string/boolean defaults and string enum types, intrinsic JSX, and literal inline
or constant style objects). It refuses everything it cannot preserve.
The API creates the proposal from the file it read, never caller-supplied source.
Accept calls store.apply using an internal Symbol capability unavailable to JSON
requests. Both the revision and exact original file bytes must still match.
Only commit.js writes the TSX. Reject makes no filesystem change.

Read-only previews use the component's own bundle and default props. Build and
runtime failures are displayed with the affected file and a next step. napkin
does not install another repository's dependencies or invent missing context.

`open` starts listening before scanning. Component states and scan progress stream
as files are opened; bundles are requested when previews enter view. Deferred
frames reserve a placeholder, then place themselves using their measured size.
Build errors occupy a fixed-size card inside the frame; click expands details
within its scrolling region. Titles and layers disambiguate duplicate names
with repository-relative paths. Error messages use those paths too.
