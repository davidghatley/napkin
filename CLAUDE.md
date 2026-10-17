# CLAUDE.md: napkin

**Read `INTENT.md` before anything else.** It is the contract for this repo. If a task falls outside it, or contradicts its "is not" list, stop and ask David instead of doing it. Earlier projects drifted because agents improvised scope; this repo exists to not repeat that.

Then read `STACK.md` (how this repo fits the others) and `docs/salvage.md` (what earlier repos offer as reference; reference only, never copy code wholesale).

## Definition of done
Work is done when it moves the **proving demo** in INTENT.md forward and the demo can be run from the README. Build the thinnest version that runs end to end first; polish after.

## Machine rules (shared with other projects and agents)
- Python: `uv venv -p 3.12` inside this repo. Never the system Python (3.14).
- GPU (RTX 3060, 12 GB) is shared. Check `nvidia-smi` first; run GPU jobs only through `~/anime-pipeline/tools/gpu_run <cmd>` (a shared lock). Never kill processes you didn't start.
- Ask David before any download over 10 GB, any sudo, or touching another project's folder.
- Git: commit on feature branches; add files by name (never `git add -A`); no remotes, no pushes, no publishing without David's approval.
- Never commit secrets, absolute home paths in user-facing docs, or raw media.

## Where things are
- Research for this repo: `research/` (curated notes; symlinks into `~/Projects/research-corpus/`).
- Decisions: `docs/decisions/NNNN-title.md` (status proposed/accepted). Record a decision before acting on a big choice.
- Visual inspiration: `~/Projects/fridge/` (query its catalog; see `~/Projects/fridge/AGENTS.md`).
- Software candidates: `~/Projects/pantry/` (`pantry ls --license permissive`); prefer permissive, independent, active, small-dependency projects. Record why a dependency was chosen.

## Style
Visual and legible: every major piece gets a diagram or a screenshot in `docs/`, in the illustrated technical-manual style David uses (`~/anime-pipeline/docs/manual/assets/manual.css`). Say plainly what AI did versus what David decided.
