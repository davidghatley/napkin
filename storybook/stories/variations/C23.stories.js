import { variation } from '../../lib/variation.js';
import css from './C23.css?raw';
import fonts from './C23.fonts.css?raw';

// Same title as the item's Current stories. Secret Sauce tokens are defined in C23.css (the Hoop face is inlined in C23.fonts.css).
export default { title: '3 Components/C23 Value row', parameters: { layout: 'fullscreen' } };

// One set of five rows for every variation: the three Current states (a length, a colour with a variable, a shorthand with a variable)
// plus an overridden value (inline style beats a rule) and an inherited one.
const D = [
  { p: 'padding', v: '1px 7px', kind: 'box', nums: [1, 7], max: 16, src: { k: 'rule', sel: '.ss-pill', at: 'components.css:117' } },
  { p: 'color', v: 'var(--teal-text)', kind: 'color', src: { k: 'rule', sel: '.ss-pill--ok', at: 'components.css:118' }, vr: { n: '--teal-text', at: ':root · tokens.css:52' } },
  { p: 'border', v: 'var(--line-hair) solid currentColor', kind: 'line', w: 1, src: { k: 'rule', sel: '.ss-pill', at: 'components.css:117' }, vr: { n: '--line-hair', at: ':root · tokens.css:108' } },
  { p: 'gap', v: '6px', kind: 'len', n: 6, max: 16, src: { k: 'inline', sel: 'style=""', at: 'inline' }, lost: { v: '4px', n: 4, sel: '.ss-pill', at: 'components.css:117' } },
  { p: 'font-size', v: '13px', kind: 'len', n: 13, max: 24, src: { k: 'inh', sel: 'body', at: 'base.css:4' } },
];
const e = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tip = (d) => d.src.k === 'inline' ? 'inline style' + (d.lost ? ` · beats ${d.lost.sel} ${d.lost.at} (${d.lost.v})` : '')
  : (d.src.k === 'inh' ? 'inherited from ' : 'rule ') + d.src.sel + ' ' + d.src.at + (d.vr ? ` · ${d.vr.n} defined in ${d.vr.at}` : '');
const sty = (d) => d.kind === 'color' ? ' style="--v:var(--ss-teal-text)"' : '';
const fld = (d, extra = '') => `<input class="fld" value="${e(d.v)}" aria-label="${d.p}" title="${e(tip(d))}" spellcheck="false" ${extra}>`;
const nm = (d) => `<label class="nm">${d.p}</label>`;
// origin marks: square = a rule, circle = a variable, triangle = inline style, dashed diamond = inherited
const G = {
  rule: (c = 'k-c') => `<svg class="g ${c}" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="currentColor"/></svg>`,
  var: (c = 'k-c') => `<svg class="g ${c}" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4.2" fill="currentColor"/></svg>`,
  inline: (c = 'k-c') => `<svg class="g ${c}" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .8 9.4 9H.6z" fill="currentColor"/></svg>`,
  inh: (c = 'k-m') => `<svg class="g ${c}" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 9 5 5 9 1 5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.4"/></svg>`,
};
const mark = (d) => G[d.vr ? 'var' : d.src.k](d.src.k === 'inh' ? 'k-m' : 'k-c');

const SCRIPT = `(function(){function set(s,n){var m=+s.dataset.max;n=Math.max(0,Math.min(m,n));s.style.setProperty('--f',n/m);s.setAttribute('aria-valuenow',n);var r=s.closest('.r');r.querySelectorAll('[data-out="'+(s.dataset.i||0)+'"]').forEach(function(o){o.textContent=n+'px'});var i=r.querySelector('input[data-single]');if(i)i.value=n+'px'}
document.addEventListener('pointerdown',function(e){var s=e.target.closest('[data-scrub]');if(!s)return;e.preventDefault();s.focus();var m=function(ev){var b=s.getBoundingClientRect();set(s,Math.round((ev.clientX-b.left)/b.width*s.dataset.max))};m(e);var u=function(){removeEventListener('pointermove',m);removeEventListener('pointerup',u)};addEventListener('pointermove',m);addEventListener('pointerup',u)});
document.addEventListener('keydown',function(e){var s=e.target.closest&&e.target.closest('[data-scrub]');if(!s)return;var d={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1}[e.key];if(d){e.preventDefault();set(s,+s.getAttribute('aria-valuenow')+d)}})})();`;

