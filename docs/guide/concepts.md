# Concepts

**Component.** One exported React function in a TSX file. Editable files use the
[napkin dialect](../dialect.md). Other TSX files can render read-only.

**Node.** An element identified by `data-n` in the JSX. The Layers tree mirrors
these nodes. Select a node to edit its style, content, or composition.

**Setting.** A component prop with a default value. Text can be bound to a string
setting. Settings also support boolean, number, enum, and node slot props.

**Variant axis.** An enum setting such as size. The canvas renders combinations
of axis values as cells. The default value is the base value for that axis.

**Base and override.** Base styles apply unless the chosen variant overrides a
property. A base edit updates every cell that inherits that property. Axis
order decides which override wins when several axes set the same property.

**Sidecar.** A sibling `.napkin.json` file. It saves identity, canvas position,
and optional preview widths or slot text. Merely opening a component does not
create it. Renaming a component saves its identity so references remain stable.

**Token.** A named value in a configured JSON or CSS source. A bound style uses a
CSS custom property. Component theme chooses the token mode for previews.

**Proposal.** An agent's validated change, held until you answer it. Pending
proposals are saved in `.napkin/proposals.json`, so they survive a restart.
Accept writes through the revision-checked store. Reject leaves component files
unchanged.

**Session.** One running server. Undo stacks, presence, and recent history live
in memory. Pending proposals, source files and saved sidecars survive a restart.
