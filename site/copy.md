# napkin: landing page copy

Status: round 3 (final for stage 1). Notes, scores and the promises checklist are in `copy-notes.md`.

---

## Hero directions considered

**A. "Sketch it on a napkin. Keep it as code."**
Subhead: Draw a button on the canvas with your AI agent beside you. When you're done, it's a real file in your project.
Rationale: it uses the name and paints a clear picture, but "sketch on a napkin" suggests a loose whiteboard, which INTENT rules out.

**B. "Your AI agent, on your design canvas."**
Subhead: The agent sees what you see and edits the same component you're editing. Everything saves to plain files you can review.
Rationale: it names what is new, but it describes a setup rather than an outcome the reader gets.

**C. "Design buttons, cards and forms with your agent."**
Subhead: You and an AI agent edit the same component at the same time. What you make is saved as real code.
Rationale: it is the plainest for a 12-year-old, but listing three widgets reads small and the line runs to 8 words.

**Picked: D, below.** It keeps C's plain promise and B's "together" idea in 7 words. The subhead carries the concrete example (a button) and the second payoff (a real file), so the hero passes the 5-second test without a pun.

---

## 1. Hero

# Design components side by side with your agent

A design canvas where you and an AI agent edit the same button at once. Every change saves to a real code file.

- Primary CTA: **Watch it get built**
- Secondary CTA: **Read the plan**

<small>In build. Follow along.</small>

---

## 2. The problem

You design a card in one tool, then someone rebuilds it in code, and the two drift apart. When you ask an AI for help, it works in a chat window and can't see your canvas. You end up copying changes back and forth by hand.

---

## 3. Benefits

### Work on it together
You and your agent change the same component at the same time, and each of you sees the other's edits as they land.
*Example:* you type "add a disabled state to this button" and watch it appear while you keep adjusting the padding yourself.

### Design every version at once
Napkin treats a button as one component with its sizes, states and settings, so a change to the base reaches every version.
*Example:* a Button with 3 sizes and 3 states is 9 versions. Make the corners rounder once and all 9 update.

### Keep plain files you own
Every component is saved as a file in your project folder, so you can compare, review and undo changes with the tools you already use.
*Example:* after the agent's edit, `git diff` shows one changed line in the Card file, where the corner radius went from 8 to 12.

---

## 4. How it works

1. **Start a component.** Draw it on the canvas, or ask your agent to rough one out using your colours and spacing.
2. **Edit it together.** You change it by hand while your agent changes it through napkin's agent connection.
3. **Keep the file.** The component sits in your project as a real file you can reuse in other screens and commit.

---

## 5. See it work

<small>Target demo. This is what napkin is being built to do. It does not run yet.</small>

You open a Card component on the canvas. In the side panel you type to your agent: "Add a compact version with a smaller image and tighter padding." While it works, you make the title one step bolder. A few seconds later the compact Card sits next to the original, and your bolder title shows up in both. You open your project folder. The Card file now holds both versions, ready to drop into a page.

---

## 6. Who it's for

**For**
- Designers who build component libraries and are tired of rebuilding every change in code.
- Founders and small teams who already sketch UI with an AI agent and want the result to land in the repo.
- Developers who want their agent to edit UI they can see, with changes they can review in git.

**Not for**
- Brainstorming with sticky notes. Napkin is not a whiteboard.
- Teams who need every Figma feature. Napkin focuses on components and leaves the rest out.
- Anyone who needs a tool this week. It isn't built yet.

---

## 7. How it fits

Napkin is the design surface in an open stack of small tools David is building. It reads and writes plain component files and design tokens, so the other tools (mise_en_place, nibble, bonfire and playdough) can pick up what you make.

---

## 8. FAQ

**Can I use it today?**
No. Napkin is planned for a later phase of the roadmap. Right now it is research, a written plan and a few small experiments. Follow along to see it take shape.

**How is this different from Paper or Figma?**
Like Paper, napkin puts real HTML and CSS on the canvas. It then focuses on components, meaning versions, settings and shared design tokens, where Paper is weaker. It won't try to copy every Figma feature.

**What does "component file" mean? Which framework?**
That isn't decided yet. Whether the file is HTML first or a structured component format is an open question. What is fixed is that it's a plain file on disk you can diff and keep in git.

**Which agents can connect?**
Napkin will offer an API and an MCP server (a standard plug for agent tools). Agents that speak MCP should be able to read and edit your components through it.

**What happens when my agent and I change the same thing?**
That is the hardest part, and the design isn't settled. The goal is one shared document that you both edit, ending in one clean file.

**Is it open source?**
It's planned as part of an open, modular stack. A licence hasn't been chosen yet, and the code isn't public.

---

## 9. Footer line

A design canvas where you and your AI agent edit the same components live, saved as real files.
