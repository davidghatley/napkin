# Connect your agent

Start a canvas with the [quickstart](quickstart.md). Copy the JSON object after
“Paste into .mcp.json for Claude Code” from the `open` output. Merge it into your
agent project's `.mcp.json`, then restart Claude Code. The snippet uses Node,
this checkout's MCP entry point, the actual server URL, and `NAPKIN_AGENT=claude`.
It prints a local absolute executable path; use the output for your checkout.

Ask the agent to call `list_components`, then `read_component` for Welcome.
It should return the current revision and source. Edits use that revision as
`baseRevision`. The agent can read the MCP resource `napkin://guide` for edit operations.
The canvas shows agent presence while it is connected and editing.

To require review, merge this into the project's `napkin.json`:

```json
{
  "components": "components",
  "agents": { "you": "write", "claude": "propose", "*": "read" }
}
```

| Mode | Effect |
|---|---|
| read | Inspect components. Direct edits are refused. |
| propose | Edits become proposals. Review them with Accept or Reject. |
| write | Valid edits apply immediately. |

The configured name must match `NAPKIN_AGENT`. Keep `you` in write mode for
canvas actions. With an agents key, unlisted names use `*` or default to read.
Without an agents key, callers may write. Config is read for requests; restart
the MCP client after changing its environment. Proposals live only for the server
session. Accept can be refused as stale if the affected properties changed.

These permissions govern requests through napkin. Any local program running as
you can also write the files directly. The server listens on loopback and checks
Host and browser Origin. See [decision 0005 and its amendment](../decisions/0005-clash-undo-permissions.md).

If tools are absent, check that the agent loaded `.mcp.json`. If connection is
refused, check that the server is running and use the URL printed by the current
`open` process. There is no `napkin mcp` subcommand; the printed configuration
runs `src/mcp.js` with Node.
