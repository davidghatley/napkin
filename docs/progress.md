# Progress ledger

Live status of every DREAM.md criterion. Updated by the lead (Claude, Opus) after each critic verdict and merge. Status: open / building / critic-fail / pass / unverifiable.

Status "critic-pass" = a critic passed it on its branch; "pass" = merged into feat/core with the full suite green.

Lanes are groups of areas that share files, so parallel builders don't collide. Round 1 lanes: files, engine, agents, canvas.

| ID | Area | Lane | Status | Last critic verdict | Evidence | Commit |
|---|---|---|---|---|---|---|
| INV-01 | INV | files | pass | r5 pass: 500 + 200 race trials, 0 hand saves lost; broken files refused | test/invariants/broken-file.test.js | 9179fbb |
| INV-02 | INV | files | pass | r5 pass on hand files H-K + 40/40 corpus | test/invariants/noop.test.js | 9179fbb |
| INV-03 | INV | files | pass | r6 PASS: comments survive all ops; 0 over budget (13 seeds) | test/invariants/diff-budget.test.js | 9e66f9d |
| INV-04 | INV | files | pass | r5 pass | test/invariants/readonly.test.js | 9179fbb |
| INV-05 | INV | files | pass | r5 pass: spy covers unlink/rm/fd writes; commit.js only writer | test/invariants/one-path.test.js | 9179fbb |
| INV-06 | INV | files | pass | r1 pass | test/invariants/standalone.test.js | 9179fbb |
| CAN-01 | CAN | canvas | pass | r1 pass: drift 1e-11 px | test/12-canvas-nav.test.js | d57d328 |
| CAN-02 | CAN | canvas | pass | r2 pass: atomic sidecar, identity | test/16-canvas-endpoint.test.js | d57d328 |
| CAN-03 | CAN | canvas | pass | r1 pass: p95 0.8 ms; flight 282 ms | test/13-canvas-frames.test.js | d57d328 |
| CAN-04 | CAN | layout | pass | r4 Sonnet tie; Codex order-dependent (flips when swapped) = tie | test/17-canvas-round2.test.js | a4a87dd |
| CAN-05 | CAN | canvas | pass | r1 pass: 1 revision per multi-edit | test/13-canvas-frames.test.js | d57d328 |
| CAN-06 | CAN | canvas | pass | r1 blind WIN vs Figma; r2 far-zoom strip 11 px | test/17-canvas-round2.test.js | d57d328 |
| CAN-07 | CAN | canvas | pass | r1 pass: exact at 5/30/100% | test/13-canvas-frames.test.js | d57d328 |
| CAN-08 | CAN | canvas | pass | r1 pass | test/13-canvas-frames.test.js | d57d328 |
| LAY-01 | LAY | layout | pass | r2 pass: matrix with axis arrow | test/22-*.test.js | a4a87dd |
| LAY-02 | LAY | layout | pass | r1 pass 12/12 (critic's own cases) | test/20-*.test.js | a4a87dd |
| LAY-03 | LAY | layout | pass | r1 pass (gridArea, 1 line) | test/21-*.test.js | a4a87dd |
| LAY-04 | LAY | layout | pass | r1 pass 8/8; pins change several inset lines in 1 revision (lead ruling) | test/20-*.test.js | a4a87dd |
| LAY-05 | LAY | layout | pass | r1 pass: 1 rev/gesture, p95 16.7-16.8 ms | docs/evidence/LAY-05.txt | a4a87dd |
| LAY-06 | LAY | layout | pass | r3 pass: grid quantizes at 7 zooms, 84 drags | test/canvas/snap.test.js | a4a87dd |
| LAY-07 | LAY | layout | pass | r2 pass: no truncation | test/23-layout-panel.test.js | a4a87dd |
| LAY-08 | LAY | layout | pass | r2 pass; bug: colour edit rewrites alpha (fixing) | test/22-*.test.js | a4a87dd |
| LAY-09 | LAY | layout | pass | r1 pass: pasted subtree byte-identical render | test/18-*.test.js | a4a87dd |
| LAY-10 | LAY | layout | pass | r7 PASS: 225 pastes x 5 contexts, 0 approximations; checks what is stored | test/24-html-paste.test.js | 82755e7 |
| LAY-11 | LAY | layout | pass | r1 pass: sidecar only, sha unchanged | test/21-*.test.js | a4a87dd |
| CMP-01 | CMP | components | pass | r2 table redesign: Sonnet WIN; Codex napkin better both orders | test/25-components-panel.test.js | 9e66f9d |
| CMP-02 | CMP | components | pass | r1 pass: rename 2/2 lines | test/25-components-panel.test.js | 9e66f9d |
| CMP-03 | CMP | components | pass | r1 blind WIN: Sonnet + Codex both orders | test/25-components-panel.test.js | 9e66f9d |
| CMP-04 | CMP | components | pass | r1 pass: consumer app both states | test/27-*.test.js | 9e66f9d |
| CMP-05 | CMP | components | pass | r1 pass: sidecar-only preview | test/27-*.test.js | 9e66f9d |
| CMP-06 | CMP | components | pass | r1 pass: Button edit → Cards 77 ms median | test/27-*.test.js | 9e66f9d |
| CMP-07 | CMP | components | pass | r1 pass | test/27-*.test.js | 9e66f9d |
| CMP-08 | CMP | components | pass | r1 pass: consumer app pixel diff 0 | test/27-*.test.js | 9e66f9d |
| CMP-09 | CMP | components | pass | r1 pass: toggle 12-15 ms | test/26-*.test.js | 9e66f9d |
| CMP-10 | CMP | components | pass | r1 pass ≤2 actions; frames overlap (fixing) | test/26-*.test.js | 9e66f9d |
| TOK-01 | TOK | tokens | pass | r1 pass: fixture 20/20; real secret-sauce shape 92 tokens | test/tokens/source.test.js | 8625ada |
| TOK-02 | TOK | tokens | pass | r1 pass: 1-line var(); consumer app 0 px diff | test/tokens/consumer.test.js | 8625ada |
| TOK-03 | TOK | tokens | pass | r1 pass 10/10 flagged; fixing bare-0 false positive | test/tokens/*.test.js | 8625ada |
| TOK-04 | TOK | tokens | pass | r1 pass: p50 55 ms, max 72 ms at 200 comps | docs/evidence/TOK-04.txt | 8625ada |
| TOK-05 | TOK | tokens | pass | r1 pass: 1/1 diff; 55 ms p50 | docs/evidence/TOK-05.txt | 8625ada |
| OPN-01 | OPN | open | pass | r2 pass: real causes + lines; "missing const base" wording | test/onboarding/open.test.js | ec22ab6 |
| OPN-02 | OPN | open | pass | r2 pass: errors contained, 0 overflow | docs/evidence/OPN-02-missing.png | ec22ab6 |
| OPN-03 | OPN | open | pass | r2 pass; converter formatting gap | test/onboarding/fix-round.test.js | ec22ab6 |
| OPN-04 | OPN | open | pass | r2 0/61 editable; address in 223 ms on 3674 files | docs/evidence/OPN-04.txt | ec22ab6 |
| AGT-01 | AGT | agents | pass | r2 pass: 10 tools, oneOf schema | test/mcp/schema.test.js | ed6ea70 |
| AGT-02 | AGT | agents | pass | r2 pass: p95 82 ms; 8-way p95 335 ms | docs/evidence/AGT-02.txt | ed6ea70 |
| AGT-03 | AGT | agents-ui | critic | r2 fixes: dock tray, ttl cap, 24px names | test/agents-ui/presence.test.js | c033a57 |
| AGT-04 | AGT | agents | pass | r2 pass (server/MCP); canvas UI later | test/agents/propose.test.js | ed6ea70 |
| AGT-05 | AGT | agents | pass | r3 pass; follow-ups: git attribution, approver in history | test/agents/identity.test.js | ed6ea70 |
| AGT-06 | AGT | agents | pass | r2 pass 100/100 | docs/evidence/AGT-06.txt | ed6ea70 |
| AGT-07 | AGT | agents | pass | r2 pass 16/16; guide = 2.3x fewer turns | docs/evidence/AGT-07.txt | ed6ea70 |
| AGT-08 | AGT | agents | pass | r2 pass; server lock | test/mcp/fallback.test.js | ed6ea70 |
| AGT-09 | AGT | agents | pass | r1 pass (data); UI later | test/agents/attribution.test.js | ed6ea70 |
| AGT-10 | AGT | agents | pass | r1 pass (server); chip UI later | test/agents/attribution.test.js | ed6ea70 |
| AGT-11 | AGT | agents | pass | r3 pass (0005 amendment) | test/agents/identity.test.js | ed6ea70 |
| HIS-01 | HIS | history | pass | r2 pass: 5 fast undos; precise conflicts; skip | test/history/undo.test.js | 0494065 |
| HIS-02 | HIS | history | pass | r1 pass 100/100 | test/history/undo.test.js | 0494065 |
| HIS-03 | HIS | history | pass | r2 pass: restore confirm names who is overwritten | test/history/ui-history.test.js | 0494065 |
| HIS-04 | HIS | files | pass | r5 pass: hash revisions survive restart | test/invariants/revisions.test.js | 9179fbb |
| HIS-05 | HIS | history | pass | r2 pass: stash = git; hand edits = file | test/history/git.test.js | 0494065 |
| AST-01 | AST | history | pass | r2 pass; new img in single-quote file uses double quotes (minor) | test/history/assets.test.js | 0494065 |
| AST-02 | AST | history | pass | r1 pass | test/history/assets.test.js | 0494065 |
| AST-03 | AST | history | pass | r1 pass | test/history/assets.test.js | 0494065 |
| AST-04 | AST | history | pass | r1 pass | test/history/assets.test.js | 0494065 |
| INS-01 | INS | history | pass | r1 pass: 5-22 ms | test/history/ui-inspect.test.js | 0494065 |
| INS-02 | INS | history | pass | r1 pass: 717 rows, 0 differ | test/history/ui-inspect.test.js | 0494065 |
| INS-03 | INS | history | pass | r2 pass: 100/100 byte-identical | test/history/ui-inspect.test.js | 0494065 |
| INS-04 | INS | history | pass | r2 Sonnet WIN; Codex napkin better both orders; read-only verified | test/history/docs.test.js | 0494065 |
| INS-05 | INS | history | pass | r1 pass | test/history/visual-diff.test.js | 0494065 |
| PRF-01 | PRF | engine | critic | builder: p50 1043 ms |  | da7ddc3 |
| PRF-02 | PRF | engine | critic | builder: p95 74.6 ms |  | da7ddc3 |
| PRF-03 | PRF | engine | critic | builder: p95 92.9 ms |  | da7ddc3 |
| PRF-04 | PRF | engine | critic | builder: p95 16.8 ms (bar 16.7, miss by one tick) |  | da7ddc3 |
| PRF-05 | PRF | engine | critic | builder: p95 7.9 ms |  | da7ddc3 |
| PRF-06 | PRF | engine | critic | builder: 0.49x |  | da7ddc3 |
| PRF-07 | PRF | engine | critic | builder: 129/18 MB |  | da7ddc3 |
| PRF-08 | PRF | engine | critic | builder: p95 38.8 ms |  | da7ddc3 |
| FMT-01 | FMT | files | pass | r1 pass: cold walk | docs/dialect.md | 9179fbb |
| FMT-02 | FMT | files | pass | r6 PASS: table + hand files | test/invariants/diff-budget.test.js | 9e66f9d |
| FMT-03 | FMT | files | pass | r2 pass: prettier(singleQuote)+tsc+eslint 0 | test/invariants/format.test.js | 9179fbb |
| FMT-04 | FMT | files | pass | r1 pass 20/20 | test/invariants/merge.test.js | 9179fbb |
| FMT-05 | FMT | files | pass | r5 pass: FUZZ=2000 via store | test/invariants/fuzz-store.test.js | 9179fbb |
| FMT-06 | FMT | files | pass | r1 pass | test/invariants | 9179fbb |
| FMT-07 | FMT | files | pass | r5 pass: 0 lost | test/invariants/live-edit.test.js | 9179fbb |
| ONB-01 | ONB | open | pass | r2 pass: first render 571 ms cold | test/onboarding/readme.test.js | ec22ab6 |
| ONB-02 | ONB | open | pass | r2 tie vs Paper canvas craft (no Paper empty-state ref) | docs/evidence/ONB-02-empty.png | ec22ab6 |
| ONB-03 | ONB | open | pass | r1 pass 20/20 handlers | test/onboarding/shortcuts.test.js | ec22ab6 |
| ONB-04 | ONB | open | pass | r1 pass with gaps (syntax-error next step, jargon) | test/onboarding/errors.test.js | ec22ab6 |
| ONB-05 | ONB | open | pass | r1 pass: README as written; MCP snippet connects | test/onboarding/readme.test.js | ec22ab6 |
| REL-01 | REL | files | pass | r2 pass 50/50 + INV-01 kills | test/invariants/truth.test.js | 9179fbb |
| REL-02 | REL | files | pass | r5 pass: one lock | test/invariants/lock.test.js | 9179fbb |
| REL-03 | REL | engine | critic | builder: worst 204 ms, 0 losses |  | da7ddc3 |
| REL-04 | REL | engine | critic | builder: 12.4% RSS, 0 errors |  | da7ddc3 |
| REL-05 | REL | engine | critic | builder: 667 ms |  | da7ddc3 |
| FEEL-01 | FEEL | canvas | building |  |  |  |
| FEEL-02 | FEEL | layout | needs-david | 6 rounds: Sonnet tie; Codex prefers Figma help imagery in both orders | test/23-layout-panel.test.js | a4a87dd |
| FEEL-03 | FEEL | canvas | pass | r2 pass: axe 0 light+dark | test/14-canvas-look.test.js | d57d328 |
| FEEL-04 | FEEL | canvas | pass | r3 pass: CLS 0 over 20 selections + 5 edits | test/12-canvas-nav.test.js | 35cbf5d |
| FEEL-05 | FEEL | canvas | building |  |  |  |
| SCN-1 | SCN | whole | open |  |  |  |
| SCN-2 | SCN | whole | open |  |  |  |
| SCN-3 | SCN | whole | open |  |  |  |
| SCN-4 | SCN | whole | open |  |  |  |
| SCN-5 | SCN | whole | open |  |  |  |

## Rounds

| Round | Started | Lanes | Builders | Result |
|---|---|---|---|---|
| 1 | 2026-10-21 | files, engine, agents, canvas | Sonnet (files, agents, canvas), Codex (engine) | agents + canvas merged; files fixing; engine to rebase |
| 2 | 2026-10-21 | layout, history (+inspect, assets), open (+onboarding) | Sonnet (layout, history), Codex (open) | all merged; FEEL-02 to David; LAY-10 redesign in critique |
| 3 | 2026-10-21 | agents-ui, tokens, files (0004 core), components (UI), engine (rebase) | Sonnet (agents-ui, files, components, engine), Codex (tokens) | running |

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
| 2026-10-21 mid round 2 | $103.21 today, machine-wide (Claude $93.72, Codex $9.48, Opencode $0.00); about $50 since round 1 began | ccusage@20.0.26 daily |

## Lead rulings during the build (within David's go-ahead)

- FMT-03: prettier "default config" means default plus `singleQuote: true`, because the dialect (decision 0003) and every fixture use single quotes.
- LAY-03: one `gridArea: 'row / col'` line per placement meets "1 line per placement".
- LAY-04: a pin change may write several inset lines in one revision (pinning is a compound change).
- LAY-06: the grid quantizes positions in parent-local coordinates at any zoom; edge and centre snaps within 4 screen px take priority.
- Blind bars: two judges from different model families (Sonnet, Codex). Codex runs twice with the image order swapped; a verdict that flips counts as a tie. A row passes only when both judges give a win or tie.
- 0005 amendment: with an `agents` key in napkin.json, unlisted names default to read; Host/Origin guard on every route.

## Incidents

- 2026-10-21: /tmp (tmpfs, 1,048,576 inodes) filled with ~14,400 leaked `/tmp/napkin-*` test folders while 4-6 suites ran in parallel; every shell on the machine failed with ENOSPC. David approved deleting `/tmp/napkin-*`. Fix on feat/core (65cc4c9): a cleanup preload for every test process and child, Chromium profile removal for dead owners, a pretest sweep. Rule from now on: at most 2 full suites at once. Three critics (agents-ui, tokens, LAY-10) were stopped and are re-run one at a time.
- 2026-10-21: Codex hit its usage limit (until 6:07 PM) right after finishing the tokens lane; the engine rebase moves to a Sonnet builder.
