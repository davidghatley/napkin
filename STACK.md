# The stack (shared context, identical in every repo)

David is building one open, modular agent stack for generative building, proved by a game generator.
Strategy manual: "Ship's Heading" (private artifact https://claude.ai/artifact/JE6JzM5Ux9vjAgFZQG6Yr7).
Names are placeholders as of 2026-10-17.

```
 prompt ─► mise_en_place ─► nibble ─► bonfire ─► playdough ─► playable link
           prep folder      choices    runs loops   the game     (shared publicly)
                                         │
                                       napkin  (design surface, later)
```

| Repo | Role | Hands to the next layer |
|---|---|---|
| mise_en_place | Prep, for any project or task: does the research, generates the assets, gathers references and context, and organizes it all. Ships nothing premade | a **prep folder** with an index (what each item is, its source, what's open) |
| nibble | Decide: fast typed choices (choose / score) over open choices (e.g. from a prep folder); built on Kev | a **decision record** (question, options, probabilities, pick) |
| bonfire | Run: harness for gauntlet loops (propose → evaluate → critique → verify) and parallel workers; durable | **run logs** + finished artifacts; logged decisions become nibble training data |
| napkin | Surface: Paper-like canvas for components that agents and David edit together | component files on disk |
| playdough | Make: prompt → playable game, the flagship that proves the stack | a web build + a 20 s clip |

Shared resources on this machine:
- `~/Projects/research-corpus/` YouTube corpus (manifest.jsonl, captions/*.txt now, transcripts/ after Whisper)
- `~/Projects/fridge/` visual inspiration library (catalog.sqlite; see its AGENTS.md)
- `~/Projects/pantry/` database of permissive software David likes (`pantry ls`, see its AGENTS.md)
- `~/Projects/vendor/kev/` Kev (jaredpalmer/kev, Apache-2.0), base for nibble
