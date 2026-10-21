// Browser-safe error wording shared by the model and the server boundaries.
// Keep machine-tested prefixes at the start, add the affected path and one next step.
export function explainError(error, { file, next } = {}) {
  let message = String(error?.message ?? error);
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
