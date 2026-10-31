// Runs INSIDE the page (serialised by capture.mjs). Turns a live element into a fixture: its real DOM as HTML,
// plus the little context a story needs to put it back (ancestor chain, size, body attributes).
// Frame iframes are inlined as srcdoc so the story needs no server.
export function grab(spec) {
  const el = spec.whole ? document.body : (typeof spec.sel === 'string' ? document.querySelector(spec.sel) : null);
  if (!el) return { missing: true };
  const R = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  const strip = (root) => { root.querySelectorAll('script').forEach((s) => s.remove()); };
  const frameDoc = (d) => {
    const root = d.documentElement.cloneNode(true);
    root.querySelectorAll('base,script,link[href^="http"],link[href^="//"],style[data-napkin-chrome]').forEach((n) => n.remove());
    root.querySelectorAll('link[data-napkin]').forEach((l) => { l.setAttribute('href', l.getAttribute('href').replace(/^\/raw\//, '/fixtures/frame/')); l.removeAttribute('data-napkin'); });
    return '<!doctype html>' + root.outerHTML;
  };
  const syncForm = (orig, clone) => {
    const o = orig.querySelectorAll('input,textarea,select'), c = clone.querySelectorAll('input,textarea,select');
    o.forEach((n, i) => {
      const k = c[i]; if (!k) return;
      if (n.tagName === 'TEXTAREA') k.textContent = n.value;
      else if (n.tagName === 'SELECT') [...k.options].forEach((opt, j) => { if (n.options[j]?.selected) opt.setAttribute('selected', ''); else opt.removeAttribute('selected'); });
      else if (n.type === 'checkbox' || n.type === 'radio') { if (n.checked) k.setAttribute('checked', ''); else k.removeAttribute('checked'); }
      else k.setAttribute('value', n.value);
    });
  };
  const clone = el.cloneNode(true);
  strip(clone); syncForm(el, clone);
  const of = el.querySelectorAll('iframe'), cf = clone.querySelectorAll('iframe');
  of.forEach((f, i) => { const k = cf[i]; try { if (f.contentDocument?.documentElement) { k.setAttribute('srcdoc', frameDoc(f.contentDocument)); k.removeAttribute('src'); } else k.remove(); } catch { k.remove(); } });
  // canvases (thumbnails) become images
  el.querySelectorAll('canvas').forEach((cv, i) => { const k = clone.querySelectorAll('canvas')[i]; try { const im = document.createElement('img'); im.src = cv.toDataURL('image/png'); im.className = cv.className; im.style.cssText = cv.style.cssText; im.width = cv.width; im.height = cv.height; k.replaceWith(im); } catch {} });
  // blob: images cannot travel; inline them where the browser has them decoded
  el.querySelectorAll('img[src^="blob:"]').forEach((im, i) => { const k = clone.querySelectorAll('img[src^="blob:"]')[i]; try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); k.src = c.toDataURL('image/png'); } catch { k.removeAttribute('src'); } });
  const attrs = (e) => Object.fromEntries([...e.attributes].filter((a) => a.name !== 'data-theme').map((a) => [a.name, a.value]));
  const out = { ...R(el), pos: getComputedStyle(el).position, vw: innerWidth, vh: innerHeight, html: spec.whole ? clone.innerHTML : clone.outerHTML, body: attrs(document.body), htmlAttrs: attrs(document.documentElement) };
  if (spec.whole) out.headStyles = [...document.head.querySelectorAll('style')].map((s) => s.textContent);
  if (!spec.whole) {
    const chain = []; let p = el.parentElement, first = true;
    while (p && p !== document.body && p !== document.documentElement) {
      const cs = getComputedStyle(p), c = { tag: p.tagName.toLowerCase(), attrs: attrs(p) };
      if (first) { c.w = R(p).w; c.layout = { display: cs.display, flexDirection: cs.flexDirection, flexWrap: cs.flexWrap, gap: cs.gap, alignItems: cs.alignItems, justifyContent: cs.justifyContent, gridTemplateColumns: cs.display.includes('grid') ? cs.gridTemplateColumns : '', padding: cs.padding }; first = false; }
      chain.unshift(c); p = p.parentElement;
    }
    out.chain = chain;
  }
  return out;
}
