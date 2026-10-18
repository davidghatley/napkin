# napkin

From napkin sketch to real components: a Paper-like design canvas tuned for components, that agents and people edit together.

Early days. The contract is in [INTENT.md](INTENT.md); how it fits the other projects is in [STACK.md](STACK.md).

## Co-editing spike (Phase-4 "Build first")
A throwaway-friendly spike for the riskiest idea: a person on a canvas and an agent over MCP edit the same component file live, and both edits land. Localhost, CPU only, one hard-coded Card (`fixtures/Card/Card.json`). Needs Node 26 and Chromium; no npm install.

```console
npm test          # acceptance tests 1-5 from FEATURES.md "Build first"
npm run demo      # the proving demo in headless Chromium; writes docs/demo/
npm start         # canvas at http://127.0.0.1:4810/ (edits fixtures/Card/Card.json in place)
npm run mcp       # MCP server on stdio for an agent (set NAPKIN_URL=http://127.0.0.1:4810/)
```
Contract the tests rely on: [test/CONTRACT.md](test/CONTRACT.md). Decisions: [docs/decisions/](docs/decisions/).
