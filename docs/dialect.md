# The napkin dialect (decision 0003)

A component is one `components/<Name>.tsx` file, plain React with no napkin import. napkin reads and writes only this shape. Anything else opens **read-only** with a reason that names a line, and is never rewritten (`test/invariants/readonly.test.js`, 50 examples). Written by the AI build lead from the code; the dialect itself was decided by David (0003).

## A complete component

```tsx
import type { CSSProperties } from 'react';

export interface BadgeProps {
  label?: string;
  tone?: 'info' | 'warn';
}

type Styles = Record<string, CSSProperties>;

const base: Styles = {
  root: {
    padding: 8,
    color: '#16181d',
  },
  text: {
    fontWeight: 600,
  },
};

const variants: Record<string, Record<string, Styles>> = {
  tone: {
    warn: {
      root: {
        color: '#b00020',
      },
    },
  },
};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Badge({ label = 'New', tone = 'info' }: BadgeProps) {
  const v = { tone };
  return (
    <span data-n="root" style={s('root', v)}>
      <b data-n="text" style={s('text', v)}>
        {label}
      </b>
    </span>
  );
}
```

## Every construct

| # | Construct | Rule | Test |
|---|---|---|---|
| 1 | Import | the only import napkin needs is `import type { CSSProperties } from 'react'`. Other imports are left as they are and ignored. | `standalone.test.js` |
| 2 | Props interface | one `interface <Name>Props`; every member optional (`name?: type`). Types: `string`, `boolean`, or a union of string literals (an **enum**). | `6-tsx-format.test.js` |
| 3 | Variant axis | an enum prop. Its default (in the parameter list) is the axis's **base** value and must be one of its values. | `6-tsx-format.test.js` |
| 4 | Type alias | `type ... = ...` lines are skipped. | `corpus` |
| 5 | `base` | `const base = { <nodeId>: { cssProp: literal, ... } }`. One property per line; values are string or number literals (negative numbers allowed). A node with no styles needs no entry. | `diff-budget.test.js` |
| 6 | `variants` | `const variants = { <axis>: { <value>: { <nodeId>: { cssProp: literal } } } }`. Only what differs from the base. Axes merge in prop order. | `diff-budget.test.js` |
| 7 | Style helper | `function s(node, v)` exactly as in the example (whitespace and comments aside). Any other body is refused. | `readonly.test.js` (spread-style) |
| 8 | Component | one `export function Name(...)`: plain (not async, generic or with a return type), props destructured with literal defaults (`{ a, b = 'x' }: NameProps`, no renaming, no rest). | `readonly.test.js` |
| 9 | Body | exactly `const v = { <axes in prop order> };` and one `return <jsx>;`. Nothing else (no hooks). | `readonly.test.js` |
| 10 | Element | tags: `div span p button img a section article header footer nav ul li h1 h2 h3 h4 label strong em small`. Attributes: `data-n="<id>"` (unique), `style={s('<id>', v)}` (same id), and for `img` `src`/`alt` string literals. No other attribute, no spread. | `readonly.test.js` |
| 11 | Content | an element holds child elements **or** one text: plain text, `{'text'}`, or `{stringProp}` (a "setting"). No mixing, no expressions. | `6-tsx-format.test.js` |
| 12 | Sidecar | `<Name>.napkin.json`: `id`, `canvas {x, y}`, optional `preview`; keys sorted. Position changes touch only this file. | `format.test.js` (FMT-06) |

Style property names must exist in React's `CSSProperties`, and numbers only go on properties that take them (otherwise `tsc --strict` would fail); `src/css-props.js` is generated from the types by `tools/gen-css-props.mjs`.

Not in the dialect (0004 widens it later): conditionals, maps, slots, imports of other components, number props.

## Layout napkin writes (prettier, `singleQuote: true`)

Files napkin creates, and the lines it writes into others, match prettier 3.9.9 with its default config plus `singleQuote: true` (the dialect writes single quotes). Test: `format.test.js`, 0 findings over 470 files and 3 x 150 edits. A file that uses double quotes, tabs, 4 spaces or CRLF keeps them. Hand-written layout that napkin did not touch is never reflowed; a one-line element you wrote stays one line when its text changes.

## Diff budget per edit (FMT-02, INV-03)

| Edit | Lines changed |
|---|---|
| set style (change / add / remove one property) | 1/1, 1/0, 0/1 (+2 if its node gets or loses a block) |
| set text, set `src`/`alt` | 1/1 |
| setDefault | 1/1 |
| addVariant value | 1/1 (the union line) + the new value block only when you add overrides |
| override | +1 per property (+2 per new wrapper block: node, value, axis) |
| rename prop / variant value | only the lines that name it |
| move node | its own JSX lines |
| canvas position | sidecar only (1-2 lines) |

Layout flips cost more once: a parameter list or a union that no longer fits in 80 columns is split one per line, a tag with a long `src` puts one attribute per line, an element gaining its first child goes from `<x />` to three lines. `test/helpers/budget.js` states the exact allowance; 1,000-op fuzz: 0 over (`docs/evidence/INV-03.txt`).

## Git and `.napkin/`

Adjacent changed lines conflict in any git merge, so two branches editing neighbouring properties of the same block conflict like any code (`format.test.js` FMT-04 picks pairs that do not touch: 20/20 clean). Put `.napkin/` (server lock) in your `.gitignore`; napkin never writes it into a component.

## Known limits

- A file with mixed line endings is rewritten with one kind in the parts napkin reprints.
- Tab-indented files are edited as four spaces per level and converted back; unchanged lines keep their bytes.
- The dialect needs `const v` in every component; a file without it is read-only.
