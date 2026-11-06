# 0004: Widen the TSX dialect for slots, conditionals and composition

Status: **accepted** · Date: 2026-10-21 · Decided by: David (approved "N3" in the dream review); details proposed by the AI build lead (Claude).
Extends: [0003](0003-tsx-dialect.md). Everything in 0003 still holds.

## Context
The dream (docs/DREAM.md, CMP-04..08, SCN-3) needs components that hide parts by a boolean, take content from outside (slots), and use other components (a Card that renders a Button). 0003 kept the dialect narrow on purpose: no conditionals, maps or imports.

## Decision
Four constructs join the dialect. Anything else stays out, and a file using it opens read-only (INV-06 unchanged).

1. **Conditional node:** `{prop && <el data-n="id" … />}` where `prop` is a boolean prop. The node is otherwise an ordinary node. Model: `node.when = 'prop'`.
2. **Slots:** a prop typed `ReactNode` (imported as `import type { CSSProperties, ReactNode } from 'react'`). A node's only child may be `{slotProp}`, including `{children}`. Model: `node.slot = 'prop'`. Preview content for the canvas lives in the sidecar, never in the `.tsx`.
3. **Instances:** `import { Button } from './Button';` (a sibling file, named import, same folder) and `<Button data-n="cta" label="Buy" size="sm" />`. Attribute values are string literals, `{true}`/`{false}`, or `{someProp}` pass-through. An instance has no `style` and no children unless the target has a `children` slot. Model: `node.instance = { component: 'Button', props: { label: 'Buy', size: 'sm' } }`.
4. **Number props:** `size?: number` with a numeric default, so instance props and settings can be numbers.

New edit ops (all through `store.apply`, one commit path): `set {path: 'node.@when'}`, `set {path: 'node.@slot'}`, `insertInstance`, `set {path: 'node.prop:<name>'}` for instance props, `swapInstance`, `extractComponent` (a batch across two files is two applies in a fixed order: create the new file, then replace the subtree; a failure in the second rolls back the first by deleting the new file).

## Consequences
- An import cycle (A uses B uses A) is refused with `invalid edit`.
- The workspace keeps a "used by" graph so a change to Button re-renders every component that uses it (CMP-06 bar: < 100 ms).
- Opening other repos (OPN) is still read-only for anything outside this list; adopting a file means rewriting it into these constructs as a reviewed proposal.
