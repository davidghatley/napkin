// Basics: the selection chrome lint (docs/basics/standards.md section 10 rule 1 and amendment 5). The chrome that shows what is hovered and
// selected on the canvas (the outlines, the name and size tags, the marquee, the drawing outline and its size) is built from the --nk- tokens
// of public/canvas/canvas.css only: no raw colour, no raw px outside the scale, type from the type tokens, weights 400 and 600, no monospace.
// The accent colours it uses are each written once, with light-dark(), so a theme never needs a second copy. No browser: it reads the CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers/harness.js';

const DIR = join(ROOT, 'public', 'canvas');
const sheets = readdirSync(DIR).filter((f) => f.endsWith('.css')).map((f) => ({ file: f, css: readFileSync(join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
// innermost rules: { file, selector, decls: [[prop, value]] } (an @media block's own rules are found inside it)
const rules = sheets.flatMap(({ file, css }) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  file, selector: m[1].trim().replace(/\s+/g, ' '),
  decls: m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }),
})));

const SELECTION = /#overlay-select|#overlay-hover|\.overlay-extra|\.osize|#marquee|#draw-rect|#draw-size|\.m-(x|y|line|label|target)\b|\[data-item-id\]:focus-visible/; // (the distance marks and a focused card are chrome too)
const SCALE = new Set([0, 1, 2, 4, 8, 12, 16, 24, 32]); // 1 and 2: the hairline, the selection outline and the ring; then the 4 px space scale
const TYPE = new Set(['font', 'font-size', 'line-height', 'font-weight', 'font-family']);

test('chrome lint: the selection chrome uses only the --nk- tokens', () => {
  const sel = rules.filter((r) => SELECTION.test(r.selector));
  assert.ok(sel.length >= 6, `found the selection chrome rules (${sel.length})`);
  const bad = [];
  for (const r of sel) {
    for (const [p, v] of r.decls) {
      if (p.startsWith('--')) continue; // a custom property is the place a token is made, not used
      const at = `${r.file} ${r.selector} { ${p}: ${v} }`;
      if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|lab|lch)\(/i.test(v)) bad.push(`raw colour: ${at}`);
      for (const m of v.matchAll(/(-?[\d.]+)px/g)) if (!SCALE.has(Math.abs(Number(m[1])))) bad.push(`px off the scale (${m[0]}): ${at}`);
      if (TYPE.has(p) && /\d/.test(v.replace(/var\([^)]*\)/g, ''))) bad.push(`type not from the tokens: ${at}`);
      if (/\b500\b/.test(v) && TYPE.has(p)) bad.push(`weight 500: ${at}`);
      if (/--nk-mono|monospace/.test(v)) bad.push(`monospace: ${at}`);
      if (p === 'border-radius' && !/^(0|var\(--nk-radius(-pop)?\))$/.test(v)) bad.push(`radius not a token: ${at}`);
      if (/^(outline|border)(-top|-right|-bottom|-left)?$/.test(p) && /solid|dashed/.test(v) && !/var\(--nk-(accent|measure-mark)\)/.test(v)) bad.push(`selection edge not the accent or the measure mark: ${at}`);
    }
  }
  assert.deepEqual(bad, []);
  // the marquee and the drawing outline fill with 8% of the accent (standards 5.5)
  for (const id of ['#marquee', '#draw-rect']) {
    const fill = sel.find((r) => r.selector === id)?.decls.find(([p]) => p === 'background')?.[1];
    assert.equal(fill, 'color-mix(in srgb, var(--nk-accent) 8%, transparent)', `${id} fill`);
  }
});

test('chrome lint: each accent colour is written once, with light-dark()', () => {
  const ROLES = ['--nk-accent', '--nk-accent-text', '--nk-accent-soft', '--nk-on-accent', '--nk-select', '--nk-measure', '--nk-halo'];
  for (const role of ROLES) {
    const defs = rules.flatMap((r) => r.decls.filter(([p]) => p === role).map(([, v]) => `${r.file} ${r.selector}: ${v}`));
    assert.equal(defs.length, 1, `${role} is written once: ${defs.join(' | ')}`);
    assert.match(defs[0], /:root: (light-dark\(|var\(--nk-accent\)$|color-mix\(in srgb, var\(--nk-accent\))/, `${role}: one light-dark() value (${defs[0]})`);
  }
});

test('chrome lint: the distance label is the chrome label type and a focused card wears the shared ring', () => {
  const decl = (selector, prop) => rules.filter((r) => r.selector === selector).flatMap((r) => r.decls).find(([p]) => p === prop)?.[1];
  const label = decl('.m-label', 'font');
  assert.match(label ?? '', /var\(--nk-fs-label\)\/var\(--nk-lh-tight\) var\(--nk-sans\)/, `the distance label is 11 / 16 Inter from the tokens (${label})`);
  assert.equal(decl('.m-label', 'padding'), '0 var(--nk-s1)', 'the distance label has the chip padding');
  const ring = rules.find((r) => /\[data-item-id\]:focus-visible/.test(r.selector));
  assert.ok(ring, 'a focused card has a ring rule');
  const w = ring.decls.find(([p]) => p === 'outline')?.[1] ?? '', o = ring.decls.find(([p]) => p === 'outline-offset')?.[1] ?? '';
  assert.match(w, /var\(--nk-ring-width\)/, `the card ring is the shared width (${w})`);
  assert.match(o, /var\(--nk-ring-offset\)/, `the card ring is the shared offset (${o})`);
  // a hover fill is 8% of the ink in both themes (standards 1)
  assert.match(decl(':root', '--nk-hover') ?? '', /^light-dark\(rgb\(28 31 39 \/ \.08\), rgb\(232 234 240 \/ \.08\)\)$/, 'the hover fill is 8%');
});
