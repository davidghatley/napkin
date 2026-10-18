# napkin: landing page copy

Stage 2, edited 2026-10-18. Scores, round history and the promise checklist are in `copy-notes.md`.

---

## Hero directions

**A.** Sketch it on a napkin. Keep it as code.
Draw a button with your AI agent. It ends up a real file.
*Rationale:* "sketch" suggests a whiteboard, which INTENT rules out.

**B.** Your AI agent, on your design canvas.
The agent sees and edits the component you're editing.
*Rationale:* names what's new, but gives no outcome.

**C.** Design buttons, cards and forms with your agent.
You and an AI agent edit one component at once.
*Rationale:* plain, but three widgets read small.

**Picked: D, below.** C's plain promise and B's "together" idea in 7 words.

---

## 1. Hero

# Design components side by side with your agent

A design canvas where you and an AI agent edit the same button at once. Every change saves to a real code file.

- Primary CTA: **Watch it get built**
- Secondary CTA: **Read the plan**
- Status note: *Planned. Follow along.*

---

## 2. The problem

You design a card in one tool, someone rebuilds it in code, and the two drift apart. Your AI agent works in a chat window and can't see your canvas, so you copy changes by hand.

---

## 3. Benefits

### Work on it together
You and your agent change the same component at once, and each sees the other's edits as they land.
*Example:* you type "add a disabled state to this button" and watch it appear while you adjust the padding.

### Change every version at once
A button is one component with its sizes, states and settings, so a change to the base reaches every version.
*Example:* a Button with 3 sizes and 3 states is 9 versions. Round the corners once and all 9 update.

### Keep plain files you own
Every component is a file in your project, so you review and undo changes with the tools you already use.
*Example:* after the agent's edit, `git diff` shows one changed line in the Card file. The corner radius went from 8 to 12.

---

## 4. How it works

1. **Start a component.** Draw it, or ask your agent to rough one out in your colours and spacing.
2. **Edit it together.** You change it by hand while your agent changes it through napkin's agent connection.
3. **Keep the file.** The component sits in your project as a real file you can reuse and commit.

---

## 5. See it work

*Target demo. Not built yet.*

You open a Card on the canvas and ask your agent for "a compact version with a smaller image and tighter padding." While it works, you make the title one step bolder. Soon the compact Card sits next to the original, with your bolder title in both. Your project now holds one Card file with both versions.

---

## 6. Who it's for

**For you if**
- You build component libraries and are tired of rebuilding every change in code.
- You already sketch UI with an AI agent and want the result to land in the repo.
- You want your agent's UI edits on screen and in git.

**Not for you if**
- You want sticky notes and brainstorming. napkin is not a whiteboard.
- You need every Figma feature. napkin sticks to components.
- You need a tool this year. napkin is planned for later.

---

## 7. How it fits

napkin will be the design surface in a set of five tools David Hatley is building for making things with AI agents, starting with games.

- **Mise en Place** preps a ready game project from one sentence, so the agent skips setup.
- **nibble** answers an agent's multiple-choice questions fast and says how sure it is.
- **bonfire** runs AI agents until the work passes your checks, even through a crash.
- **playdough** turns one sentence into a small game you can play from a link.

---

## 8. FAQ

**How is this different from Paper or Figma?**
Like Paper, napkin puts real HTML and CSS on the canvas. It adds the component parts Paper does weakly, such as versions, settings and shared colours and spacing. It won't copy every Figma feature.

**Which framework is the component file?**
Not decided. It may be HTML first or a structured component format. Either way it's a plain file you can diff and keep in git.

**Which agents can connect?**
napkin will offer an API and an MCP server (a standard plug for agent tools), so agents that speak MCP should be able to edit your components.

**What happens when my agent and I change the same thing?**
That's the hardest part, and the design isn't settled. The goal is one shared document you both edit, ending in one clean file.

**Is it open source?**
That's the plan. No licence is chosen yet, and the code isn't public.

**Can I try it today?**
No. napkin comes in a later phase. For now it's research, a plan and small experiments. Read the plan, and follow along.

---

## 9. Footer line

napkin is a planned design canvas where you and your AI agent edit the same components live, saved as files you own.
