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
| AGT-03 | AGT | agents-ui | pass | r2 critic pass; clears 0.7 s; tags lifted apart | test/agents-ui/presence.test.js | 8a99adb |
| AGT-04 | AGT | agents | pass | r2 pass server + canvas UI (ghost, per-edit accept/reject) | test/agents-ui/proposals.test.js | 8a99adb |
| AGT-05 | AGT | agents | pass | r3 pass; follow-ups: git attribution, approver in history | test/agents/identity.test.js | ed6ea70 |
| AGT-06 | AGT | agents | pass | r2 pass 100/100 | docs/evidence/AGT-06.txt | ed6ea70 |
| AGT-07 | AGT | agents | pass | r2 pass 16/16; guide = 2.3x fewer turns | docs/evidence/AGT-07.txt | ed6ea70 |
| AGT-08 | AGT | agents | pass | r2 pass; server lock | test/mcp/fallback.test.js | ed6ea70 |
| AGT-09 | AGT | agents | pass | data + UI: row in 14 ms, click focuses | test/agents-ui/activity.test.js | 8a99adb |
| AGT-10 | AGT | agents | pass | server + clash chip UI | test/agents-ui/clash.test.js | 8a99adb |
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
| PRF-01 | PRF | engine | pass | critic p50 1097; merged p50 1105 ms | docs/evidence/PRF-01.txt | da57ab8 |
| PRF-02 | PRF | engine | pass | critic p95 <=99.5; merged p95 82.8 ms (thin margin) | docs/evidence/PRF-02.txt | da57ab8 |
| PRF-03 | PRF | engine | pass | critic p95 87.6; merged 87.6 ms | docs/evidence/PRF-03.txt | da57ab8 |
| PRF-04 | PRF | engine | building | builder a1e7e4b: CPU pan at floor (p95 17.1-18.1 vs 17.9, 0-0.3% late); pan+zoom 18.5-19.5; sweep+zoom 20.9-25.4 (3-5% late); GPU raster no better; each zoom step re-rasters world (25-30 ms late frame): last capped round | docs/evidence/PRF-04.txt | a1e7e4b |
| PRF-05 | PRF | engine | pass | merged p95 8.3 ms | docs/evidence/PRF-05.txt | da57ab8 |
| PRF-06 | PRF | engine | pass | merged ratio 0.477 | docs/evidence/PRF-06.txt | da57ab8 |
| PRF-07 | PRF | engine | pass | merged 109 MB / 17 MB heap | docs/evidence/PRF-07.txt | da57ab8 |
| PRF-08 | PRF | engine | pass | merged p95 46.6 ms (thin margin) | docs/evidence/PRF-08.txt | da57ab8 |
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
| REL-03 | REL | engine | pass | worst 208 ms, 0 silent losses | docs/evidence/REL-03.txt | da57ab8 |
| REL-04 | REL | engine | pass | critic soak 1800 s, 0 errors, 9.0% growth (pre-merge code, one seed) | docs/evidence/REL-04.txt | da57ab8 |
| REL-05 | REL | engine | pass | merged 685 ms | docs/evidence/REL-05.txt | da57ab8 |
| FEEL-01 | FEEL | canvas | building | judge after keys + fidelity merge (WPC-15 overflow visible in shots) | docs/evidence/walk-1/FEEL-01.txt | 36daf60 |
| FEEL-02 | FEEL | layout | needs-david | 6 rounds: Sonnet tie; Codex prefers Figma help imagery in both orders | test/23-layout-panel.test.js | a4a87dd |
| FEEL-03 | FEEL | canvas | pass | r2 pass: axe 0 light+dark | test/14-canvas-look.test.js | d57d328 |
| FEEL-04 | FEEL | canvas | pass | r3 pass: CLS 0 over 20 selections + 5 edits | test/12-canvas-nav.test.js | 35cbf5d |
| FEEL-05 | FEEL | canvas | pass | walk 1 pass; keys critic: 15 keys keyboard-only, diff 1 line | docs/evidence/walk-1/FEEL-05.txt | 36daf60 |
| SCN-1 | SCN | whole | pass | walk 1: done cold (open 836 ms, Cmd-K 1.6 s, drag 1.1 s, diff 1 line); needed a hand fix of the doc's Badge (WPC-04, WPC-18) | docs/evidence/walk-1/SCN-1.txt | 36daf60 |
| SCN-2 | SCN | whole | pass | critic walk cold: accept 3/4, rejected value in no file, agent told | docs/evidence/SCN-2.txt | 0085d7f |
| SCN-3 | SCN | whole | pass | critic cold walk: 280x95 canvas and app; merged | docs/evidence/SCN-3.txt | 5707a23 |
| SCN-4 | SCN | whole | pass | walk 1: done, 0 lost edits; stale retry ok; undo only yours | docs/evidence/walk-1/SCN-4.txt | 36daf60 |
| SCN-5 | SCN | whole | pass | walk 1: done in demo (dots, token names, theme across cells) | docs/evidence/walk-1/SCN-5.txt | 36daf60 |
| WPC-01 | WPC | fidelity | pass | critic pass; merged, suite 555/560 0 fail | test/fidelity/cell-isolation.test.js | 5707a23 |
| WPC-02 | WPC | fidelity | pass | critic r2 pass; merged | test/fidelity/cell-isolation.test.js | 5707a23 |
| WPC-03 | WPC | agents | pass | critic pass; suite 538/543 0 fail | test/agents/propose-create.test.js | 0085d7f |
| WPC-04 | WPC | docs | pass | critic pass r1; merged; suite 548/553 0 fail | test/onboarding/docs-examples.test.js | 5c8f4a9 |
| WPC-05 | WPC | docs | pass | critic pass r2: 0 contradictions (2 nits fixed by lead); suite 548/553 0 fail | docs/evidence/onboard2-commands.txt | 5c8f4a9 |
| WPC-06 | WPC | files | pass | critic pass r2: portable ids, .napkin self-ignores, 0 new files until a move; suite 548/553 0 fail | test/onboarding/sample.test.js | 5c8f4a9 |
| WPC-07 | WPC | keys | building | critic r2: Cmd-K reaches ordinary props in <=5 keys; settings defaults, add-prop, variant axes/values, fill/stroke eye+remove, Insert not indexed (11-39 keys): round 3 | docs/evidence/walk-1/ | bb22830 |
| WPC-08 | WPC | keys | critic-pass | critic r2: Ctrl+K Badge Enter = 7 keys, selects root | test/keys/keys.test.js | bb22830 |
| WPC-09 | WPC | agents | pass | critic pass; suite 538/543 0 fail | test/agents/propose-create.test.js | 0085d7f |
| WPC-10 | WPC | docs | pass | critic pass r1; merged; suite 548/553 0 fail | test/history/ui-inspect.test.js | 5c8f4a9 |
| WPC-11 | WPC | keys | critic-pass | critic r2: demo 72 text nodes, min 3.48 light / 3.40 dark, 0 below 3:1 | docs/evidence/walk-1/ | bb22830 |
| WPC-12 | WPC | agents | pass | critic pass; suite 538/543 0 fail | test/agents-ui/propose-create.test.js | 0085d7f |
| WPC-13 | WPC | keys | critic-pass | critic r2: Undo by Enter restores disk; 99 hit-tested dot activations, 0 fail; old dead dot = folded Text section | docs/evidence/walk-1/ | bb22830 |
| WPC-14 | WPC | keys | critic-pass | critic r2: syntax, connection, read-only, invalid and stale messages plain; disk untouched; minor wording notes | docs/evidence/walk-1/ | bb22830 |
| WPC-15 | WPC | keys | critic-pass | critic r2: 1280x720 and 1440x900, both themes, 3 selections: 0 clipped, ellipsis, overlap | docs/evidence/walk-1/ | bb22830 |
| WPC-16 | WPC | fidelity | pass | critic r2 pass; merged | test/fidelity/broken-line.test.js | 5707a23 |
| WPC-17 | WPC | docs | pass | critic pass r1; merged; suite 548/553 0 fail | test/onboarding/demo-cleanup.test.js | 5c8f4a9 |
| WPC-18 | WPC | docs | pass | critic pass r2: sample looks real; S1 1-line diff; suite 548/553 0 fail | test/onboarding/sample.test.js | 5c8f4a9 |
| WPC-19 | WPC | agents | pass | critic pass + follow-ups (no trace in opened repos, tmp sweep, missed answers, all ghosts in view); suite 566/571 0 fail | test/agents/agents3.test.js | 4d2cdf6 |
| WPC-20 | WPC | agents | pass | critic pass + follow-ups (no trace in opened repos, tmp sweep, missed answers, all ghosts in view); suite 566/571 0 fail | test/agents/agents3.test.js | 4d2cdf6 |
| WPC-21 | WPC | agents | pass | critic pass + follow-ups (no trace in opened repos, tmp sweep, missed answers, all ghosts in view); suite 566/571 0 fail | test/agents-ui/agents3.test.js | 4d2cdf6 |
| WPC-22 | WPC | agents | pass | critic pass + follow-ups (no trace in opened repos, tmp sweep, missed answers, all ghosts in view); suite 566/571 0 fail | docs/evidence/agents3-ghost.png | 4d2cdf6 |

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
| 2026-10-22, after the agents-ui merge | $276.43 total since 2026-10-21, machine-wide ($8.06 so far on 10-22) | same command; Opencode free models $0.00 |

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
- WPC-04 scope: docs/decisions/*.md are dated design records and are excluded from "every TSX example in docs/" (0003 shows an elided sketch).
- PRF-04 measure (pending David): on this machine (headless, CPU raster) even a trivial compositor-only page reads raw p95 ~18.2 ms from symmetric presentation-timestamp jitter, so the bar is read as p95 in whole vsyncs <= 16.7 ms with <= 2% missed or dropped frames. The bar text in DREAM.md is unchanged; David decides whether to accept this reading.

## Incidents

- 2026-10-21: /tmp (tmpfs, 1,048,576 inodes) filled with ~14,400 leaked `/tmp/napkin-*` test folders while 4-6 suites ran in parallel; every shell on the machine failed with ENOSPC. David approved deleting `/tmp/napkin-*`. Fix on feat/core (65cc4c9): a cleanup preload for every test process and child, Chromium profile removal for dead owners, a pretest sweep. Rule from now on: at most 2 full suites at once. Three critics (agents-ui, tokens, LAY-10) were stopped and are re-run one at a time.
- 2026-10-21: Codex hit its usage limit (until 6:07 PM) right after finishing the tokens lane; the engine rebase moves to a Sonnet builder.
