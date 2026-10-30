// The preview of a staged edit is the edit itself (decision 0015): the engine plans it without writing
// (POST /api/edit with dryRun) and says what each file would hold; those exact bytes are swapped into every frame in
// place of the file, so the canvas shows what Apply will write because it is what Apply will write. Nothing is
// computed here that the planner did not: a shorthand before a longhand in the same rule, @media, specificity and
// !important all come out as the browser makes them.
//   createPreview(ctx) -> { apply(files) -> Promise<paths shown>, clear() }
// A sheet reached through @import is shown too: the sheet that imports it is swapped for a copy whose import points
// at the planned text.
const absolute = (css, base) => css
  .replace(/url\(\s*(['"]?)(?!data:|https?:|\/\/|#)([^'")]+)\1\s*\)/g, (m, q, u) => `url(${q}${new URL(u, base).href}${q})`)
  .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => `@import ${q}${new URL(u, base).href}${q}`);

export function createPreview(ctx) {
  const undo = [];
  const clear = () => { for (const f of undo.splice(0).reverse()) { try { f(); } catch { /* the frame was replaced */ } } };
  const rawPath = (href) => { try { const u = new URL(href); return u.pathname.startsWith('/raw/') ? decodeURIComponent(u.pathname.slice(5)) : null; } catch { return null; } };

  function swapCss(doc, file) {
    let shown = false;
    for (const link of doc.querySelectorAll('link[rel~="stylesheet"]')) {
      if (rawPath(link.href) !== file.path) continue;
      const style = doc.createElement('style');
      style.setAttribute('data-napkin', ''); style.setAttribute('data-napkin-preview', '');
      style.textContent = absolute(file.text, link.href);
      // the original sheet is taken out of the cascade with media="not all" (link.disabled can lose a race with the sheet loading)
      const media = link.getAttribute('media');
      link.before(style); link.setAttribute('media', 'not all');
      undo.push(() => { style.remove(); if (media === null) link.removeAttribute('media'); else link.setAttribute('media', media); });
      shown = true;
    }
    return shown;
  }
  // The planned text of `file` reaches this frame only through @import: rebuild each importing sheet with that import
  // pointing at a blob of the planned text (and deeper chains the same way, to a few levels).
  async function swapImports(doc, file) {
    let shown = false;
    const blob = (css, href) => { const u = URL.createObjectURL(new Blob([absolute(css, href)], { type: 'text/css' })); undo.push(() => URL.revokeObjectURL(u)); return u; };
    async function inline(text, base, depth) {
      const found = [...text.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?([^;]*);/g)];
      let out = text, changed = false;
      for (const m of found.reverse()) {
        let href; try { href = new URL(m[2], base).href; } catch { continue; }
        const path = rawPath(href); let next = null;
        if (path === file.path) next = blob(file.text, href);
        else if (path !== null && depth < 4) { const sub = await (await fetch(href)).text(); const r = await inline(sub, href, depth + 1); if (r !== null) next = blob(r, href); }
        if (next) { out = `${out.slice(0, m.index)}@import url("${next}")${m[3]};${out.slice(m.index + m[0].length)}`; changed = true; }
      }
      return changed ? out : null;
    }
    for (const node of [...doc.querySelectorAll('link[rel~="stylesheet"], style')]) {
      if (node.hasAttribute('data-napkin-preview')) continue;
      let rules; try { rules = node.sheet?.cssRules; } catch { continue; }
      if (!rules || ![...rules].some((r) => r.type === 3)) continue;
      const base = node.localName === 'link' ? node.href : doc.baseURI;
      const text = node.localName === 'link' ? await (await fetch(node.href)).text() : node.textContent;
      const out = await inline(text, base, 0);
      if (out === null) continue;
      const style = doc.createElement('style');
      style.setAttribute('data-napkin', ''); style.setAttribute('data-napkin-preview', ''); style.textContent = absolute(out, base);
      if (node.localName === 'link') { const media = node.getAttribute('media'); node.before(style); node.setAttribute('media', 'not all'); undo.push(() => { style.remove(); if (media === null) node.removeAttribute('media'); else node.setAttribute('media', media); }); }
      else { const was = node.textContent; node.before(style); node.textContent = ''; undo.push(() => { style.remove(); node.textContent = was; }); }
      shown = true;
    }
    return shown;
  }
  // The file is this frame's own HTML: its style blocks and style attributes take the planned text (the structure is the same).
  function swapHtml(doc, file) {
    const next = new DOMParser().parseFromString(file.text, 'text/html');
    const mine = [...doc.querySelectorAll('*')].filter((e) => !e.hasAttribute('data-napkin'));
    const theirs = [...next.querySelectorAll('*')];
    if (mine.length !== theirs.length) return false;
    mine.forEach((e, i) => {
      const t = theirs[i];
      if (e.localName !== t.localName) return;
      if (e.localName === 'style' && e.textContent !== t.textContent) { const was = e.textContent; e.textContent = t.textContent; undo.push(() => { e.textContent = was; }); }
      const a = e.getAttribute('style'), b = t.getAttribute('style');
      if (a !== b) { e.setAttribute('style', b ?? ''); if (b === null) e.removeAttribute('style'); undo.push(() => { if (a === null) e.removeAttribute('style'); else e.setAttribute('style', a); }); }
    });
    return true;
  }
  async function apply(files) {
    clear();
    const shown = new Set();
    for (const [id, sec] of ctx.stage.sections) {
      const doc = sec.docFrame?.doc(); if (!doc) continue;
      const own = ctx.state.components.get(id)?.path;
      // while previewing nothing animates, so the numbers read back are the settled ones
      const quiet = doc.createElement('style'); quiet.setAttribute('data-napkin', ''); quiet.setAttribute('data-napkin-preview', ''); quiet.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      (doc.head || doc.documentElement).append(quiet); undo.push(() => quiet.remove());
      for (const f of files) {
        if (/\.css$/i.test(f.path)) { const a = swapCss(doc, f), b = await swapImports(doc, f).catch(() => false); if (a || b) shown.add(f.path); }
        else if (f.path === own && swapHtml(doc, f)) shown.add(f.path);
      }
    }
    return shown;
  }
  return { apply, clear };
}