// a scrub track: --f is the 0..1 fill
const scrub = (d, n, i = 0, cls = '', inner = '') => `<div class="trk ${cls}" data-scrub data-max="${d.max}" data-i="${i}" tabindex="0" role="slider" aria-label="${d.p}" aria-valuemin="0" aria-valuemax="${d.max}" aria-valuenow="${n}" style="--f:${n / d.max}">${inner}</div>`;

const build = (cls, rows, head = '') => (cur) => `<div class="cv ${cls}">${head}${D.map(rows).join('')}</div><script>${SCRIPT}</script>`;
const V = (cls, rows, head) => ({ item: 'C23', state: 1, css: fonts + css, html: build(cls, rows, head) });
const story = (name, description, cfg) => ({ name, parameters: { docs: { description: { story: description } } }, render: variation(cfg) });

// 01 -------------------------------------------------------------------------------------------------------------------
const r01 = (d) => `<div class="r" data-s="${d.vr ? 'var' : d.src.k}" data-prop="${d.p}" title="${e(tip(d))}">${nm(d)}${fld(d)}</div>`
  + (d.lost ? `<div class="r" data-s="lost" title="${e(tip(d))}"><label class="nm">${d.p}</label><input class="fld st" value="${d.lost.v}" aria-label="${d.p} (overridden)" spellcheck="false"></div>` : '');
export const V01 = story('Variation 01 · Origin rail', 'Origin is the rail on the row\'s left edge: solid = a rule, double = through a variable, ink = inline, dashed = inherited, a red rail under the value = the one it beat. Replaces the "components.css:117" lines.', V('v01', r01));

// 02 -------------------------------------------------------------------------------------------------------------------
const glyph02 = (d) => d.kind === 'box' ? `<span class="l2" style="--x:${Math.min(d.nums[1], 10) * 0.9}px;--y:${d.nums[0] * 0.9}px"><i></i></span>`
  : d.kind === 'color' ? `<i class="sw" style="--v:var(--ss-teal-text)"></i>` : d.kind === 'line' ? `<span class="ln" style="--w:${d.w}px"></span>` : `<i class="bar" style="--n:${d.n}"></i>`;
const r02 = (d) => `<div class="r" data-prop="${d.p}"><span class="gl">${glyph02(d)}</span>${nm(d)}${fld(d)}<span class="org" title="${e(tip(d))}">${mark(d)}</span></div>`;
export const V02 = story('Variation 02 · Value drawn as itself', 'Each value gets a drawing of itself: padding as a box with its inner gap, colour as the swatch, border as the real line, a length as a bar. Replaces reading the number and the resolved value.', V('v02', r02));

