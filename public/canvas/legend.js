// The status bar says what the keys do right now, in one place. A piece of the product that takes over the keys pushes its
// legend under a name and pops it when it is done; the newest one shows; with none, the canvas's own keys show.
//   initLegend(ctx) -> ctx.legend = { push(name, [[key, words], ...]), pop(name), read() }
export function initLegend(ctx) {
  const host = document.querySelector('#statusbar .hints');
  const home = host?.innerHTML ?? '';
  let stack = [];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const paint = () => { if (!host) return; const top = stack.at(-1); host.innerHTML = top ? top.keys.map(([k, w]) => `<span class="h"><kbd>${esc(k)}</kbd> ${esc(w)}</span>`).join(' ') : home; host.dataset.legend = top?.name ?? ''; };
  ctx.legend = {
    push(name, keys) { const had = stack.find((x) => x.name === name); if (had && JSON.stringify(had.keys) === JSON.stringify(keys) && stack.at(-1) === had) return; stack = [...stack.filter((x) => x.name !== name), { name, keys }]; paint(); },
    pop(name) { if (!stack.some((x) => x.name === name)) return; stack = stack.filter((x) => x.name !== name); paint(); },
    read: () => stack.at(-1)?.name ?? null,
  };
  ctx.on('highlight', (h) => { if (h && !h.quiet) ctx.legend.push('highlight', [['Tab', 'next place'], ['⇧Tab', 'back'], ['Esc', 'done']]); else ctx.legend.pop('highlight'); });
  return ctx.legend;
}
