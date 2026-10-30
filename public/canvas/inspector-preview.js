// The preview of a staged edit is the edit itself (decision 0015): the engine plans it without writing
// (POST /api/edit with dryRun) and says what each file would hold; those exact bytes are swapped into every frame in
// place of the file, so the canvas shows what Apply will write because it is what Apply will write. Nothing is
// computed here that the planner did not: a shorthand before a longhand in the same rule, @media, specificity and
// !important all come out as the browser makes them.
//   createPreview(ctx) -> { apply(files), clear() }
const absolute = (css, base) => css
  .replace(/url\(\s*(['"]?)(?!data:|https?:|\/\/|#)([^'")]+)\1\s*\)/g, (m, q, u) => `url(${q}${new URL(u, base).href}${q})`)
  .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => `@import ${q}${new URL(u, base).href}${q}`);

export function createPreview(ctx) {
  const undo = [];
  const clear = () => { for (const f of undo.splice(0).reverse()) { try { f(); } catch { /* the frame was replaced */ } } };
  const rawPath = (href) => { try { const u = new URL(href); return u.pathname.startsWith('/raw/') ? decodeURIComponent(u.pathname.slice(5)) : null; } catch { return null; } };

  function swapCss(doc, file) {
    for (const link of doc.querySelectorAll('link[rel~="stylesheet"]')) {
      if (rawPath(link.href) !== file.path) continue;
      const style = doc.createElement('style');
      style.setAttribute('data-napkin', ''); style.setAttribute('data-napkin-preview', '');
      style.textContent = absolute(file.text, link.href);
      link.before(style); link.disabled = true;
      undo.push(() => { style.remove(); link.disabled = false; });
    }
  }
  // The file is this frame's own HTML: its style blocks and style attributes take the planned text (the structure is the same).
  function swapHtml(doc, file) {
    const next = new DOMParser().parseFromString(file.text, 'text/html');
    const mine = [...doc.querySelectorAll('*')].filter((e) => !e.hasAttribute('data-napkin'));
    const theirs = [...next.querySelectorAll('*')];
    if (mine.length !== theirs.length) return;
    mine.forEach((e, i) => {
      const t = theirs[i];
      if (e.localName !== t.localName) return;
      if (e.localName === 'style' && e.textContent !== t.textContent) { const was = e.textContent; e.textContent = t.textContent; undo.push(() => { e.textContent = was; }); }
      const a = e.getAttribute('style'), b = t.getAttribute('style');
      if (a !== b) { e.setAttribute('style', b ?? ''); if (b === null) e.removeAttribute('style'); undo.push(() => { if (a === null) e.removeAttribute('style'); else e.setAttribute('style', a); }); }
    });
  }
  function apply(files) {
    clear();
    for (const [id, sec] of ctx.stage.sections) {
      const doc = sec.docFrame?.doc(); if (!doc) continue;
      const own = ctx.state.components.get(id)?.path;
      // while previewing nothing animates, so the numbers read back are the settled ones
      const quiet = doc.createElement('style'); quiet.setAttribute('data-napkin', ''); quiet.setAttribute('data-napkin-preview', ''); quiet.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      (doc.head || doc.documentElement).append(quiet); undo.push(() => quiet.remove());
      for (const f of files) { if (/\.css$/i.test(f.path)) swapCss(doc, f); else if (f.path === own) swapHtml(doc, f); }
    }
  }
  return { apply, clear };
}
