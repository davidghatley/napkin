# napkin

napkin is a local canvas for components: plain HTML/CSS first, React TSX/JSX too.
Edit a component in the browser, in a text editor, or through an agent over MCP.
The file on disk is the component your app or page uses. There is no export step,
no napkin runtime dependency, and nothing napkin needs inside your folder.

## Quickstart

Use Node.js 26 or newer, npm, and git. From this checkout:

<!-- quickstart:start -->
```sh
npm ci
cp -r examples/starter ../my-napkin
node src/cli.js open ../my-napkin
```
<!-- quickstart:end -->

`open` takes any folder: point it at your own components instead of the copied
starter (`node src/cli.js open path/to/your/folder`). Nothing in the folder is
required and napkin writes nothing there except the edits you make. It prints the
canvas address and a `.mcp.json` object for Claude Code. The default port is 4810;
napkin tries the next port if it is occupied. Use `--port 0` for a free random port.
Open the printed address. Stop the server with Ctrl+C.

Press **N** to create a component. **F**, **T**, and **I** draw a frame, text, or
image inside a component. **Ctrl/Cmd+K** finds components, layers, and actions.
**?** opens the shortcut sheet. The [user guide](docs/guide/README.md) covers the
canvas, variants, agents, files, tokens, and undo.

## Open any folder

```sh
node src/cli.js open path/to/your/components
```

Every `.html` file is a component (drawn exactly as the browser draws that file,
in its own frame, so `@media` answers to the frame's width), and so is every
exported component of a `.tsx`/`.jsx` file. Click an element to edit its text,
classes, inline style and the CSS rules that match it; each change is a small edit
in place, with undo. If the files use CSS variables that nothing they load defines
(a design system whose previews rely on a host page), napkin asks once which of the
folder's stylesheets apply and remembers the answer outside the folder. napkin
writes nothing into the folder except the edits you make. The engine and its HTTP
contract are described in [decision 0014](docs/decisions/0014-document-engine.md).

### Optional: a starter project

`init` writes a `napkin.json` and `components/Welcome.tsx` into an empty folder
and exits. It is not needed to open anything; it only gives you a fresh folder to
start from (outside this checkout):

```sh
node src/cli.js init ../my-napkin
```

## A 40-component sample

From this checkout, choose an empty destination (replace `./sample-40` in both
commands to use another folder):

```sh
node tools/sample-repo.js ./sample-40
node src/cli.js open ./sample-40
```

This creates exactly 40 editable components, including Badge, Button, Card, and
Chip. It initializes git, creates no commits, and refuses a nonempty destination.
Components have text settings, styles, and variants. Use Ctrl/Cmd+K to find Badge,
select its root, and change Radius in the inspector. Base edits flow to variants
that have no override. This is the setup for [scene S1](docs/DREAM.md).

## Connect an agent

Copy the `.mcp.json` object printed by `open` into your agent project's
`.mcp.json`. It uses `node`, this checkout's `src/mcp.js`, the running canvas's
`NAPKIN_URL`, and `NAPKIN_AGENT=claude`. Restart Claude Code and ask it to call
`list_components`. Keep the server running while the agent works.

To require review, merge this configuration into your project's `napkin.json`:

```json
{
  "components": "components",
  "agents": { "you": "write", "claude": "propose", "*": "read" }
}
```

The agent name must match `NAPKIN_AGENT`. `read` permits inspection, `propose`
holds edits for Accept or Reject on the canvas, and `write` applies edits directly.
With an `agents` key, unlisted names use `*`, which defaults to `read`. Without
that key, callers may write. These are local guard rails; programs running as you
can also edit the files directly. See [agent setup](docs/guide/connect-your-agent.md)
and [decision 0005](docs/decisions/0005-clash-undo-permissions.md).

## Open an existing repository

Pass its folder to `node src/cli.js open`, as in the sample command above.

- A `napkin.json` project uses its `components` path.
- Without a config, napkin scans `.tsx` files recursively, skipping `node_modules`,
  `dist`, `build`, `.git`, `.napkin`, and `.next`.
- The scan does not follow symlinks.
- Files outside the [dialect](docs/dialect.md) open read-only, with reasons and
  line numbers.
- Missing dependencies or providers can prevent a preview.

Opening, reading, and rendering create no component sidecars. A configured project
saves a sidecar beside a component when you move its frame or save a preview
setting. Existing sidecars retain their identities and settings. In a repository
without `napkin.json`, opening writes no repository files; add `--write-sidecars`
to permit saved positions and previews. Without it, positions last for the session.
Explicit component edits and accepted adoption proposals write the selected TSX.

For supported simple read-only files, an agent can call `propose_adoption`.
Review its source and diff through the proposals API before accepting. Unsupported
hooks, expressions, class names, or runtime imports are refused with reasons.
See [keeping files](docs/guide/keep-your-files.md).

## Use components in an app

Select a node, open **Inspect**, and click **Copy usage**. The copied text includes
a named import and JSX for the selected variant. The import path is relative to
the opened components folder; adjust it for your app's location or alias.

The [consumer app](examples/consumer-app/App.tsx) imports Button directly.
Build it against the sample's components:

```sh
node examples/consumer-app/build.mjs ./sample-40/components ./sample-40/consumer
```

Serve the resulting folder with your usual static server. If components use token
CSS variables, import their token CSS in the app too.

## Canvas and files

Pan with the wheel or Space-drag. Zoom with Ctrl/Cmd-wheel or `+` and `-`.
Shift+1 fits all frames. Shift+2 fits the selection. Drag a frame by its title.
The left Layers tree selects and reorders nodes. The inspector edits CSS, text,
settings, and variants. Choose **Base** or **This variant** before editing.

Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo your own edits. They refuse to
overwrite a later change to the same property by someone else. The bottom drawer
has Code, History, Tokens, Inspect, Assets, Changes, and Activity. Undo stacks and
recent history last for the server session. Pending agent proposals are saved in
`proposals.json` and survive a restart: in `.napkin/` inside the components folder for a project with a `napkin.json`, otherwise in napkin's own state folder (`~/.local/state/napkin`), so a repo you only opened stays clean. Git keeps long-term history. napkin never commits.

The disposable demo includes 22 tokens:

```sh
node src/server.js --port 0
```

It edits a temporary fixture copy and removes it on exit. Use the diamond beside
an inspector field to bind a token. **Component theme** previews component modes. The
**Tokens** drawer edits the configured token source. Token paths in `napkin.json`
are relative to that config. See [tokens and variants](docs/guide/change-every-version.md)
and [decision 0010](docs/decisions/0010-tokens.md).

## Development

```sh
npm test
npm start
npm run demo
```

`npm start` runs the disposable demo on port 4810. Stop it before starting another
server on that port. Tests use random ports and CPU Chromium. Install Chromium
or set `CHROMIUM` to its executable for browser tests. `npm run demo` runs the
co-editing demonstration test and writes its evidence under `docs/demo`.

[test/CONTRACT.md](test/CONTRACT.md) lists the tested UI and API.
[Decisions](docs/decisions/) describe the file format and behavior.
