# napkin

From napkin sketch to real components: a Paper-like design canvas tuned for components, that agents and people edit together.

Early days. The contract is in [INTENT.md](INTENT.md); how it fits the other projects is in [STACK.md](STACK.md).

## Run it (first build, M2)
A local canvas for real React components. Every `*.tsx` in a folder is a component in the napkin dialect ([decision 0003](docs/decisions/0003-tsx-dialect.md)). The canvas bundles each one with esbuild, draws it with React, and shows its full variant grid. A person (canvas) and an agent (MCP) edit the same files live; edits from a text editor, `git restore` or a branch switch show up too. Needs Node 26 and Chromium for the tests.

```console
npm test                              # tests 1-7 (7 = rendering, in headless Chromium)
npm run demo                          # the proving demo in headless Chromium; writes docs/demo/
npm start                             # canvas at http://127.0.0.1:4810/ on a temp copy of fixtures/ (the repo is not edited)
node src/server.js --dir components --port 4810    # your own folder of components, edited in place
NAPKIN_URL=http://127.0.0.1:4810/ npm run mcp      # MCP server on stdio for an agent: list_components, read_component, apply_edits
```
Click an element on the canvas to select it; the panel shows its component, node, variant and base styles (M2: Padding is the one editable field). A file napkin cannot read fully opens read-only with a badge and is never rewritten.

Contract the tests rely on: [test/CONTRACT.md](test/CONTRACT.md). Decisions: [docs/decisions/](docs/decisions/).
