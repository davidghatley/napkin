# Quickstart: edit one button with your agent

Time: under 10 minutes. You'll end with a Button that you and your agent edited at the same time, saved as one file in your project, and a `git diff` that shows exactly what changed.

> napkin is planned, not shipped. Commands are working names. File examples are illustrative because the file format isn't decided ([GAPS.md](GAPS.md), G1). They are shown HTML-first for readability.

## You need
- A project folder that is a git repository.
- napkin installed. `napkin --version` prints a version. (How napkin is installed is open: [GAPS.md](GAPS.md), G7.)
- An AI agent that speaks MCP, such as Claude Code.
- Optional: a token file (for example `tokens.json` from your design system).

## 1. Set up the project (1 minute)

```console
$ cd my-app
$ napkin init --tokens design/tokens.json
Created napkin.json
  components: components/
  tokens:     design/tokens.json (24 colours, 8 spacing, 4 radius)
```

## 2. Open the canvas (1 minute)

```console
$ napkin open
napkin is running
  canvas: http://localhost:4810
  agent:  MCP over stdio (napkin mcp), API on http://localhost:4810/api
  files:  watching components/
```

Your browser opens on an empty canvas.

## 3. Connect your agent (2 minutes)

Add napkin to your agent's MCP settings. For Claude Code, create `.mcp.json` in the project root:

```json
{ "mcpServers": { "napkin": { "command": "napkin", "args": ["mcp"] } } }
```

Restart the agent. Ask it: "list napkin components". It should reply that there are none yet. Details: [connect-your-agent.md](connect-your-agent.md).

## 4. Ask the agent for a Button (2 minutes)

Type to your agent:

> Make a napkin Button with a label setting, using our tokens. Sizes small, medium and large.

Within a moment a Button appears on the canvas, with three sizes side by side. The file `components/Button.html` now exists.

## 5. Edit it together (2 minutes)

1. Click the medium Button on the canvas.
2. In the right panel, change **Padding** from `space-3` to `space-4`.
3. While you do that, type to your agent: "add a disabled state to the Button".

You see a label "agent: editing Button" on the canvas, then a disabled row appears under the three sizes. Your padding change stays. The agent's reply mentions your new padding, because it read the file after your edit.

## 6. Check the file (1 minute)

```console
$ git add components/Button.html && git diff --cached --stat
 components/Button.html | 24 ++++++++++++++++++++++++
```

Open the file in your editor. It is plain text you can read, with your padding and the agent's disabled state in it.

## It worked if
- The canvas shows 6 Buttons (3 sizes x enabled and disabled).
- `components/Button.html` contains both your padding change and the disabled state.
- Closing napkin and running `napkin open` again shows the same Button.

## Next
- [Edit together](edit-together.md) in more depth.
- [Change every version at once](change-every-version.md).
- [Keep, review and undo files](keep-your-files.md).
