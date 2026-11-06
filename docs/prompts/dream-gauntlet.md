# Dream gauntlet: napkin

A long-running prompt for a fresh Claude Code session, opened in `~/Projects/.worktrees/napkin-core` (branch `feat/core`).

It builds on Matt Shumer's gauntlet loop (the Claude of Duty prompt, github.com/mshumer/Claude-of-Duty). That prompt sets a real reference, fans out subagents, and gives each piece a harsh blind critic, looping until the piece wins a side-by-side comparison. That was for a game. This version first writes the dream (napkin as finished, fully featured software) and then loops builders against critics until every dream criterion passes.

Paste everything between the lines.

---

```text
napkin is a local, Paper-like design canvas built for components. The components are real React TSX files: you and your agents edit the same file live, and an app imports it as-is. The first build is done on feat/core: 52 tests, a proving demo, and docs/demo/. Read INTENT.md, FEATURES.md, README.md, docs/decisions/ (0002 single authority, 0003 TSX dialect), test/CONTRACT.md and docs/demo/demo-log.txt before anything else.

PHASE 1: DREAM. Don't write code yet.
Dream up napkin's ideal end state: the finished, fully featured product a design engineer would pick over Paper (paper.design) and over Figma's components/variants for building a component library with agents. Write it to docs/DREAM.md:
- The experience, as a few concrete scenes ("I open a repo of 40 components and…"), and what makes it beautiful and fast to use, not only correct.
- Every feature area: canvas and navigation, drawing and layout (auto-layout, constraints, grids), components (props, variants, slots, instances, composition), tokens and themes (synced with the codebase), opening existing repos' components, agents (MCP, presence, review/accept of agent edits), history and undo, assets, inspection and handoff, performance, file format and diffs, onboarding, and anything else a finished product needs.
- For each area, DREAM QUALITY CRITERIA that are pass/fail and checkable by someone who never saw the code. Each criterion names its evidence (a test, a screenshot, a timing, a git diff) and its bar. A bar is either a number ("any edit appears in <100 ms on 200 components", "a one-property change is a one-line diff") or a named, fetchable real reference to compare blind against (Paper's canvas, Figma's variant panel, Framer's layout controls, Storybook's props table).
- What napkin will never be, so the loop doesn't wander.
Keep these invariants in every criterion: files are the truth; a save with no change is byte-identical; small edits give small diffs; out-of-dialect files open read-only, never silently rewritten; there's one commit path with revisions and stale rejection; the components have no runtime dependency on napkin.
Anything that contradicts INTENT.md (for example hosting or multiplayer) goes in a section "Needs David" and is not built. Then stop and show me DREAM.md and the area list. Wait for my go before Phase 2.

PHASE 2: GAUNTLET.
Turn DREAM.md into a ledger at docs/progress.md: one row per criterion, with area, status (open / building / critic-fail / pass), last critic verdict, evidence path and commit. Keep it live so I can watch.
Fan out subagents. Each area gets a BUILDER in its own git worktree under ~/Projects/.worktrees/napkin-<area>, branched from feat/core. The builder works through its area's criteria with tests first, and stays inside the dialect and the contract tests.
Each area also gets a separate CRITIC subagent in a fresh context. It never sees the builder's reasoning, plan or messages, only the running app, the files, the diff, and the evidence the criterion names. It is harsh. Where the bar is a reference, it captures napkin and the reference the same way (headless Chromium via test/helpers/cdp.js, same viewport, labels and logos stripped), compares them blind, and says which is better and why. Where the bar is a number, it measures that number itself. It returns a verdict for each criterion (pass / fail) with concrete gaps. A fail goes back to the builder as the next task. /loop on each item. A criterion passes only when a critic, in a fresh context, is genuinely wowed, or the work wins or ties the blind comparison and every number holds.
After each pass, I (the lead) re-run the full suite plus the area's new tests, merge the area into feat/core (resolving conflicts, keeping the whole suite green), and update progress.md. A merge that breaks any earlier criterion reopens it.
Every few rounds, run a whole-product critic: a fresh agent uses napkin end to end the way the DREAM.md scenes describe, and files new gaps as criteria.

Don't stop until every criterion in DREAM.md passes, or until I stop you. I'm the brake. /loop until it's done.

House rules:
- Local only. Never push or add remotes. Stage files by name, never `git add -A`. Ask before deleting anything, before any sudo, before downloads over 10 GB, and before touching other repos.
- INTENT.md changes only with my agreement. Put proposed changes in DREAM.md under "Needs David".
- New npm dependencies must be pinned exact, at least two weeks old, installed with --save-exact --ignore-scripts, and each one needs a line of justification in progress.md.
- Budget: builders and most critics run on Sonnet. Keep Opus for the dream, the lead, merges and the whole-product critic. Check `ccusage` every few rounds and log the spend in progress.md.
- No job titles for me anywhere in the product or docs.
- Report honestly. A criterion that can't be checked is "unverifiable", not "pass". Paste the failing output when a test fails.
```

---

How to start:

1. `cd ~/Projects/.worktrees/napkin-core && claude`
2. Paste the prompt. It stops after Phase 1 so you can edit DREAM.md before anything is built.
3. To watch progress, open docs/progress.md.
