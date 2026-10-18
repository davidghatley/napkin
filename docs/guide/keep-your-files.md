# How to keep, review and undo your component files

Serves: **Keep plain files you own**.

## Who it's for and when to use it
For anyone who wants design changes to go through the same review as code. Use it after any session, and especially after an agent's edit, to see what changed, keep it, or throw it away.

## Prerequisites
- Your project is a git repository.
- At least one component made in napkin.

## Flow

```text
 canvas edit ─┐
              ├─► one edit path ─► components/Card.html ─► git diff ─► commit
 agent edit ──┘                          ▲                    │
                                         └── git restore ◄────┘ (undo)
```

## Steps
1. After the agent's edit, look at the diff:
   ```console
   $ git diff components/Card.html
   -  --radius: 8px;
   +  --radius: 12px;
   ```
   One change is one changed line. napkin writes files in a stable order, so an edit never reshuffles the rest.
2. Keep it:
   ```console
   $ git add components/Card.html
   $ git commit -m "Card: rounder corners"
   ```
3. Or throw it away:
   ```console
   $ git restore components/Card.html
   ```
   The canvas reloads the file and shows the Card as it was.
4. Edit the file by hand if you like. Save it in your editor and the canvas updates.
5. Use the component elsewhere: the file is the component. Reuse it from your app's code the way your project's format allows ([GAPS.md](GAPS.md), G1).

## What you see when it worked
- `git diff` shows only the lines you or the agent changed.
- After `git restore`, the canvas matches the file within a moment.
- Closing napkin loses nothing. All state is in the files.

## Common problems and fixes
| Problem | Fix |
|---|---|
| The diff is large for a small change | Report it as a bug. The file order should be stable. |
| The canvas didn't update after `git restore` or a hand edit | Check the `napkin open` terminal for "file watcher stopped" and restart. |
| A hand edit broke the file | napkin keeps showing the last good version and prints the line with the error. Fix the line and save. |
| You switched git branches mid-session | The canvas reloads every changed component. Edits in flight are rejected and the agent re-reads. |

## Limits
- Undo is through git and your editor. In-app undo per edit isn't promised yet ([GAPS.md](GAPS.md), G5).
- The file format, and so how your app imports a component, is not decided ([GAPS.md](GAPS.md), G1).
- napkin doesn't store files anywhere else. Backups are your repository's job.