// 03 -------------------------------------------------------------------------------------------------------------------
const steps = () => [-3, -2, -1, 0, 1, 2, 3].map((k) => `<i class="${k ? '' : 'cur'}" style="--c:${k < 0 ? `color-mix(in srgb,var(--v) ${100 + k * 22}%,var(--ss-sheet))` : k > 0 ? `color-mix(in srgb,var(--v) ${100 - k * 22}%,var(--ss-ink))` : 'var(--v)'}"></i>`).join('');
const r03 = (d) => {
  let body;
  if (d.kind === 'color') body = `<div class="steps">${steps()}</div>`;
  else if (d.kind === 'line') body = `<div class="line"><i style="--w:${d.w}px"></i></div>`;
  else if (d.kind === 'box') body = scrub(d, d.nums[0], 0, '', '<i></i><b></b>') + scrub(d, d.nums[1], 1, '', '<i></i><b></b>');
  else body = scrub(d, d.n, 0, '', '<i></i><b></b>') + (d.lost ? scrub({ ...d }, d.lost.n, 0, 'lost', '<i></i><b></b>').replace('data-scrub ', '').replace('tabindex="0"', 'tabindex="-1"') : '');
  const out = d.kind === 'box' ? `<output data-out="0">${d.nums[0]}px</output> <output data-out="1">${d.nums[1]}px</output>` : d.kind === 'len' ? `<output data-out="0">${d.n}px</output>` : '';
  return `<div class="r" data-prop="${d.p}"${sty(d)}><div class="hd">${'<span class="nm">' + mark(d) + d.p + '</span>'}${fld(d, d.kind === 'len' ? 'data-single' : '').replace('class="fld"', 'class="fld" style="width:150px"')}</div>${body}</div>`;
};
export const V03 = story('Variation 03 · Ruler scrub', 'Lengths are a ruled bar you drag (arrow keys too); colours are a seven-step strip of neighbours; a border is its line at true weight. Replaces typing numbers and nudging.', V('v03', r03));

// 04 -------------------------------------------------------------------------------------------------------------------
const wire = (d) => {
  const S = 'style="color:var(--ss-cobalt-text)"';
  if (d.lost) return `<svg class="w" viewBox="0 0 72 34" aria-hidden="true"><path d="M0 17H18" ${S}/><path class="f" d="M24 11.5 29 22H19z" ${S}/><path d="M32 17H40" stroke="var(--ss-verm-text)" class="d"/><path d="M44 12V22" stroke="var(--ss-verm-text)"/><rect x="50" y="12" width="9" height="9" stroke="var(--ss-verm-text)"/></svg>`;
  if (d.src.k === 'inh') return `<svg class="w" viewBox="0 0 72 34" aria-hidden="true" style="color:var(--ss-muted)"><path class="d" d="M0 17H24V5"/><path d="M19 9 24 2 29 9" /><path d="M24 17" /></svg>`;
  if (d.src.k === 'inline') return `<svg class="w" viewBox="0 0 72 34" aria-hidden="true" ${S}><path d="M0 17H17"/><path class="f" d="M24 11.5 29 22H19z"/></svg>`;
  if (d.vr) return `<svg class="w" viewBox="0 0 72 34" aria-hidden="true" ${S}><path d="M0 17H20"/><rect x="20" y="12.5" width="9" height="9" class="f"/><path d="M29 17H48"/><circle cx="53" cy="17" r="5" class="f"/></svg>`;
  return `<svg class="w" viewBox="0 0 72 34" aria-hidden="true" ${S}><path d="M0 17H20"/><rect x="20" y="12.5" width="9" height="9" class="f"/></svg>`;
};
const r04 = (d) => `<div class="r" data-prop="${d.p}" title="${e(tip(d))}">${nm(d)}${fld(d)}${wire(d)}</div>`;
export const V04 = story('Variation 04 · Wire to source', 'A wire runs from the field to its source: square = rule, circle = the variable behind it, triangle = inline, dashed up-arrow = inherited from the parent, red break = beaten. Replaces the origin text lines.', V('v04', r04));

// 05 -------------------------------------------------------------------------------------------------------------------
const chip = (d) => {
  const lead = d.kind === 'color' ? `<i class="sw" style="--v:var(--ss-teal-text)"></i>` : `<span class="ln"><i style="--w:${d.w}px"></i></span>`;
  return `<button type="button" class="chip" aria-label="${d.p}: ${d.vr.n}, click to detach" title="${e(tip(d))}">${lead}<span>${d.vr.n}</span><svg class="g x" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2 8 8M8 2 2 8" stroke="currentColor" stroke-width="1.5"/></svg></button>`;
};
const r05 = (d) => `<div class="r" data-prop="${d.p}"${sty(d)}>${nm(d)}${d.vr ? chip(d) : fld(d)}<span title="${e(tip(d))}">${mark(d)}</span></div>`
  + (d.lost ? `<div class="r" data-s="lost"><label class="nm"></label><input class="fld st" value="${d.lost.v}" aria-label="${d.p} (overridden)"><span>${G.rule('k-v')}</span></div>` : '');
