// Browser-safe error wording shared by the model and the server boundaries.
// Keep machine-tested prefixes at the start, add the affected path and one next step.
export function explainError(error, { file, next } = {}) {
  let message = String(error?.message ?? error);
  const os = osError(message, file);
  if (os) return `${os} Next: fix the permissions or free space, then retry.`;
  if (/won't overwrite your text\.?$|changed on disk while saving; reread and retry$/.test(message)) return message; // already says what to do
  const at = message.indexOf('Next:');
  const detail = (at < 0 ? message : message.slice(0, at)).trimEnd().replace(/\.$/, '');
  const context = file && !detail.includes(file) ? ` [${file}]` : '';
  if (at >= 0) return `${detail}${context} ${message.slice(at)}`;
  if (!next) {
    if (/Unexpected token|SyntaxError|syntax error/i.test(message)) next = `fix the syntax error at line ${message.match(/line (\d+)/)?.[1] || 1}, then save; napkin reloads it.`;
    else if (/stale revision/.test(message)) next = 'read_component again, check the changed values, then retry on currentRevision.';
    else if (/napkin.json.*(?:not allowed|agents)|propose-only|configured with a token|reserved/.test(message)) next = 'check the caller name and permissions in napkin.json, then request a permitted action.';
    else if (/read-only|dialect|cannot adopt/.test(message)) next = 'keep this file read-only, or request propose_adoption for a reviewed rewrite.';
    else if (/identity required|caller|\bby is required|real name/.test(message)) next = 'POST /api/session with { as: "you" }, then send its token as Authorization: Bearer <token>.';
    else if (/JSON|parse error/.test(message)) next = 'send valid JSON and retry the request.';
    else if (/not found|no such|no longer exists/.test(message)) next = 'list the available components, proposals or tools again and use a current name or id.';
    else if (/not allowed|propose-only|token|reserved/.test(message)) next = 'check the caller name and permissions in napkin.json, then request a permitted action.';
    else if (/forbidden/.test(message)) next = 'connect to the printed http://127.0.0.1 canvas address with its own Origin.';
    else if (/Chromium|browser|renderer/.test(message)) next = 'start the canvas again; set CHROMIUM to an installed Chromium executable if needed.';
    else next = 'check this request against /api/guide, correct the named value, and retry.';
  }
  return `${detail}${context}. Next: ${next}`;
}

// OS error codes (EACCES, ENOSPC, ...) in a person's words, naming the component file and never a temp path.
const OS = {
  EACCES: (f) => `Napkin can't write ${f}: the file or its folder is read-only for you.`,
  EPERM: (f) => `Napkin isn't allowed to change ${f}.`,
  EROFS: (f) => `Napkin can't write ${f}: the folder is on a read-only disk.`,
  ENOSPC: (f) => `Napkin can't save ${f}: the disk is full.`,
  EBUSY: (f) => `${f} is in use by another program, so napkin can't save it right now.`,
};
function osError(message, file) {
  const code = /\b(EACCES|EPERM|EROFS|ENOSPC|EBUSY)\b/.exec(String(message))?.[1];
  if (!code) return null;
  const path = /['"]([^'"]+)['"]/.exec(String(message))?.[1] ?? '';
  const named = file || (path.split('/').pop() || 'the file').replace(/^\./, '').replace(/\.tmp-.*$/, '').replace(/\.napkin\.json$/, '.tsx');
  return OS[code](named);
}

