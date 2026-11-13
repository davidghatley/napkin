// The full diff for a proposal (D5): everything the person is asked to approve, with the changed lines marked and
// unchanged runs folded. Keyboard: D opens it from a card; n / p jump between changes; a, x, s decide; Escape closes.
import { h } from './drawer.js';

// Line diff by longest common subsequence on the lines between the shared head and tail (fast for the usual "one region changed" case).
export function diffLines(oldText, newText) {
  const a = oldText === '' ? [] : oldText.split('\n'), b = newText === '' ? [] : newText.split('\n');
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb), out = [];
  for (let i = 0; i < s; i++) out.push({ t: ' ', text: a[i], a: i + 1, b: i + 1 });
  if (A.length * B.length > 4_000_000) { // too big for a table: show the middle as one replaced block
    A.forEach((text, i) => out.push({ t: '-', text, a: s + i + 1 })); B.forEach((text, i) => out.push({ t: '+', text, b: s + i + 1 }));
  } else {
    const n = A.length, m = B.length, w = m + 1, L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { out.push({ t: ' ', text: A[i], a: s + i + 1, b: s + j + 1 }); i++; j++; }
      else if (j < m && (i >= n || L[i * w + j + 1] >= L[(i + 1) * w + j])) { out.push({ t: '+', text: B[j], b: s + j + 1 }); j++; }
      else { out.push({ t: '-', text: A[i], a: s + i + 1 }); i++; }
    }
  }
  for (let i = ea; i < a.length; i++) out.push({ t: ' ', text: a[i], a: i + 1, b: eb + (i - ea) + 1 });
  return out;
}
// Hunks: index ranges [from, to] of the changed lines with `ctx` lines of context either side.
export function hunks(lines, ctx = 3) {
  const out = [];
  lines.forEach((l, i) => {
    if (l.t === ' ') return;
    const from = Math.max(0, i - ctx), to = Math.min(lines.length - 1, i + ctx), last = out.at(-1);
    if (last && from <= last.to + 1) last.to = to; else out.push({ from, to });
  });
  return out;
}
export const changeCount = (lines) => lines.filter((l) => l.t !== ' ').length;

export function openDiff({ proposal: p, old, next, image, actions, onClose }) {
  const prevFocus = document.activeElement;
  const lines = p.kind === 'control' ? null : image ? null : diffLines(old ?? '', next ?? '');
  const changed = lines ? changeCount(lines) : 0;
  const body = h('div', { class: 'rdf-body', tabindex: '0', 'aria-label': `Changes to ${p.path}` });
  if (lines) {
    const ranges = old == null ? [{ from: 0, to: lines.length - 1 }] : hunks(lines, 3);
    let prev = -1;
    for (const r of ranges) {
      if (r.from - prev - 1 > 0) body.append(h('div', { class: 'rdf-fold', text: `… ${r.from - prev - 1} unchanged lines …` }));
      for (let i = r.from; i <= r.to; i++) {
        const l = lines[i];
        body.append(h('div', { class: 'rdf-line', 'data-t': l.t === ' ' ? 'same' : l.t === '+' ? 'add' : 'del', ...(l.t !== ' ' && (i === 0 || lines[i - 1].t === ' ') ? { 'data-change': '1' } : {}) },
          h('span', { class: 'rdf-n', text: l.a ?? '' }), h('span', { class: 'rdf-n', text: l.b ?? '' }), h('span', { class: 'rdf-s', 'aria-hidden': 'true', text: l.t }), h('code', { text: l.text })));
      }
      prev = r.to;
    }
    if (lines.length - 1 - prev > 0 && old != null) body.append(h('div', { class: 'rdf-fold', text: `… ${lines.length - 1 - prev} unchanged lines …` }));
  } else if (image) body.append(h('img', { class: 'rdf-img', src: image, alt: `Proposed ${p.path}` }));
  else body.append(h('p', { text: `${p.label ?? p.control}: ${JSON.stringify(p.before)} → ${JSON.stringify(p.value)}` }));
  const summary = lines ? (old == null ? `New file, ${lines.length} lines` : changed ? `${lines.filter((l) => l.t === '+').length} added, ${lines.filter((l) => l.t === '-').length} removed` : 'No text changes') : '';
  const dlg = h('div', { class: 'rdf', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Review ${p.path}` },
    h('div', { class: 'rdf-top' }, h('b', { text: p.path ?? p.label }), h('span', { class: 'rdf-sum', text: summary }), h('span', { class: 'rdf-keys', text: 'N / P next / previous change · A approve · X reject · S send back · Esc close' })),
    body, h('div', { class: 'rdf-actions' }, ...actions.map((a) => h('button', { type: 'button', class: `rp-btn${a.kind ? ' ' + a.kind : ''}`, onclick: () => { close(); a.run(); } }, a.text, h('kbd', { text: a.key })))));
  const back = h('div', { class: 'rdf-back' }, dlg);
  document.body.append(back);
  const marks = () => [...body.querySelectorAll('[data-change]')];
  let at = -1;
  const jump = (d) => { const m = marks(); if (!m.length) return; at = (at + d + m.length) % m.length; m[at].scrollIntoView({ block: 'center' }); m.forEach((x) => x.removeAttribute('data-current')); m[at].dataset.current = '1'; };
  function close() { back.remove(); onClose?.(); try { prevFocus?.focus?.(); } catch { /* gone */ } }
  function key(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (k === 'escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (k === 'n') { ev.preventDefault(); jump(1); } else if (k === 'p') { ev.preventDefault(); jump(-1); }
    else { const a = actions.find((x) => x.key.toLowerCase() === k); if (a) { ev.preventDefault(); ev.stopPropagation(); close(); a.run(); } }
  }
  back.onkeydown = key; // on the dialog, which holds focus while it is open
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  body.focus(); jump(1);
  return close;
}
