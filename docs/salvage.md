# Salvage notes: napkin

Audit date: 2026-10-17. Old repos were read, not modified. napkin is a Paper-like canvas
tuned for components, edited by agents and David together. Per INTENT it is **Phase 4**:
research, spec and tiny spikes only for now.

The ancestor is **precision-canvas** (private, `master@1ac4ce3`). It is a 620 KB frozen
HTML spec with 473 capabilities, 14 invariants, a hash-checked baseline, ADR and task-board
governance, and about 1k LOC of JS "semantic profiles" with 67 passing assertions.
There is no editor and no renderer. It drifted from "Paper clone for components" into
"Figma-scale conformance programme".

## How to bring anything in

Copy only the excerpt you need into `docs/reference/<name>.md`, with this header:

```text
> Provenance: davidghatley/precision-canvas@1ac4ce3:<path> (copied 2026-10-17, excerpt)
> Status: reference only. Not a spec. Overridden by anything in this repo.
```

Never copy code wholesale.

## 1. Carry as reference

| What | Source | Why |
|---|---|---|
| Five invariants, titles plus one line each | `precision-canvas@1ac4ce3:docs/architecture-invariants.md`, rows INV-01, INV-03, INV-04, INV-06, INV-08 | The core of "agents and humans edit together": the document on disk is canonical (INV-01); **one validated mutation path for every writer, human or agent** (INV-03); edits are atomic, attributed and undoable (INV-04); no silent approximation (INV-06); component identity is a stable ID, not a name (INV-08). The other nine are not needed yet. |
| Agent-surface checklist | `precision-canvas@1ac4ce3:spec/precision-canvas-capabilities.json`, entries `AGT-01..AGT-28` (fields `id`, `capability`, `productPriority` only) | 28 one-line capabilities: query, search nodes, transactional create/modify, dry-run, diff before commit, commit/rollback, agent attribution, MCP, scoped write permissions. A good checklist for napkin's API/MCP surface. Export it as a 28-row table. |
| Code-component checklist | same file, entries `COD-01..COD-21` | Design-to-code binding: typed prop schema, slots, token binding, rendering the real component, drift detection. This is exactly the "Paper is weak at components" gap. Export it as a 21-row table. |
| Transaction model, condensed | `precision-canvas@1ac4ce3:docs/architecture/transaction-model.md`, sections "Only write boundary" and "Guarded history" | Commands are `insert / set / delete / move` batches. Dry-run uses the same planner. Each commit produces an envelope (txId, actor, origin, base/result revision). Undo is a new attributed transaction. Summarize in about 15 lines. Skip the receipts/replica section. |
| Test ideas | `precision-canvas@1ac4ce3:harness/tests/transactions.test.mjs` (test names only) | "Rejected batch makes no mutation", "dry-run makes no history", "no internal aliases escape the kernel", "undo conflicts on a later remote edit to the same property". Rebuild these four against napkin's own model when a spike starts. |

## 2. Lessons

- **A frozen giant spec stalls building.** 473 capabilities and hash-locked invariants meant every change was an ADR, and Phase 0 never reached a pixel. Start from the INTENT demo ("an agent and David edit the same component live") and write only the spec that demo needs.
- **The good idea was right:** one mutation path shared by UI and agent, with attribution and undo, is what makes co-editing safe. Keep it.
- **"Files on disk are truth" needs a decision early.** precision-canvas spent much of its effort on crash-atomic storage (FILE-C01..05, FS-EXT01..05). For napkin, plain files plus git may be enough at first; prove the need for more before building it.
- **Agent-written prompts ended up in the repo** (`FIRST_RUN_PROMPT_CODEX_ASTRA.md`, `SPEC_FIX_PROMPT.md`). The agent's instructions became repo content, which drives context rot. Keep prompts out of the repo.

## 3. Leave behind

- **`spec/precision-canvas*.html` (620 KB, stored twice) and the full 473-row catalog.** Too big, Figma-scale scope, and it would dominate any agent's context.
- **Governance:** `STATUS.md`, `TASK_BOARD.md`, `HARNESS_PLAN.md`, `PHASE0_EXECUTION_PLAN.md`, `SPEC_BASELINE.md`, `spec/baseline.json`, `scripts/spec_integrity.py`, `check_*.py`, the ADR template, the fixture registry (119 entries, 86 deferred).
- **The JS reference packages** (`packages/*`) and the storage crash model. The "Rust-first kernel" hypothesis (HYP-KERNEL-01) was also never tested. Leave it.
- **The `inputs/` pre-correction originals and the agent prompt files.**
