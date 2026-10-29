# Start the canvas

Use Node.js 26 or newer, npm, and git. From the checkout root:

```sh
npm ci
node src/cli.js init ../my-napkin
node src/cli.js open ../my-napkin
```

`init` creates `napkin.json` and `components/Welcome.tsx`. It exits without starting
a server or printing MCP configuration. `open` prints the canvas address and the
`.mcp.json` connection object. Open the address in a browser. The default port is
4810, or the next free port. Ctrl+C stops the server.

Welcome has a label setting and three sizes. Click its rendered text to select
it. Change a field in the inspector. Open Code to see the saved TSX. Press N to
create another component. Press ? for the complete shortcut sheet.

For the 40-component S1 exercise, use a separate empty folder:

```sh
node tools/sample-repo.js ./sample-40
node src/cli.js open ./sample-40
```

The sample includes Badge, Button, Card, and Chip. All 40 files open editable.
Git is initialized, with no commits. Opening the canvas adds no untracked
sidecars. Moving one frame saves only that component's sidecar.

Continue with [drawing](start-a-component.md) or [agent setup](connect-your-agent.md).
