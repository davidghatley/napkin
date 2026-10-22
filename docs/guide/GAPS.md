# Current limits

The guide describes the running checkout. Decisions about TSX, inheritance,
clashes, undo, and agent permissions are implemented. See the
[decision records](../decisions/) and [tested contract](../../test/CONTRACT.md).

- Editable files use the narrow [TSX dialect](../dialect.md). Hooks, maps,
  arbitrary expressions, and instance children are unsupported.
- Read-only components need their dependencies and providers to render. napkin
  does not install a repository's dependencies.
- Proposals and undo history last only for the running session.
- A consumer app must import any token CSS the component needs.
- Agent permissions are local guard rails, not an operating-system boundary.
- This checkout provides the CLI. The guide does not require a published package
  or a global installation.
