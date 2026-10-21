# 0005: Clashes, undo, agent permissions and outside services

Status: **accepted** · Date: 2026-10-21 · Decided by: David (approved N4, N5, N6, N7 in the dream review as proposed by the AI build lead, Claude).
Answers GAPS G2, G5, G6.

## G2: same-property clash
The rule stays "stale revision": an edit whose touched keys changed after its base revision is refused. In addition, the canvas shows a **clash chip** on the property with both values (yours, which didn't land, and theirs, which did). One click re-applies yours on the new revision. Agents get the changed keys and current values in the error (AGT-06).

## G5: in-app undo
`⌘Z` undoes **only your own** last edit, as a **new attributed revision** that writes the old values back through `store.apply`. It never undoes an agent's or a file's change. If anyone changed one of the same keys afterwards, undo is refused with who and which revision. Redo is the same in reverse. History lives in the server's memory for the session; git is the long-term history.

## G6: agent permissions
`napkin.json` may hold `"agents": { "<name>": "read" | "propose" | "write" }`. An MCP process names itself with `NAPKIN_AGENT` (default `agent`). Unlisted agents get `write`, as today. `propose` turns every `apply_edits` into a proposal (AGT-04).

## N7: outside services for the build loop
- Codex CLI and Opencode free models may be used as builders and critics. They see repo code.
- Paper and Figma comparisons use their public pages and help-centre imagery only. Those blind bars are marked "imagery" in the ledger: weaker than a same-way capture.
- Spend is logged with `npx ccusage@<pinned version>`.

## Amendment (2026-10-21, AI build lead, within David's go-ahead to choose better options during the build)
A critic showed that "unlisted agents get write" lets a read-only agent sidestep its mode by connecting under a new name. So:
- With no `agents` key in napkin.json, behaviour is as above (everyone may write; one person and their agents on localhost).
- As soon as napkin.json has an `agents` key, any name it doesn't list gets `"*"`'s mode, and `"*"` defaults to **read**.
- `unknown` and empty names are refused; every revision names a real caller.
- The server only accepts requests whose Host is 127.0.0.1/localhost and whose Origin (when present) is the canvas's own origin, which stops a web page in your browser from writing.
- Trust model, stated plainly: any program running as you can edit the files directly, so permissions are guard rails for agents that go through napkin, not a security boundary.