export const V05 = story('Variation 05 · Variable as swatch chip', 'A value that comes from a variable becomes a pill that looks like the thing it holds (disc of the colour, the line at its weight); plain values stay plain fields; hover shows the unlink cross. Replaces the "defined in :root tokens.css:52" line.', V('v05', r05));

// 06 -------------------------------------------------------------------------------------------------------------------
const r06 = (d) => {
  const lvl = d.lost ? 'has' : d.vr ? 'has' : d.src.k === 'inh' ? 'inh' : '';
  const b1 = d.vr ? `<div class="back">${d.kind === 'color' ? '<i class="sw" style="--v:var(--ss-teal-text)"></i>' : ''}${d.vr.n}</div>` : d.lost ? `<div class="back lost"><span class="st" style="color:var(--ss-verm-text)">${d.lost.v}</span></div>` : '';
  return `<div class="r" data-prop="${d.p}"${sty(d)}>${nm(d)}<div class="deck ${lvl}">${fld(d)}${b1}</div></div>`;
};
export const V06 = story('Variation 06 · Cascade deck', 'The cascade is physical: a value sits on top of whatever it came from or beat (variable card behind, red card for the overridden one); an inherited value hangs from an up-tab. Replaces origin and overridden text.', V('v06', r06));

// 07 -------------------------------------------------------------------------------------------------------------------
const strip = (d) => {
  const lane = ['inh', 'rule', 'var', 'inline'];
  const win = d.vr ? 'var' : d.src.k === 'rule' ? 'rule' : d.src.k;
  const set = new Set([win, d.vr ? 'rule' : '', d.lost ? 'rule' : ''].filter(Boolean));
  const shape = (k, x, st) => {
    const c = st === 'win' ? 'var(--ss-cobalt-text)' : st === 'lost' ? 'var(--ss-verm-text)' : st === 'pass' ? 'var(--ss-muted)' : 'var(--ss-hair)';
    const f = st === 'win' || st === 'pass' ? c : 'none';
    const sh = { inh: `<path d="M4 0 8 4 4 8 0 4z"/>`, rule: `<rect width="8" height="8"/>`, var: `<circle cx="4" cy="4" r="4"/>`, inline: `<path d="M4 0 8 8H0z"/>` }[k];
    return `<g transform="translate(${x} 2)" fill="${f}" stroke="${c}" stroke-width="1.3" ${st === 'lost' ? 'stroke-dasharray="2 1.5"' : ''}>${sh}${st === 'lost' ? '<path d="M-1 9 9 -1" stroke-width="1.5"/>' : ''}</g>`;
  };
  return `<svg class="sd" viewBox="0 0 58 12" aria-hidden="true">${lane.map((k, i) => shape(k, i * 14, k === win ? 'win' : set.has(k) ? (d.lost && k === 'rule' ? 'lost' : 'pass') : 'off')).join('')}</svg>`;
};
const r07 = (d) => `<div class="r" data-prop="${d.p}" title="${e(tip(d))}"><div class="hd">${nm(d)}${strip(d)}</div>${fld(d)}</div>`;
export const V07 = story('Variation 07 · Provenance strip', 'Four cells in a row (inherited, rule, variable, inline) light up along the path the value took: blue = where it is set, grey = passed through, red cross = beaten. Replaces the origin lines with a pattern you learn once.', V('v07', r07));

