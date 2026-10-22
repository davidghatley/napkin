# Change variants and tokens

Select the root in a component cell. Set the inspector scope to Base. Change
Radius. Every variant cell without its own radius override updates. The TSX
change is in the root's base style block.

Select a non-base cell. Choose This variant and change Radius again. The field
shows an override dot and a Reset to base button. Reset removes the override.
With several axes changed, use the axis picker to choose where the override
belongs. Settings and Variants let you add enum values and change defaults.

The disposable demo includes a token source and generated CSS:

```sh
node src/server.js --port 0
```

Open its printed address. Select a component. Use the diamond beside a colour,
padding, gap, radius, or font-size field to choose a token. The field shows the
name and resolved value. An orange dot offers a nearby token for an unbound
literal. A snap changes the source; use undo if needed.

Use Theme in the top bar to preview component modes. The separate editor theme
control changes the canvas chrome. Open the Tokens drawer to search by name,
value, usage, or family and edit source values for each mode.

For your own project, add a tokens object to `napkin.json`, keeping its components
and agents keys:

```json
{ "tokens": { "source": "tokens/tokens.json", "css": "tokens/tokens.css" } }
```

Paths are relative to the config. The files must already exist. JSON sources use
the shapes in [decision 0010](../decisions/0010-tokens.md). CSS sources read custom
properties from root and theme selectors. Import token CSS in the consumer app.
Externally generated CSS remains the responsibility of your token build.
