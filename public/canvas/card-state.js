// The two states a card shows instead of its content (docs/basics/standards.md 3 and 10): empty and failed. Same label, same surface as every
// other card; inside, one quiet line in the chrome's type. An error says what failed and the first line of why (the whole text is the tooltip),
// never a raw stack and never a blank box.
//   setCardState(cell, 'error' | 'empty' | null, { title, detail, full })   draws (or clears) the state inside a card's cell
//   errorParts(text)  -> { title, detail }    what napkin's own error text says, put plainly ("Build error", "line 3: Unexpected token")
//   framesOnly(mount) -> true when a component draws nothing but empty frames (no text, no picture, no fill; the frame tool's dashed edge only)
//   installCardStates(ctx)                    pictures that do not decode, and editable components made only of empty frames

export function setCardState(cell, state, { title = '', detail = '', full = '' } = {}) {
  let box = cell.querySelector(':scope > .card-state');
  if (!state) { box?.remove(); delete cell.dataset.state; return; }
  if (!box) { box = document.createElement('div'); box.className = 'card-state'; cell.append(box); }
  box.dataset.state = state; cell.dataset.state = state;
  box.replaceChildren();
  for (const [cls, text] of [['card-state-title', title], ['card-state-detail', detail]]) {
    if (!text) continue;
    const p = document.createElement('p'); p.className = cls; p.textContent = text; box.append(p);
  }
  if (full) box.title = full; else box.removeAttribute('title');
}

// "napkin could not build Broken.tsx#Broken: line 3: Unexpected token ... Next: fix ..." -> Build error / line 3: Unexpected token ...
export function errorParts(text) {
  const t = String(text || '').trim();
  const title = /could not build/i.test(t) ? 'Build error' : /could not run/i.test(t) ? 'Render error' : 'Error';
  let detail = t.split('\n')[0].replace(/^napkin could not (build|run|load) [^:]*:\s*/i, '');
  detail = detail.replace(/^[\w./#@-]+\.(tsx|jsx|ts|js|html|css|svg):\s*/i, ''); // the file again ("Imports.jsx: line 1: ..."): the label names it
  detail = detail.split(/\s+Next:/)[0].trim();
  detail = detail.charAt(0).toUpperCase() + detail.slice(1);
  return { title, detail: detail.length > 200 ? `${detail.slice(0, 199)}…` : detail };
}

const MEDIA = /^(img|svg|video|canvas|picture|iframe|object|embed|input|select|textarea|button)$/;
export function framesOnly(mount) {
  const root = mount?.firstElementChild;
  if (!root || mount.textContent.trim()) return false;
  for (const e of [root, ...root.querySelectorAll('*')]) {
    if (MEDIA.test(e.localName)) return false;
    const c = getComputedStyle(e);
    if (c.display === 'none' || c.visibility === 'hidden') continue;
    if (c.backgroundImage !== 'none' || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c.backgroundColor) || c.boxShadow !== 'none' || c.outlineStyle !== 'none') return false;
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(c[`border${s}Width`]) > 0 && !/^(none|hidden|dashed)$/.test(c[`border${s}Style`])) return false;
    for (const p of ['::before', '::after']) { const pc = getComputedStyle(e, p).content; if (pc && pc !== 'none' && pc !== 'normal') return false; }
  }
  return true;
}

// A picture that does not decode: why, as far as the browser can say. An SVG names its first parse error.
async function pictureError(img) {
  const name = img.alt || '', ext = (name.match(/\.(\w+)$/)?.[1] || 'image').toUpperCase();
  if (ext !== 'SVG') return { title: 'Image error', detail: `Does not decode as ${/^[AEIOU]/.test(ext) ? 'an' : 'a'} ${ext} image.` };
  try {
    const text = await (await fetch(img.src)).text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), bad = doc.querySelector('parsererror');
    const why = bad ? (bad.querySelector('div')?.textContent || bad.textContent).trim().split('\n')[0] : doc.documentElement.localName !== 'svg' ? 'The root element is not <svg>.' : 'The browser could not draw it.';
    const d = why.replace(/^This page contains the following errors:\s*/, '');
    return { title: 'SVG error', detail: d.charAt(0).toUpperCase() + d.slice(1) };
  } catch { return { title: 'SVG error', detail: 'The file could not be read.' }; }
}

export function installCardStates(ctx) {
  // a picture card whose picture fails: the error card in its place (the image stays, hidden, so the card's own sizing still sees it fail)
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.matches('.kind-compact > img:not(.kind-poster)')) return;
    const cell = img.closest('.kind-cell');
    if (!cell) return;
    setCardState(cell, 'error', { title: 'Image error', detail: 'Reading the file…' });
    pictureError(img).then((p) => { if (img.isConnected && cell.dataset.state === 'error') setCardState(cell, 'error', { ...p, full: `${img.alt}: ${p.detail}` }); });
  }, true);
  // an editable component that is only empty frames (a frame just drawn, nothing in it yet): named, with its frames still there to draw into
  const look = (id) => {
    const sec = document.querySelector(`#world > section.cmp[data-component="${CSS.escape(id)}"]`);
    for (const cell of sec?.querySelectorAll('.matrix .cell:not(.doc-cell)') || []) {
      const mount = cell.querySelector(':scope > .mount');
      if (!mount || mount._nkStates) continue;
      const check = () => { const empty = framesOnly(mount); if (empty !== (cell.dataset.state === 'empty')) setCardState(cell, empty ? 'empty' : null, { detail: 'Empty frame' }); };
      let t = 0; const later = () => { clearTimeout(t); t = setTimeout(check, 60); };
      mount._nkStates = new MutationObserver(later);
      mount._nkStates.observe(mount, { subtree: true, childList: true, characterData: true, attributes: true });
      later();
    }
  };
  ctx.on?.('render', (d) => d?.component && look(d.component));
}
