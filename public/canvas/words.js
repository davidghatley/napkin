// Person-facing wording for messages that come from the server. The API speaks to agents ("... Next: check this request
// against /api/guide ..."); the canvas speaks to a person, so every toast, hint and inline error goes through plain().
export const SETTING_NAME = /^[a-z][a-zA-Z0-9]*$/;
export const SETTING_NAME_HELP = (n) => `"${String(n).slice(0, 30)}" can't be a setting name. Start with a lowercase letter, then use letters and digits only, like label or isActive.`;
const NOTHING = /nothing to (undo|redo)/i;
export function plain(text) {
  let s = String(text ?? '').trim();
  if (/connection to napkin was interrupted/.test(s)) return 'Napkin lost its connection, so this change may not have been saved. Check the canvas, then try again.';
  const os = osError(s); if (os) return os;
  const nothing = s.match(NOTHING);
  if (nothing) return `Nothing to ${nothing[1].toLowerCase()} yet.`;
  s = s.replace(/\s*Next:[\s\S]*$/, '').replace(/^(undo|redo) refused: /, '').replace(/^invalid edit #\d+: /, '').replace(/\s*\/api\/[\w/.-]*/g, '').trim();
  if (/^id ".*" already exists/.test(s)) return 'That id is already used';
  s = s.replace(/\s*\[[^\]]*\.(?:tsx|json)\]\s*$/, '').trim(); // the file is already named by the field the message sits beside
  const bad = /^bad prop name "(.*)"$/.exec(s);
  if (bad) return SETTING_NAME_HELP(bad[1]);
  return s || 'Something went wrong';
}

// Inline errors in the panel keep the store's own wording ("invalid edit #0: ...") but never the agent-facing "Next: ..." tail.
export const stripNext = (text) => plain(text); // inline messages beside a field: the same plain words as a toast

// OS error codes (EACCES, ENOSPC, ...) in a person's words, naming the component file and never a temp path.
const OS = {
  EACCES: (f) => `Napkin can't write ${f}: the file or its folder is read-only for you.`,
  EPERM: (f) => `Napkin isn't allowed to change ${f}.`,
  EROFS: (f) => `Napkin can't write ${f}: the folder is on a read-only disk.`,
  ENOSPC: (f) => `Napkin can't save ${f}: the disk is full.`,
  EBUSY: (f) => `${f} is in use by another program, so napkin can't save it right now.`,
};
export function osError(message, file) {
  const code = /\b(EACCES|EPERM|EROFS|ENOSPC|EBUSY)\b/.exec(String(message))?.[1];
  if (!code) return null;
  const path = /['"]([^'"]+)['"]/.exec(String(message))?.[1] ?? '';
  const named = file || (path.split('/').pop() || 'the file').replace(/^\./, '').replace(/\.tmp-.*$/, '').replace(/\.napkin\.json$/, '.tsx');
  return OS[code](named);
}

// The banner on a frame whose file is broken mid-edit: where, and what to do, without parser jargon.
export function problemBanner(file, problem) {
  const line = /line (\d+)/.exec(String(problem))?.[1];
  const what = /syntax|unexpected|token|parse|expected/i.test(String(problem)) ? 'has a syntax error' : 'has a problem';
  return `${file} ${what}${line ? ` at line ${line}` : ''}. Showing the last version that worked. Fix the file and save.`;
}
