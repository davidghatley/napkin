// AGT-03 on the page. Each connected agent has a colour and a name (from the server). While one is editing (presence frames):
// a coloured outline and name tag on its node, a fading trail from the nodes it just worked on, and in the top bar an avatar
// stack (you, then the agents) whose tooltip says "N agents". It clears when the server says so (<= 1 s after the last edit) and at once on disconnect.
//   ctx.presence = { agents(), live(), colorOf(name), boxes(), refresh() }
import { h } from './drawer.js';

const TRAIL_MS = 2600;   // how long a node the agent has left stays drawn, fading
const TRAIL_MAX = 4;
const initial = (name) => (name.match(/[a-z0-9]/i)?.[0] ?? '?');
const now = () => performance.now();
const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

export function initPresence(ctx) {
  const overlays = document.querySelector('#overlays');
  const layer = h('div', { id: 'presence-layer', 'aria-hidden': 'true' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const trailSvg = document.createElementNS(svgNS, 'svg'); trailSvg.id = 'presence-trail';
  layer.append(trailSvg);
  overlays.append(layer);

  const roster = new Map();  // name -> { name, color, ink } connected agents, in connection order
  const known = new Map();   // every name we have a colour for
  const live = new Map();    // name -> { frame, trail: [{ component, node, variant, t }], box }
  let rafId = 0;

  const colorOf = (name) => known.get(name) ?? { color: null, ink: null };
  const remember = (name, color, ink) => { if (name && color) known.set(name, { color, ink }); };

  // ---------------------------------------------------------------------------------------------- finding the node
  const sectionOf = (id) => document.querySelector(`section.cmp[data-component="${CSS.escape(id)}"]`);
  function elementFor({ component, node, variant }) {
    const sec = sectionOf(component);
    if (!sec) return null;
    const cells = [...sec.querySelectorAll('.cell')];
    let cell = variant && cells.find((c) => same(JSON.parse(c.dataset.variant || '{}'), variant));
    if (!cell) { // the first cell that is on screen, else the first
      const st = document.querySelector('#stage').getBoundingClientRect();
      cell = cells.find((c) => { const r = c.getBoundingClientRect(); return r.width && r.right > st.left && r.left < st.right && r.bottom > st.top && r.top < st.bottom; }) ?? cells[0];
    }
    const el = node && cell?.querySelector(`.mount [data-n="${CSS.escape(node)}"]`);
    return el || sec.querySelector('.frame') || sec;
  }

  // ---------------------------------------------------------------------------------------------- avatars and the tooltip
  const stack = h('div', { id: 'avatars', tabindex: '0', role: 'group' });
  document.querySelector('.top-right .slot')?.prepend(stack);
  const tip = h('div', { id: 'avatar-tip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  const showTip = () => {
    const names = [...roster.keys()];
    const rows = names.map((n) => { const p = live.get(n)?.frame; return h('div', { class: 'tip-row', style: `--c:${roster.get(n).color}` }, h('i'), h('span', { text: n }), p ? h('em', { text: `editing ${ctx.state.components.get(p.component)?.name ?? ''}${p.node ? ' · ' + p.node : ''}` }) : null); });
    tip.replaceChildren(h('div', {}, h('b', { text: names.length ? `${names.length} agent${names.length === 1 ? '' : 's'}` : 'No agents connected' }), names.length ? null : h('span', { text: ' · just you' })), ...rows);
    const r = stack.getBoundingClientRect();
    tip.hidden = false;
    tip.style.top = `${r.bottom + 6}px`; tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.right - tip.offsetWidth))}px`;
  };
  const hideTip = () => { tip.hidden = true; };
  stack.addEventListener('pointerenter', showTip); stack.addEventListener('pointerleave', hideTip);
  stack.addEventListener('focus', showTip); stack.addEventListener('blur', hideTip);

  function drawAvatars() {
    const names = [...roster.keys()], shown = names.slice(0, 4);
    stack.replaceChildren(...[
      h('span', { class: 'av you', 'data-agent': 'you', text: 'Y', title: 'You' }),
      ...shown.map((n) => [h('span', { class: 'av', 'data-agent': n, 'data-live': live.has(n) ? '1' : '0', style: `--c:${roster.get(n).color};--ink:${roster.get(n).ink}`, text: initial(n) }),
        names.length <= 2 ? h('span', { class: 'av-name', 'data-agent': n, text: n }) : null]).flat(), // one or two agents: the name is written out, no hover needed
      names.length > 4 ? h('span', { class: 'av more', text: `+${names.length - 4}` }) : null].filter(Boolean));
    stack.dataset.names = names.length <= 2 ? '1' : '0';
    const label = names.length ? `You and ${names.length} agent${names.length === 1 ? '' : 's'}: ${names.join(', ')}` : 'Just you; no agents connected';
    stack.setAttribute('aria-label', label);
    stack.dataset.agents = String(names.length);
    if (!tip.hidden) showTip();
  }

  // ---------------------------------------------------------------------------------------------- drawing
  function boxFor(name, a) {
    if (a.box) return a.box;
    a.box = h('div', { class: 'pbox', 'data-agent': name, 'data-fresh': '1' }, h('span', { class: 'ptag' }, h('span', { class: 'pname', text: name }), h('small', { class: 'pwhat' })));
    layer.append(a.box);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (a.box) delete a.box.dataset.fresh; }));
    return a.box;
  }
  const centre = (r, base) => [r.left + r.width / 2 - base.left, r.top + r.height / 2 - base.top];
  function paint() {
    rafId = 0;
    const base = overlays.getBoundingClientRect(), t = now();
    const placed = new Map(); // element -> how many agents already outline it
    const tags = []; // name tags already placed this frame: {x0, x1, y0, y1}; a tag that would sit on one of them is lifted a row
    const lines = [];
    let animating = false;
    for (const [name, a] of live) {
      const f = a.frame, el = elementFor(f);
      const box = boxFor(name, a), col = known.get(name) ?? { color: f.color, ink: f.ink };
      if (!el || el.closest('[data-cull]') || !el.isConnected) { box.style.display = 'none'; continue; }
      const slot = placed.get(el) ?? 0; placed.set(el, slot + 1);
      const r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.setProperty('--c', col.color); box.style.setProperty('--ink', col.ink);
      box.style.setProperty('--off', `${2 + slot * 4}px`); box.style.setProperty('--slot', String(slot));
      // tags of nested or adjacent nodes land on each other: lift this one by a tag row until it is clear of the tags already drawn
      const tw = box.querySelector('.ptag').offsetWidth, tx = r.left - base.left - (2 + slot * 4) - 2;
      let lift = 0;
      for (let n = 0; n < 8; n++) {
        const y1 = r.top - base.top - (2 + slot * 4) - 4 - slot * 21 - lift * 21;
        if (!tags.some((o) => tx < o.x1 && tx + tw > o.x0 && y1 - 19 < o.y1 && y1 > o.y0)) { tags.push({ x0: tx, x1: tx + tw, y0: y1 - 19, y1 }); break; }
        lift++;
      }
      box.style.setProperty('--lift', String(lift)); box.dataset.lift = String(lift);
      box.style.width = `${r.width}px`; box.style.height = `${r.height}px`;
      box.style.transform = `translate(${r.left - base.left}px, ${r.top - base.top}px)`;
      box.dataset.component = f.component; box.dataset.node = f.node ?? ''; box.dataset.slot = String(slot);
      box.querySelector('.pwhat').textContent = f.node ? `${f.node}` : '';
      // the trail: nodes the agent has just left, joined by a dashed line, fading with the time since it left
      while (a.trail.length > 1 && t - a.trail[1].t >= TRAIL_MS) a.trail.shift();
      for (let i = 0; i < a.trail.length - 1; i++) {
        const pel = elementFor(a.trail[i]), nel = i + 1 === a.trail.length - 1 ? el : elementFor(a.trail[i + 1]);
        if (!pel?.isConnected || !nel?.isConnected) continue;
        const op = Math.max(0, 1 - (t - a.trail[i + 1].t) / TRAIL_MS);
        const pr = pel.getBoundingClientRect(), nr = nel.getBoundingClientRect();
        if (pel !== nel) {
          lines.push({ kind: 'rect', x: pr.left - base.left, y: pr.top - base.top, w: pr.width, h: pr.height, op: op * 0.85, c: col.color });
          lines.push({ kind: 'line', a: centre(pr, base), b: centre(nr, base), op, c: col.color });
        }
      }
      if (a.trail.length > 1) animating = true;
    }
    // remove boxes of agents that cleared
    for (const el of layer.querySelectorAll('.pbox')) if (!live.has(el.dataset.agent)) el.remove();
    trailSvg.replaceChildren(...lines.map((l) => {
      if (l.kind === 'rect') { const e = document.createElementNS(svgNS, 'rect'); e.setAttribute('x', l.x - 2); e.setAttribute('y', l.y - 2); e.setAttribute('width', l.w + 4); e.setAttribute('height', l.h + 4); e.setAttribute('rx', 3); e.style.setProperty('--c', l.c); e.style.opacity = l.op; return e; }
      const e = document.createElementNS(svgNS, 'line'); e.setAttribute('x1', l.a[0]); e.setAttribute('y1', l.a[1]); e.setAttribute('x2', l.b[0]); e.setAttribute('y2', l.b[1]); e.style.setProperty('--c', l.c); e.style.opacity = l.op; return e;
    }));
    layer.dataset.trail = String(lines.filter((l) => l.kind === 'line').length);
    if (animating && !rafId) rafId = requestAnimationFrame(paint);
  }
  const schedule = () => { if (!rafId) rafId = requestAnimationFrame(paint); };
  const refresh = () => { if (rafId) cancelAnimationFrame(rafId); paint(); }; // synchronous, for view moves (no frame behind)

  function words() {
    const text = [...live.values()].map((a) => a.frame.label).filter(Boolean).join(' · ');
    const el = document.querySelector('#presence'); if (el) el.textContent = text;
  }

  // ---------------------------------------------------------------------------------------------- frames from the server
  function onPresence(f) {
    remember(f.agent, f.color, f.ink);
    if (!f.agent) return;
    if (!f.label) { // cleared: the outline and the trail go at once
      if (live.delete(f.agent)) { drawAvatars(); words(); refresh(); document.querySelector(`.pbox[data-agent="${CSS.escape(f.agent)}"]`)?.remove(); }
      ctx.emit('presence-clear', f);
      return;
    }
    const a = live.get(f.agent) ?? { trail: [], box: null };
    const last = a.trail.at(-1);
    if (!last || last.component !== f.component || last.node !== f.node) { a.trail.push({ component: f.component, node: f.node, variant: f.variant, t: now() }); if (a.trail.length > TRAIL_MAX + 1) a.trail.shift(); }
    a.frame = f; live.set(f.agent, a);
    drawAvatars(); words(); refresh(); schedule();
    ctx.emit('presence-on', f);
  }
  function onAgents(f) {
    roster.clear();
    for (const a of f.agents ?? []) { roster.set(a.name, a); remember(a.name, a.color, a.ink); }
    for (const name of [...live.keys()]) if (!roster.has(name) && !f.agents?.some((x) => x.name === name)) { /* an agent that used HTTP only keeps its presence until the server clears it */ }
    drawAvatars();
  }
  ctx.on('presence', onPresence);
  ctx.on('agents', onAgents);
  ctx.on('change', (f) => remember(f.by, f.color, f.ink));
  for (const ev of ['view', 'viewsettle', 'layout', 'render', 'moved', 'select', 'drawer']) ctx.on(ev, (v) => { if (ev === 'view' && v.gesture && !live.size) return; refresh(); }); // (no agent outlines to move: a gesture frame needs nothing)
  addEventListener('resize', refresh);
  drawAvatars();

  ctx.presence = {
    agents: () => [...roster.values()],
    live: () => [...live.entries()].map(([name, a]) => ({ name, ...a.frame })),
    colorOf, remember, refresh,
    boxes: () => [...layer.querySelectorAll('.pbox')].map((b) => ({ agent: b.dataset.agent, node: b.dataset.node, component: b.dataset.component, slot: Number(b.dataset.slot), rect: b.getBoundingClientRect().toJSON() })),
  };
}
