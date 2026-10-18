# GAPS: where this guide waits on David

Checked against INTENT.md on 2026-10-18. INTENT wins every disagreement. Where a workflow needs something INTENT leaves open or rules out, the guide says "not decided" and links here instead of inventing an answer. Question numbers refer to `~/Projects/.kitchen/copy-review.md`, "INTENT gaps for David".

| ID | Gap | Where the guide needs it | INTENT says | Copy-review question |
|---|---|---|---|---|
| G1 | **Component file format.** HTML-first or a component AST, and which framework (if any) an app imports. | Every file example, [keep-your-files](keep-your-files.md) step 5, the `git diff` lines | Open decision: "Document model (HTML-first vs a component AST)" | none (INTENT open decision) |
| G2 | **Same-property clashes.** What happens when you and the agent set the same property at the same moment. | [edit-together](edit-together.md), problems and limits | Silent. The proving demo depends on live co-editing. | #15 |
| G3 | **Base-to-version inheritance**, with per-version overrides. | [change-every-version](change-every-version.md), the whole page | "optimized for components (variants, props, tokens)", no rule on inheritance | #17 |
| G4 | **Opening existing components** already in a repo, not made in napkin. | [start-a-component](start-a-component.md), limits | Silent | #18 |
| G5 | **In-app undo and per-edit attribution** (salvage.md INV-03/04). The guide promises undo only through git. | [edit-together](edit-together.md), [keep-your-files](keep-your-files.md) | Silent; files are "diffable, versionable" | #16 |
| G6 | **Agent permissions.** Who may connect and what they may write (salvage AGT checklist has scoped write permissions). | [connect-your-agent](connect-your-agent.md), limits | "Exposes an API/MCP surface for agents", nothing on access | none (new) |
| G7 | **Install, distribution and licence.** How a user gets `napkin`, and whether it is public. | [quickstart](quickstart.md), prerequisites | Silent; STACK.md says "open" | #2 |
| G8 | **Who the user is.** The guide addresses "you", as the landing page does, but INTENT says "David edits". | Every page | "agents read and write the same documents David edits" | #19 |
| G9 | **Status.** This guide describes a working product, but napkin is Phase 4: "research, spec, and tiny spikes only". | Every page; FEATURES.md "Build first" | "Not starting now" | none (ruled out by INTENT, so honoured) |

## How G9 is honoured
- The guide is labelled "planned" at the top of the index and quickstart.
- FEATURES.md lists the full feature set for the spec, but its **Build first** list is only a small spike that tests the core idea (a person and an agent editing one component file live). Nothing beyond that spike should be built until David starts Phase 4.

## Not gaps (kept out on purpose)
- Whiteboard features and full Figma parity: ruled out by INTENT, so no workflow covers them.
- Multi-person, multi-machine collaboration: not in INTENT; the guide covers one person and agents on one machine.
- Hosting or syncing files outside the repo: INTENT says files on disk are the source of truth.
