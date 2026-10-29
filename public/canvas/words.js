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

// ---- form validation: one path for every panel form (setting, variant axis, variant value, component) ----
// checkName() runs in the panel before anything is sent; engineSentence() puts an engine refusal into the same words, naming the right noun.
const RESERVED_NAMES = new Set(['v', 's', 'base', 'variants', 'children', 'key', 'ref', 'style', 'class', 'default', 'new', 'delete', 'function', 'return', 'const', 'let', 'var', 'this']);
const KINDS = {
  setting: { re: /^[a-z][a-zA-Z0-9]*$/, what: 'setting name', noun: 'setting', help: 'Start with a lowercase letter, then use letters and digits only, like label or isActive.', reserved: true },
  axis: { re: /^[a-z][a-zA-Z0-9]*$/, what: 'variant name', noun: 'variant', help: 'Start with a lowercase letter, then use letters and digits only, like size or tone.', reserved: true },
  value: { re: /^[a-zA-Z0-9_-]+$/, what: 'value', noun: 'value', help: 'Use letters, digits, - or _ only, with no spaces, like big or extra-large.' },
  component: { re: /^[A-Z][A-Za-z0-9]*$/, what: 'component name', noun: 'component', help: 'Start with a capital letter, then use letters and digits only, like Tooltip.' },
};
const dupSentence = (kind, name, existingNoun) => `There is already ${/^[aeiou]/.test(existingNoun || KINDS[kind].noun) ? 'an' : 'a'} ${existingNoun || KINDS[kind].noun} called "${String(name).slice(0, 30)}". Pick another name.`;
// existing: an array of taken names, or { name: 'setting' | 'variant' | ... } when the noun differs
export function checkName(kind, text, existing = []) {
  const k = KINDS[kind], t = String(text ?? '').trim();
  if (!t) return `Type a ${k.what} first.`;
  if (!k.re.test(t)) return `"${t.slice(0, 30)}" can't be a ${k.what}. ${k.help}`;
  if (k.reserved && RESERVED_NAMES.has(t)) return `"${t}" is a word napkin keeps for itself. Pick another ${k.what}.`;
  const taken = Array.isArray(existing) ? (existing.includes(t) ? k.noun : null) : (Object.hasOwn(existing, t) ? existing[t] : null);
  if (taken) return dupSentence(kind, t, taken);
  return null;
}
export function engineSentence(kind, text, value) {
  const s = String(text ?? '');
  const k = KINDS[kind] ? kind : 'setting';
  const quoted = /"([^"]*)"/.exec(s)?.[1] ?? value ?? '';
  if (/already (exists|has)/.test(s) && !/^id "/.test(s.replace(/^invalid edit #\d+: /, ''))) return dupSentence(k, quoted);
  if (/^(invalid edit #\d+: )?bad (prop|axis) name/.test(s)) return checkName(k === 'component' ? 'component' : k === 'value' ? 'axis' : k, quoted, []) ?? plain(s);
  if (/bad (variant|base) value/.test(s)) return checkName('value', quoted, []) ?? plain(s);
  if (/bad component name/.test(s)) return checkName('component', quoted, []) ?? plain(s);
  return plain(s);
}
