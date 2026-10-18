# napkin landing copy: notes

Brief: `~/Projects/.kitchen/BRIEF-copy.md` (stage 1). Written 2026-10-18 by the copywriter agent while David was away, so the judgement calls below were made without asking him. Sources read: INTENT.md, README.md, STACK.md, CLAUDE.md, docs/salvage.md, research/ (only a README so far, no notes), fridge/TASTE.md (skimmed) and secret-sauce/README.md.

## Stage 2 edit (2026-10-18)

Edited by the stage 2 editor agent (Claude) against `BRIEF-copy.md` and the orchestrator's decisions. Copy went from 1042 to 883 words (15% cut). The stage 1 notes below are kept as history; where they disagree with this section, this section wins.

| Rubric line | Before (editor's score) | After | Why it moved |
|---|---|---|---|
| 5-second test | 4 | 4 | The hero was already the strongest of the five, so it stays. "Components" is still assumed knowledge for the Dive Club reader. |
| Benefit-first | 4 | 5 | "Design every version at once" became "Change every version at once", which names what the reader gets. Sentences now open on the reader. |
| Concrete | 5 | 5 | Typed request, 9 versions, radius 8 to 12, Card scene. |
| Plain | 4 | 4 | "Design tokens" is gone from the FAQ ("shared colours and spacing"). MCP keeps its gloss. |
| Honest | 4 | 5 | The status note now reads "Planned. Follow along.", matching INTENT's "Not starting now". The demo label matches the other pages. "A few seconds later" (a soft invented time) became "Soon". |
| Distinct | 4 | 4 | No change. |

Changes:
1. Status note: "Planned. Follow along." (orchestrator decision, resolves stage 1 judgement call 2 and gap 7). "Not for" now says "You need a tool this year. napkin is planned for later."
2. "How it fits" uses the canonical one-liners in `~/Projects/.kitchen/one-liners.md`, verbatim. This replaces the stage 1 line about other tools picking up napkin's files, which INTENT doesn't state for any tool except agents.
3. Cut a colon-then-list reveal in the Paper FAQ and an "X, not Y" in a hero rationale. "Your AI helper" became "Your AI agent" to match the other pages. Trimmed every section. The "Can I try it today?" FAQ moved to the end, as on the other pages.

## Judgement calls (David to confirm)

1. **CTAs: "Watch it get built" and "Read the plan".** I didn't use "Star on GitHub" because the repo has no remote and CLAUDE.md forbids publishing without approval. "Read the plan" should link to INTENT.md once it is public.
2. **Status is stronger than "In build".** INTENT says napkin is Phase 4 and that only research, spec and spikes happen until then. The hero keeps the brief's "In build. Follow along." note, but the FAQ says plainly that it is a plan with small experiments. If David thinks "In build" overstates it, swap in "Planned. Follow along."
3. **No framework or file format is named.** The document model (HTML-first vs a component AST) is an open decision, so the copy says "real code file" and "component file" and never `.tsx`, React or Vue. The `git diff` example names "the Card file" without an extension.
4. **Undo, attribution and conflict handling come only from salvage.md, not INTENT.** So the copy promises undo only through git ("files on disk, diffable, versionable"), and the conflict FAQ says the design isn't settled.
5. **"Open source" is not promised.** STACK.md says "open, modular agent stack", so the copy says "planned as part of an open, modular stack" and that the licence isn't chosen yet.
6. **"A few seconds later" in the demo, not "Ten seconds later".** A specific time would be an invented metric. The scene is labelled as the target demo.
7. **The pun is used once.** "Sketch it on a napkin" was a hero option and was rejected, because it suggests a whiteboard, which INTENT rules out. The page has no cooking pun, since "napkin" isn't a cooking word in this stack's theme anyway.
8. **"components" stays in the headline.** Dive Club readers know the word, and the subhead grounds it right away for a 12-year-old ("the same button").
9. **The name is a placeholder** (per INTENT). The copy uses "napkin" lowercase in running text, as the repo does, and "Napkin" at the start of sentences.

## Round history

### Draft 1 (key lines)
- Hero: "The component canvas for humans and agents" / "Napkin is a Paper-like canvas with real HTML/CSS, variants, props and tokens, where agents and people co-edit component files over MCP."
- Problem: "Design tools treat components as an afterthought, and agents can't see the canvas."
- Benefits: "Live co-editing", "First-class variants and props", "Files are the source of truth".
- How it works: 1 Connect your repo, 2 Invite your agent, 3 Ship components.
- Demo: "An agent and you edit the same component live, and the result is a reusable component file."
- FAQ had 4 questions and no answer on the file format.
- Footer: "Paper-like component canvas, co-edited by agents and humans, files on disk as truth."

| Rubric | Score | Weakest lines |
|---|---|---|
| 5-second test | 2 | "component canvas for humans and agents" names a category, not a reason to care |
| Benefit-first | 2 | All three benefit titles name features ("First-class variants and props") |
| Concrete | 2 | No typed sentences, no numbers. The demo restates INTENT instead of a scene |
| Plain | 1 | The subhead has HTML/CSS, props, tokens, co-edit and MCP above the fold |
| Honest | 3 | "Ship components" and "Connect your repo" imply it works now. Status is buried |
| Distinct | 3 | "for humans and agents" is how every agent tool describes itself |

### Round 2 (changes)
- Hero became "Design components side by side with your agent" / "A design canvas where you and an AI agent edit the same component live, saved as files you own."
- Benefit titles were rewritten as outcomes: "Work on it together", "Design every version at once", "Keep plain files you own".
- Added a typed request ("add a disabled state to this button") and the 3 sizes x 3 states = 9 versions example.
- How-it-works steps became "Start a component / Edit it together / Keep the file". I dropped "Connect your repo" because INTENT doesn't define it.
- The demo was rewritten as a scene with the Card and a typed request, and labelled as the target.
- MCP moved out of the hero into how-it-works and the FAQ, with a five-word gloss.
- Added the "In build. Follow along." note and the "Can I use it today?" FAQ.

| Rubric | Score | Weakest lines |
|---|---|---|
| 5-second test | 4 | The subhead's "live" is vague, and "files you own" is abstract |
| Benefit-first | 4 | "Design every version at once" is fine, but its sentence opened with the word "variants" |
| Concrete | 4 | The files benefit had no example |
| Plain | 3 | How-it-works step 2 said "over MCP" with no gloss, and the FAQ said "AST" |
| Honest | 4 | Footer said "files on disk as truth", which is jargon |
| Distinct | 4 | Fine. The Card-and-git-diff detail makes it specific |

### Round 3 (changes, final)
- Subhead: "the same button at once. Every change saves to a real code file." This uses a concrete object and a concrete outcome in 23 words.
- The files benefit gained a `git diff` example (radius 8 to 12 in the Card file).
- The variants sentence was rewritten in plain words ("sizes, states and settings").
- Step 2 now says "napkin's agent connection". MCP is explained only in the FAQ ("a standard plug for agent tools").
- "AST" became "a structured component format".
- Added FAQs on the file format, conflicts and open source, for 6 in all.
- The footer was rewritten in plain words (95 characters). Stage 2 made it "napkin is a planned design canvas..." (117 characters).
- "Napkin does components well" became "Napkin focuses on components" because nothing has been proved yet.
- I checked for banned words, em dashes and en dashes and found none. I also checked for "not X, but Y" and colon reveals. The "Not for" bullets state limits outright and don't contrast with a reveal.

| Rubric | Score | Note |
|---|---|---|
| 5-second test | 5 | "You and an AI agent edit the same button at once, and it saves as real code" can be repeated back |
| Benefit-first | 4 | Each title is an outcome. "Design every version at once" is the closest to a feature |
| Concrete | 5 | Two typed sentences, 9 versions, radius 8 to 12, and the Card scene |
| Plain | 4 | Nothing technical above the fold. "Component" is assumed knowledge for this audience |
| Honest | 5 | The status note, the target-demo label, the "Can I use it today? No." FAQ and the open decisions are stated |
| Distinct | 4 | The shared canvas, file-on-disk and git-diff details set it apart from a generic AI page |

Every rubric line scores 4 or higher after round 3. That was 2 revision rounds after draft 1.

## Promises checklist

Each promise is matched to the INTENT line that supports it. Later stages turn these into docs and features.

- [ ] **Design canvas with real HTML/CSS on it** → "real HTML/CSS on the canvas" (What it is #1)
- [ ] **You and an AI agent edit the same component at the same time, seeing each other's edits** → "agents read and write the same documents David edits, live" (#2) and the proving demo
- [ ] **Every change saves to a real code file** → "Files on disk are the source of truth" (#3) and the demo's "real, reusable component file"
- [ ] **A component holds its sizes, states and settings (variants and props)** → "optimized for components (variants, props, tokens)" (#1)
- [ ] **A change to the base reaches every variant** → interpretation of "optimized for components (variants)". *Flag: INTENT doesn't spell out inheritance. Kept because a variant system implies it, but the spec stage must confirm it.*
- [ ] **Uses your colours and spacing (design tokens)** → "Reads/writes ... design tokens (from secret-sauce)" (Interface)
- [ ] **Files live in your project folder, and you can diff, review and undo with git** → "Files on disk ... (diffable, versionable)" (#3)
- [ ] **The agent can draft a component from a typed request** → "Agent-editable: agents read and write" (#2)
- [ ] **The component is reusable in other screens** → proving demo "real, reusable component file"
- [ ] **Agent connection through an API and an MCP server** → "Exposes an API/MCP surface for agents" (Interface)
- [ ] **Agents that speak MCP should be able to connect** → same line. The copy hedges with "should".
- [ ] **Different from Paper because it focuses on components** → "optimized for components ... where Paper is weak" (#1)
- [ ] **Won't copy every Figma feature** → "Not a Figma clone with every feature" (is not)
- [ ] **Not a whiteboard** → "Not a whiteboard" (is not)
- [ ] **Planned, not usable yet; currently research, a plan and small experiments** (status note "Planned. Follow along.", FAQ, Not for) → "Not starting now: Phase 4 ... research, spec, and tiny spikes only"
- [ ] **The file format is undecided** → Open decisions: "Document model (HTML-first vs a component AST)"
- [ ] **How conflicts are handled is undecided** → no INTENT line. It is stated as an open problem, not a promise.
- [ ] **One of five tools, described with the canonical one-liners** (How it fits) → STACK.md. Background only. (Stage 2 cut the claim that the other tools pick up napkin's files.)
- [ ] **Open source is the plan; no licence chosen; code not public** (FAQ) → STACK.md ("one open, modular agent stack"). *Flag: "open" comes from STACK, not INTENT.*
- [ ] **Target demo: the Card gets a compact variant from a typed request while you edit the title, and both land in one file** → proving demo. The scene is an illustration of it.

Total (after stage 2): **20 promises**. 17 trace directly to INTENT, 1 is an interpretation (variant inheritance) and 2 rest on STACK.md ("open", the set of five). All three are flagged above.

### Cut for lack of INTENT support
- "Connect your repo" or importing an existing codebase's components (draft 1). INTENT says nothing about importing.
- "Ship components" (draft 1). It implies production output now.
- Attributed edits and agent undo history. These come from salvage.md (INV-03/04), not INTENT.
- Named frameworks (React, Vue) and file extensions. These are open decisions.
- "Star on GitHub". There is no public repo.

## INTENT gaps found

1. **Conflicts.** INTENT doesn't say what happens when David and an agent edit the same property. The demo depends on it, and the copy can only call it unsettled.
2. **Undo and attribution.** salvage.md calls these "the good idea", but INTENT doesn't list them. They'd make strong benefit copy if David adopts them.
3. **Variant inheritance.** It isn't stated. It needs confirming in the spec.
4. **Importing existing components.** It's unclear whether napkin opens components already in a repo or only ones it created.
5. **Who the user is.** INTENT is written around David ("David edits"), and it doesn't say whether napkin is for other people. The landing page assumes outside users.
6. **Licence and openness.** These are only implied by STACK.md.
7. **Status wording.** "In build" (the brief) conflicts slightly with "Not starting now" (INTENT). See judgement call 2.
