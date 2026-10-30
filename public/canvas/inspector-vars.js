// The folder's own variables as instruments (dream moment 6): swatches, a scale and type samples. Click or press Enter
// on one to bind it to the value you are on; drag one onto an element of the canvas to bind it there (a small list asks
// which property). Both end in the same staged edit as typing, so the scope key and Apply decide where it is written.
import { kindOfProp } from './inspector-model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const expanded = new Set(); // strips the person opened (each starts as one row)
const TITLES = { color: 'Colour', space: 'Space', radius: 'Radius', size: 'Size', type: 'Type' };
// the properties a variable of each kind can go into, in the order a designer reaches for them
const PROPS = { color: ['color', 'background-color', 'border-color', 'fill', 'outline-color'], space: ['padding', 'margin', 'gap', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'row-gap', 'column-gap'], radius: ['border-radius'], size: ['font-size', 'line-height'], type: ['font-family', 'font'] };
export const propsFor = (group, value) => (group === 'type' && /^\s*(\d{3}\s+)?[\d.]+(px|rem)/.test(value) ? ['font'] : PROPS[group] || []);

// the sample is always 16px: a display face at 72px would swallow the strip
const typeSample = (value) => { const m = /^\s*(?:(\d{3})\s+)?[\d.]+(?:px|rem)(?:\/[\d.]+(?:px|rem)?)?\s+(.*)$/.exec(value); return m ? `${m[1] ?? 400} 16px ${esc(m[2])}` : `16px ${esc(value)}`; };
export function stripsHtml(groups, used = new Set(), filter = '') {
  const f = filter.trim().toLowerCase();
  const sec = Object.keys(TITLES).map((g) => {
    const items = groups[g].filter((v) => !f || v.name.toLowerCase().includes(f) || String(v.value).toLowerCase().includes(f));
    if (!items.length) return '';
    const chip = (v, i) => {
      const dot = used.has(v.name) ? '<i class="ivdot" title="used by this element"></i>' : '';
      const sample = g === 'color' ? `<span class="sw" style="background:${esc(v.value)}"></span>`
        : g === 'type' ? `<span class="ivtype" style="font:${typeSample(v.value)}">Aa</span>`
        : `<span class="ivbar" style="width:${Math.max(2, Math.min(44, v.px * 1.1))}px"></span>`;
      return `<button type="button" class="ivchip vc-${g}" tabindex="${i === 0 ? 0 : -1}" data-var="${esc(v.name)}" data-group="${g}" data-value="${esc(v.value)}" title="${esc(v.name)}: ${esc(v.value)}. Click to use it on the value you are on, or drag it onto an element." aria-label="${esc(v.name)} ${esc(v.value)}">${sample}${dot}<span class="ivname">${esc(v.name.replace(/^--/, ''))}</span>${g === 'color' ? '' : `<span class="ivval">${esc(String(v.value).slice(0, 14))}</span>`}</button>`;
    };
    const open = expanded.has(g) || !!f || items.length < 7;
    return `<div class="ivstrip vs-${g}" role="group" aria-label="${TITLES[g]} variables"><h4>${TITLES[g]} <small>${items.length}</small>${items.length < 7 || f ? '' : `<button type="button" class="ivmore" data-strip="${g}" aria-expanded="${open}">${open ? 'show fewer' : 'show all'}</button>`}</h4><div class="ivchips"${open ? '' : ' data-collapsed="1"'}>${items.map((v, i) => chip(v, i)).join('')}</div></div>`;
  }).join('');
  return sec || '<p class="hint">No variables match.</p>';
}

