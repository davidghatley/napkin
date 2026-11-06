// WPC-07: the drawings of your components are pictures, not controls. Their buttons and fields stay out of the Tab order
// (tabindex -1: still clickable) until play mode (P) turns them into live components. The inspector, layers and top bar are
// therefore the only things Tab walks through. Nothing is written to a file.
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])';
const was = new WeakMap(); // element -> its own tabindex attribute (null = none)

export function initTabs(ctx) {
  function sweep(scope) {
    const play = document.body.dataset.play === '1';
    for (const el of scope.querySelectorAll(FOCUSABLE)) {
      if (!el.closest('.mount')) continue;
      if (play) { if (was.has(el)) { const t = was.get(el); t === null ? el.removeAttribute('tabindex') : el.setAttribute('tabindex', t); was.delete(el); } }
      else { if (!was.has(el)) was.set(el, el.getAttribute('tabindex')); el.setAttribute('tabindex', '-1'); }
    }
  }
  ctx.on('render', ({ component }) => { const sec = document.querySelector(`section.cmp[data-component="${CSS.escape(component)}"]`); if (sec) sweep(sec); });
  ctx.on('play', () => sweep(document.querySelector('#world')));
  sweep(document.querySelector('#world'));
  ctx.tabs = { sweep: () => sweep(document.querySelector('#world')) };
}
