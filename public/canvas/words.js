// Person-facing wording for messages that come from the server. The API speaks to agents ("... Next: check this request
// against /api/guide ..."); the canvas speaks to a person, so every toast, hint and inline error goes through plain().
const NOTHING = /nothing to (undo|redo)/i;
export function plain(text) {
  let s = String(text ?? '').trim();
  const nothing = s.match(NOTHING);
  if (nothing) return `Nothing to ${nothing[1].toLowerCase()} yet.`;
  s = s.replace(/\s*Next:[\s\S]*$/, '').replace(/^(undo|redo) refused: /, '').replace(/^invalid edit #\d+: /, '').replace(/\s*\/api\/[\w/.-]*/g, '').trim();
  if (/^id ".*" already exists/.test(s)) return 'That id is already used';
  return s || 'Something went wrong';
}

// Inline errors in the panel keep the store's own wording ("invalid edit #0: ...") but never the agent-facing "Next: ..." tail.
export const stripNext = (text) => String(text ?? '').replace(/\s*Next:[\s\S]*$/, '').replace(/\s*\/api\/[\w/.-]*/g, '').trim();
