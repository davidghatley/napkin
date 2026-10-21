# Progress ledger

Live status of every DREAM.md criterion. Updated by the lead (Claude, Opus) after each critic verdict and merge. Status: open / building / critic-fail / pass / unverifiable.

Status "critic-pass" = a critic passed it on its branch; "pass" = merged into feat/core with the full suite green.

Lanes are groups of areas that share files, so parallel builders don't collide. Round 1 lanes: files, engine, agents, canvas.

| ID | Area | Lane | Status | Last critic verdict | Evidence | Commit |
|---|---|---|---|---|---|---|
| INV-01 | INV | files | critic-pass | r1 pass 100/100 | docs/evidence/INV-01-REL-01.txt | 93e2d5a |
| INV-02 | INV | files | critic-pass | r1 pass 42/42 | test/invariants/noop.test.js | 93e2d5a |
| INV-03 | INV | files | critic-fail | r1 fail: hand-formatted files re-indent neighbours | test/invariants/diff-budget.test.js | 93e2d5a |
| INV-04 | INV | files | critic-pass | r1 pass 50/50; reasons wording | test/invariants/readonly.test.js | 93e2d5a |
| INV-05 | INV | files | critic-pass | r1 pass (files branch); converge with commit.js at merge | test/invariants/one-path.test.js | 93e2d5a |
| INV-06 | INV | files | critic-pass | r1 pass | test/invariants/standalone.test.js | 93e2d5a |
| CAN-01 | CAN | canvas | pass | r1 pass: drift 1e-11 px | test/12-canvas-nav.test.js | d57d328 |
| CAN-02 | CAN | canvas | pass | r2 pass: atomic sidecar, identity | test/16-canvas-endpoint.test.js | d57d328 |
| CAN-03 | CAN | canvas | pass | r1 pass: p95 0.8 ms; flight 282 ms | test/13-canvas-frames.test.js | d57d328 |
| CAN-04 | CAN | canvas | critic-fail | r2 split: Sonnet tie, Codex Figma better; polish r3 | test/17-canvas-round2.test.js | 388726e |
| CAN-05 | CAN | canvas | pass | r1 pass: 1 revision per multi-edit | test/13-canvas-frames.test.js | d57d328 |
| CAN-06 | CAN | canvas | pass | r1 blind WIN vs Figma; r2 far-zoom strip 11 px | test/17-canvas-round2.test.js | d57d328 |
| CAN-07 | CAN | canvas | pass | r1 pass: exact at 5/30/100% | test/13-canvas-frames.test.js | d57d328 |
| CAN-08 | CAN | canvas | pass | r1 pass | test/13-canvas-frames.test.js | d57d328 |
| LAY-01 | LAY | layout | open |  |  |  |
| LAY-02 | LAY | layout | open |  |  |  |
| LAY-03 | LAY | layout | open |  |  |  |
| LAY-04 | LAY | layout | open |  |  |  |
| LAY-05 | LAY | layout | open |  |  |  |
| LAY-06 | LAY | layout | open |  |  |  |
| LAY-07 | LAY | layout | open |  |  |  |
| LAY-08 | LAY | layout | open |  |  |  |
| LAY-09 | LAY | layout | open |  |  |  |
| LAY-10 | LAY | layout | open |  |  |  |
| LAY-11 | LAY | layout | open |  |  |  |
| CMP-01 | CMP | components | open |  |  |  |
| CMP-02 | CMP | components | open |  |  |  |
| CMP-03 | CMP | components | open |  |  |  |
| CMP-04 | CMP | components | open |  |  |  |
| CMP-05 | CMP | components | open |  |  |  |
| CMP-06 | CMP | components | open |  |  |  |
| CMP-07 | CMP | components | open |  |  |  |
| CMP-08 | CMP | components | open |  |  |  |
| CMP-09 | CMP | components | open |  |  |  |
| CMP-10 | CMP | components | open |  |  |  |
| TOK-01 | TOK | tokens | open |  |  |  |
| TOK-02 | TOK | tokens | open |  |  |  |
| TOK-03 | TOK | tokens | open |  |  |  |
| TOK-04 | TOK | tokens | open |  |  |  |
| TOK-05 | TOK | tokens | open |  |  |  |
| OPN-01 | OPN | open | open |  |  |  |
| OPN-02 | OPN | open | open |  |  |  |
| OPN-03 | OPN | open | open |  |  |  |
| OPN-04 | OPN | open | open |  |  |  |
| AGT-01 | AGT | agents | pass | r2 pass: 10 tools, oneOf schema | test/mcp/schema.test.js | ed6ea70 |
| AGT-02 | AGT | agents | pass | r2 pass: p95 82 ms; 8-way p95 335 ms | docs/evidence/AGT-02.txt | ed6ea70 |
| AGT-03 | AGT | agents | building |  |  |  |
| AGT-04 | AGT | agents | pass | r2 pass (server/MCP); canvas UI later | test/agents/propose.test.js | ed6ea70 |
| AGT-05 | AGT | agents | pass | r3 pass; follow-ups: git attribution, approver in history | test/agents/identity.test.js | ed6ea70 |
| AGT-06 | AGT | agents | pass | r2 pass 100/100 | docs/evidence/AGT-06.txt | ed6ea70 |
| AGT-07 | AGT | agents | pass | r2 pass 16/16; guide = 2.3x fewer turns | docs/evidence/AGT-07.txt | ed6ea70 |
| AGT-08 | AGT | agents | pass | r2 pass; server lock | test/mcp/fallback.test.js | ed6ea70 |
| AGT-09 | AGT | agents | pass | r1 pass (data); UI later | test/agents/attribution.test.js | ed6ea70 |
| AGT-10 | AGT | agents | pass | r1 pass (server); chip UI later | test/agents/attribution.test.js | ed6ea70 |
| AGT-11 | AGT | agents | pass | r3 pass (0005 amendment) | test/agents/identity.test.js | ed6ea70 |
| HIS-01 | HIS | history | open |  |  |  |
| HIS-02 | HIS | history | open |  |  |  |
| HIS-03 | HIS | history | open |  |  |  |
| HIS-04 | HIS | files | critic-pass | r1 pass: sha256 revisions survive restart | test/invariants/revisions.test.js | 93e2d5a |
| HIS-05 | HIS | history | open |  |  |  |
| AST-01 | AST | inspect | open |  |  |  |
| AST-02 | AST | inspect | open |  |  |  |
| AST-03 | AST | inspect | open |  |  |  |
| AST-04 | AST | inspect | open |  |  |  |
| INS-01 | INS | inspect | open |  |  |  |
| INS-02 | INS | inspect | open |  |  |  |
| INS-03 | INS | inspect | open |  |  |  |
| INS-04 | INS | inspect | open |  |  |  |
| INS-05 | INS | inspect | open |  |  |  |
| PRF-01 | PRF | engine | building |  |  |  |
| PRF-02 | PRF | engine | building |  |  |  |
| PRF-03 | PRF | engine | building |  |  |  |
| PRF-04 | PRF | engine | building |  |  |  |
| PRF-05 | PRF | engine | building |  |  |  |
| PRF-06 | PRF | engine | building |  |  |  |
| PRF-07 | PRF | engine | building |  |  |  |
| PRF-08 | PRF | engine | building |  |  |  |
| FMT-01 | FMT | files | critic-pass | r1 pass: cold walk opened editable | docs/dialect.md | 93e2d5a |
| FMT-02 | FMT | files | critic-fail | r1 fail: same as INV-03 | test/invariants/diff-budget.test.js | 93e2d5a |
| FMT-03 | FMT | files | critic-fail | r1 fail: eslint not run (prettier+tsc 0) | test/invariants/format.test.js | 93e2d5a |
| FMT-04 | FMT | files | critic-pass | r1 pass 20/20 | test/invariants/merge.test.js | 93e2d5a |
| FMT-05 | FMT | files | critic-pass | r1 pass 2000/2000 | docs/evidence/FMT-05.txt | 93e2d5a |
| FMT-06 | FMT | files | critic-pass | r1 pass | test/invariants | 93e2d5a |
| FMT-07 | FMT | files | critic-pass | r1 pass 0 lost | test/invariants/live-edit.test.js | 93e2d5a |
| ONB-01 | ONB | onboarding | open |  |  |  |
| ONB-02 | ONB | onboarding | open |  |  |  |
| ONB-03 | ONB | onboarding | open |  |  |  |
| ONB-04 | ONB | onboarding | open |  |  |  |
| ONB-05 | ONB | onboarding | open |  |  |  |
| REL-01 | REL | files | critic-pass | r1 pass 200/200 | docs/evidence/INV-01-REL-01.txt | 93e2d5a |
| REL-02 | REL | files | critic-pass | r1 pass; one lock at merge | test/invariants/lock.test.js | 93e2d5a |
| REL-03 | REL | engine | building |  |  |  |
| REL-04 | REL | engine | building |  |  |  |
| REL-05 | REL | engine | building |  |  |  |
| FEEL-01 | FEEL | canvas | building |  |  |  |
| FEEL-02 | FEEL | canvas | critic-fail | r2 split: Sonnet tie/narrow win, Codex Figma better; polish r3 | test/17-canvas-round2.test.js | 388726e |
| FEEL-03 | FEEL | canvas | pass | r2 pass: axe 0 light+dark | test/14-canvas-look.test.js | d57d328 |
| FEEL-04 | FEEL | canvas | critic-fail | r2 fail: CLS 0.0003-0.01 on variant selection | test/12-canvas-nav.test.js | 388726e |
| FEEL-05 | FEEL | canvas | building |  |  |  |
| SCN-1 | SCN | whole | open |  |  |  |
| SCN-2 | SCN | whole | open |  |  |  |
| SCN-3 | SCN | whole | open |  |  |  |
| SCN-4 | SCN | whole | open |  |  |  |
| SCN-5 | SCN | whole | open |  |  |  |

## Rounds

| Round | Started | Lanes | Builders | Result |
|---|---|---|---|---|
| 1 | 2026-10-21 | files, engine, agents, canvas | Sonnet (files, agents, canvas), Codex (engine) | agents merged (3 critic passes); others in critique |

## New dependencies

| Package | Version | Why | Added in |
|---|---|---|---|

## Spend

| When | ccusage total | Note |
|---|---|---|
| 2026-10-21 start of round 1 | $53.19 today, machine-wide (Claude $47.57, Codex $5.62, Opencode $0.00) | ccusage@20.0.26 daily; includes other sessions on this machine |

## New dependencies (merged)

| Package | Version | Published | Why | Lane |
|---|---|---|---|---|
| axe-core | 4.13.0 | 2026-08-05 | test-only accessibility check for FEEL-03 | canvas |
| Inter, JetBrains Mono (vendored woff2, OFL) | @fontsource-variable 5.2.8 | 2025-09-17 | chrome typefaces that work offline; not an npm dependency | canvas |