// env: { ctx, panel, bind(name, group, value, prop?) , propsSet(group) -> [prop,...] set on the selected element }
export function wireStrips(env) {
  const { ctx, panel } = env;
  const root = panel.querySelector('#doc-vars');
  if (!root) return;
  const filter = root.querySelector('#doc-vars-filter');
  const body = root.querySelector('#doc-vars-body');
  filter?.addEventListener('input', () => { body.innerHTML = env.render(filter.value); });
  root.addEventListener('click', (ev) => {
    const more = ev.target.closest?.('.ivmore');
    if (more) { const g = more.dataset.strip; if (expanded.has(g)) expanded.delete(g); else expanded.add(g); body.innerHTML = env.render(filter.value); body.querySelector(`.ivmore[data-strip="${g}"]`)?.focus(); return; }
    const chip = ev.target.closest?.('.ivchip'); if (!chip || chip.dataset.dragged) { if (chip) delete chip.dataset.dragged; return; }
    env.bind(chip.dataset.var, chip.dataset.group, chip.dataset.value);
  });
  // one Tab stop per strip: arrows move between its chips (Home and End jump)
  root.addEventListener('keydown', (ev) => {
    const chip = ev.target.closest?.('.ivchip'); if (!chip || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const list = [...chip.closest('.ivchips').querySelectorAll('.ivchip')], i = list.indexOf(chip);
    const to = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? list[i + 1] : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? list[i - 1] : ev.key === 'Home' ? list[0] : ev.key === 'End' ? list.at(-1) : null;
    if (!to) return;
    ev.preventDefault(); list.forEach((c) => { c.tabIndex = c === to ? 0 : -1; }); to.focus();
  });
  // hovering or focusing a variable shows where it is used (the stage lights it up, when the stage can)
  const lit = (name) => { try { name ? ctx.stage?.highlight?.({ variable: name }) : ctx.stage?.clearHighlight?.(); } catch { /* the stage may not know */ } };
  root.addEventListener('pointerover', (ev) => { const c = ev.target.closest?.('.ivchip'); if (c) lit(c.dataset.var); });
  root.addEventListener('pointerout', (ev) => { if (ev.target.closest?.('.ivchip')) lit(null); });
  root.addEventListener('focusin', (ev) => {
    const c = ev.target.closest?.('.ivchip'); if (!c) return;
    lit(c.dataset.var);
    const chips = c.closest('.ivchips');
    if (chips?.dataset.collapsed && c.offsetTop > 4) { expanded.add(c.dataset.group); const v = c.dataset.var; body.innerHTML = env.render(filter.value); body.querySelector(`.ivchip[data-var="${CSS.escape(v)}"]`)?.focus(); }
  });
  root.addEventListener('focusout', (ev) => { if (ev.target.closest?.('.ivchip')) lit(null); });

  // ---- drag a variable onto an element (pointer events, so the same code serves a mouse, a pen and a test) ----
  root.addEventListener('pointerdown', (ev) => {
    const chip = ev.target.closest?.('.ivchip'); if (!chip || ev.button !== 0) return;
    const x0 = ev.clientX, y0 = ev.clientY; let ghost = null, over = null;
    const hit = (x, y) => {
      for (const [id, sec] of ctx.stage.sections) { const p = sec.docFrame?.pick(x, y); if (p) return { component: id, node: p.dataset.n, el: p }; }
      return null;
    };
    const move = (e) => {
      if (!ghost && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      if (!ghost) { ghost = document.createElement('div'); ghost.className = 'ivghost'; ghost.textContent = chip.dataset.var; document.body.append(ghost); chip.dataset.dragged = '1'; document.body.dataset.varDrag = '1'; }
      ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
      const h = hit(e.clientX, e.clientY); over = h;
      ctx.emit('var-drag-over', h ? { component: h.component, node: h.node } : null);
      drawTarget(h);
    };
    const done = (e) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', done); removeEventListener('pointercancel', done);
      ghost?.remove(); delete document.body.dataset.varDrag; drawTarget(null);
      if (ghost && e.type === 'pointerup') { const h = hit(e.clientX, e.clientY) || over; if (h) drop(h); }
      setTimeout(() => delete chip.dataset.dragged, 0);
    };
    const drop = async (h) => {
      ctx.select({ component: h.component, node: h.node, variant: {} });
      await env.bindTo({ component: h.component, node: h.node }, chip.dataset.var, chip.dataset.group, chip.dataset.value);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', done); addEventListener('pointercancel', done);
  });
  let targetBox = null;
  function drawTarget(h) {
    if (!h) { targetBox?.remove(); targetBox = null; return; }
    const r = h.el.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
    if (!targetBox) { targetBox = document.createElement('div'); targetBox.className = 'ivdrop'; document.querySelector('#stage').append(targetBox); }
    Object.assign(targetBox.style, { left: `${r.left - s.left}px`, top: `${r.top - s.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
}

// "Which property?": a small modal list, native <dialog> so Tab, Escape and focus return are the browser's.
export function askProp({ name, group, value, setHere, target, hint = '' }) {
  return new Promise((resolve) => {
    const props = [...new Set([...setHere, ...propsFor(group, value)])];
    const d = document.createElement('dialog');
    d.className = 'ivask'; d.setAttribute('aria-label', `Use ${name} on`);
    d.innerHTML = `<form method="dialog"><h2>Use <code>${esc(name)}</code> on <code>${esc(target)}</code></h2>
      <div class="ivopts">${props.map((p, i) => `<button type="submit" value="${esc(p)}"${i === 0 ? ' autofocus' : ''}>${esc(p)}${setHere.includes(p) ? '<span class="ivset">set here</span>' : ''}</button>`).join('')}</div>
      <p class="hint">${esc(hint)}</p><p class="hint">Esc to cancel</p></form>`;
    d.addEventListener('close', () => { const v = d.returnValue || null; d.remove(); resolve(v); });
    document.body.append(d); d.showModal();
  });
}
export { kindOfProp };
