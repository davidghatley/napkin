# 0003: Components are React (TSX) files in a small napkin dialect

Status: **accepted** · Date: 2026-10-20 · Decided by: David (file format, scope, base, local-only, in plan mode); dialect details proposed by the AI build lead (Claude).
Supersedes: [0001](0001-file-format.md) (JSON node tree, spike only). Settles GAPS G1 and G3.

## Context
Paper's main gap is components: there's no variant management, no shared component system, and you can't design with your real code components. napkin should be the opposite. The file on the canvas *is* the component an app imports, so there's no export step.

## Decision
Each component is `components/<Name>.tsx`. It's plain React with no runtime dependency on napkin, written in a narrow dialect that napkin can read and write without guessing:

```tsx
import type { CSSProperties } from 'react';

export interface ButtonProps {
  label?: string;
  size?: 'md' | 'sm' | 'xl';
}

const base: Record<string, CSSProperties> = {
  root: {
    padding: '8px 16px',
  },
  label: {
    fontWeight: 500,
  },
};

const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
  size: {
    sm: {
      root: {
        padding: '4px 10px',
      },
    },
  },
};

function s(node: string, v: Record<string, string>): CSSProperties { /* base + matching overrides */ }

export function Button({ label = 'Button', size = 'md' }: ButtonProps) {
  const v = { size };
  return (
    <button data-n="root" style={s('root', v)}>
      <span data-n="label" style={s('label', v)}>{label}</span>
    </button>
  );
}
```

- **Nodes:** each JSX element has a stable `data-n` id and `style={s('<id>', v)}`. A node holds either child elements or one text: a string, or `{prop}` (a "setting").
- **Props:** `string`, `boolean`, or a union of string literals. A union prop is a **variant axis**, and its default value is the axis's base.
- **Base + overrides (G3):** `base` holds every node's styles, one property per line. `variants[axis][value][node]` holds only what differs. Changing the base updates every variant without an override, as a one-line diff. Axes merge in prop order.
- **The sidecar** `components/<Name>.napkin.json` holds what isn't code: the stable component id (INV-08) and the canvas position.
- **Reading and writing:** `@babel/parser` (TSX) via `recast`. napkin keeps the AST and patches only the nodes an edit changes, so recast reprints only those. Unchanged text stays byte-identical.
- **Outside the dialect:** a `.tsx` file napkin can't read fully opens **read-only**, with the reason shown. It is never rewritten (INV-06, no silent approximation).

## Consequences
- Components can be imported by any React 19 app as-is. The proving demo checks this with `examples/consumer-app`.
- The dialect is narrow on purpose (no hooks, conditionals or maps yet). Opening arbitrary existing components (G4) means widening it, and that's left for later.
- napkin now has npm dependencies: `react`, `react-dom`, `esbuild`, `recast`, `@babel/parser`. Each is pinned to a release at least two weeks old.
- Revisions, the single-authority server and the edit-path rules from 0002 are unchanged. Edits now work on the model read from the TSX.
