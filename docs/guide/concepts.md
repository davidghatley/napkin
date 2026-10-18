# Concepts

Short definitions of the words this guide uses.

**Canvas.** The napkin window in your browser. It shows your components as real HTML and CSS, so what you see is what the browser will draw.

**Component.** One reusable piece of UI, such as a Button or a Card. In napkin a component is one file in your project.

**Component file.** The file on disk that holds a component: its structure, styles, versions and settings. It is the source of truth. The canvas shows it and the agent edits it, but the file is what counts. Its exact format is not decided yet ([GAPS.md](GAPS.md), G1).

**Version (variant).** One form of a component, such as "small" or "disabled". A Button with 3 sizes and 3 states has 9 versions. All versions live in the same component file.

**Base.** The shared part of a component that every version starts from. Change the base and every version that hasn't overridden that property changes too ([GAPS.md](GAPS.md), G3).

**Setting (prop).** A value someone using the component can choose, such as a Button's `label` or `size`.

**Tokens.** Your shared colours, spacing and corner sizes, read from your design system's token file (for David's projects, secret-sauce's `tokens.json`). A component that uses `space-4` instead of `16px` follows the token when it changes.

**Edit.** One change to a component, such as "set the Card's padding to `space-3`". Every edit goes through the same path, whether you made it on the canvas or the agent made it.

**Agent connection.** How an AI agent talks to napkin. napkin runs an MCP server (MCP is a standard plug for agent tools) and an API. The agent uses it to read components and make edits.

**Session.** A running `napkin open`. While it runs, the canvas, the agent connection and the files on disk stay in step.

**Presence.** The small label on the canvas that shows where the agent is working right now, such as "agent: editing Card / compact".

**Project.** Your repository folder. napkin keeps its settings in `napkin.json` at the project root.