// 08 -------------------------------------------------------------------------------------------------------------------
const cal = (d, n, i, cls = '') => `<div class="cal ${cls}" data-scrub data-max="${d.max}" data-i="${i}" tabindex="${cls ? -1 : 0}" role="slider" aria-label="${d.p}" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="${d.max}" style="--f:${n / d.max}"><i></i><output data-out="${i}">${n}px</output></div>`;
const r08 = (d) => {
  let body;
  if (d.kind === 'box') body = `<div>${cal(d, d.nums[0], 0)}${cal(d, d.nums[1], 1)}</div>`;
  else if (d.kind === 'len') body = `<div>${cal(d, d.n, 0)}${d.lost ? cal(d, d.lost.n, 0, 'lost').replace('data-scrub ', '') : ''}</div>`;
  else if (d.kind === 'color') body = `<div class="ring"><i class="sw disc" style="--v:var(--ss-teal-text)"></i><u></u><i class="sw sm" style="--v:var(--ss-teal-text)"></i></div>`;
  else body = `<div>${cal({ ...d, max: 4 }, d.w, 0)}</div>`;
  return `<div class="r" data-prop="${d.p}"${sty(d)} title="${e(tip(d))}">${nm(d)}${body}<span>${mark(d)}</span>${fld(d, d.kind === 'len' ? 'data-single' : '')}</div>`;
};
export const V08 = story('Variation 08 · Caliper', 'Every length is a measured gap between two jaws you drag; a colour is a disc tied by a line to a smaller disc where the variable is defined; beaten values are a red caliper. Replaces numbers as the primary read.', V('v08', r08));

// 09 -------------------------------------------------------------------------------------------------------------------
const lane = (d) => ({ inh: 0, rule: 1, inline: 3 }[d.src.k] + (d.vr ? 1 : 0));
const lanesHead = `<div class="lanes" role="img" aria-label="lanes: inherited, rule, variable, inline">${[G.inh(), G.rule(), G.var(), G.inline()].map((g, i) => `<span style="--l:${i}">${g}</span>`).join('')}</div>`;
const r09 = (d) => `<div class="r" style="--l:${lane(d)}">${d.lost ? `<div class="box lost" style="--l:1;margin-bottom:0"><input class="fld st" value="${d.lost.v}" aria-label="${d.p} (overridden)"></div><div class="hop"></div>` : ''}<div class="box win" data-s="${d.src.k}" title="${e(tip(d))}"><label class="nm">${d.p}</label>${fld(d)}</div></div>`;
export const V09 = story('Variation 09 · Cascade lanes', 'Position is origin: the field slides across four lanes (inherited, rule, variable, inline), so how deep in the cascade a value sits is how far it is shifted; a beaten value waits in its own lane with a red hop. Replaces the origin lines.', V('v09', r09, lanesHead));

// 10 -------------------------------------------------------------------------------------------------------------------
const r10 = (d) => {
  const fold = `<i class="fold ${d.vr ? 'var' : d.src.k === 'inline' ? 'inl' : d.src.k === 'inh' ? 'inh' : ''}"></i>`;
  const cut = d.lost ? `<span class="cut">${d.lost.v}</span>` : '';
  if (d.kind === 'color') return `<div class="r c" data-prop="${d.p}" style="--v:var(--ss-teal-text)" title="${e(tip(d))}">${nm(d)}${fld(d)}${fold}</div>`;
  if (d.kind === 'box') return `<div class="r pad" style="--x:${d.nums[1]};--y:${d.nums[0]}" title="${e(tip(d))}">${nm(d)}${fld(d)}${fold}</div>`;
  if (d.kind === 'line') return `<div class="r bd" style="--w:${d.w}" title="${e(tip(d))}">${nm(d)}${fld(d)}${fold}</div>`;
  return `<div class="r len ${d.lost ? 'has-cut' : ''}" data-scrub data-max="${d.max}" tabindex="0" role="slider" aria-label="${d.p}" aria-valuenow="${d.n}" aria-valuemin="0" aria-valuemax="${d.max}" style="--f:${d.n / d.max}" title="${e(tip(d))}">${nm(d)}<i class="fillb"></i><output data-out="0">${d.n}px</output>${fold}${cut}</div>`;
};
export const V10 = story('Variation 10 · Row is the value', 'The whole row becomes the value: colour floods the field, padding is a dashed inner box, border is the real line along the bottom, a length is a bar you drag; a corner fold shows the source and a red cut-off corner holds the value it beat. Replaces the resolved value and origin text.', V('v10', r10));
