// The ten scripted tasks for the napkin agent eval (AGT-07). Each has a prompt a person might type and a
// checker that reads the component files left in the temp folder. Plain data: importing this runs nothing.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readComponent } from '../../src/tsx/read.js';

const doc = (dir, name) => readComponent(readFileSync(join(dir, `${name}.tsx`), 'utf8')).doc;
const node = (d, id) => (function f(n) { if (n.id === id) return n; for (const c of n.children || []) { const x = f(c); if (x) return x; } })(d.root);
const check = (cond, why) => (cond ? { pass: true } : { pass: false, why });
const last = (a) => a[a.length - 1];

export const TASKS = [
  { id: 'set-style', prompt: 'In the Card component, make the title bolder: set its fontWeight to 700.',
    check: (dir) => check(node(doc(dir, 'Card'), 'title')?.style.fontWeight === 700, 'title.fontWeight is not 700') },
  { id: 'base-color', prompt: 'Change the Button component\'s main background colour to #c8553d (the root node).',
    check: (dir) => check(String(node(doc(dir, 'Button'), 'root')?.style.background).toLowerCase() === '#c8553d', 'root background is not #c8553d') },
  { id: 'add-variant', prompt: 'Add an "xl" size to the Button: padding "14px 28px" and fontSize 22 on its root.',
    check: (dir) => { const d = doc(dir, 'Button'); const o = d.variants.size?.xl?.root; const a = d.props.find((p) => p.name === 'size'); return check(a?.options.includes('xl') && o?.padding === '14px 28px' && o?.fontSize === 22, `size.xl override is ${JSON.stringify(o)}`); } },
  { id: 'create', prompt: 'Create a new component called Badge, and give its root node a background of #ffeeaa.',
    check: (dir) => existsSync(join(dir, 'Badge.tsx')) ? check(doc(dir, 'Badge').root.style.background?.toLowerCase() === '#ffeeaa', 'Badge root background is not #ffeeaa') : { pass: false, why: 'no Badge.tsx' } },
  { id: 'rename', prompt: 'Rename the Card component to Panel.',
    check: (dir) => check(existsSync(join(dir, 'Panel.tsx')) && !existsSync(join(dir, 'Card.tsx')) && doc(dir, 'Panel').name === 'Panel', 'Panel.tsx missing, or Card.tsx still there') },
  { id: 'insert', prompt: 'Add a small text label (a span) containing the text "New" as the last child of the Card\'s root node.',
    check: (dir) => { const d = doc(dir, 'Card'); const kids = d.root.children; const last = kids[kids.length - 1]; return check(last?.tag === 'span' && last.text === 'New', `last child is ${JSON.stringify(last && { tag: last.tag, text: last.text })}`); } },
  { id: 'delete-node', prompt: 'Remove the image node from the Card.',
    check: (dir) => check(!node(doc(dir, 'Card'), 'image'), 'the image node is still there') },
  { id: 'add-prop', prompt: 'Give the Button a new text setting (string prop) named "hint" with the default value "More".',
    check: (dir) => { const p = doc(dir, 'Button').props.find((x) => x.name === 'hint'); return check(p?.type === 'string' && p.default === 'More', `hint prop is ${JSON.stringify(p)}`); } },
  { id: 'variant-override', prompt: 'On the Button, for the sm size only, make the label node fontWeight 400.',
    check: (dir) => check(doc(dir, 'Button').variants.size?.sm?.label?.fontWeight === 400, 'size.sm label.fontWeight is not 400') },
  { id: 'change-override', prompt: 'The Button\'s lg size currently has root padding "12px 24px". Change it to "16px 32px". Do not change the base padding.',
    check: (dir) => { const d = doc(dir, 'Button'); return check(d.variants.size?.lg?.root?.padding === '16px 32px' && node(d, 'root').style.padding === '8px 16px', `lg padding ${d.variants.size?.lg?.root?.padding}, base ${node(d, 'root').style.padding}`); } },
];
// Harder tasks. Options: race { file, from, to } makes a hand edit after the agent's first read (so its first apply is stale);
// propose: true runs against a canvas server where this agent is configured "propose" in napkin.json.
TASKS.push(
  { id: 'multi-step', prompt: 'On the Card: add a span with the text "Sale" as the first child of the root, colour it #c8553d, change the card\'s padding to 24px, and remove the body node. Do all of it.',
    check: (dir) => { const d = doc(dir, 'Card'); const f = d.root.children[0]; return check(f?.tag === 'span' && f.text === 'Sale' && String(f.style.color).toLowerCase() === '#c8553d' && d.root.style.padding === '24px' && !node(d, 'body'), `first child ${JSON.stringify(f && { tag: f.tag, text: f.text, color: f.style.color })}, padding ${d.root.style.padding}, body ${!!node(d, 'body')}`); } },
  { id: 'stale-retry', prompt: 'Set the Card title\'s fontWeight to 700. (Someone else may be editing the same file at the same time; make sure your change ends up in the file.)',
    race: { file: 'Card.tsx', from: 'fontWeight: 400', to: 'fontWeight: 300' },
    check: (dir) => check(existsSync(join(dir, '..', 'raced')) && node(doc(dir, 'Card'), 'title')?.style.fontWeight === 700, existsSync(join(dir, '..', 'raced')) ? `final fontWeight ${node(doc(dir, 'Card'), 'title')?.style.fontWeight}` : 'the race never fired') },
  { id: 'propose', prompt: 'Set the Card title colour to #c8553d.', propose: true,
    check: async (dir, ctx) => { const unchanged = readFileSync(join(dir, 'Card.tsx'), 'utf8') === ctx.originalCard; const list = await (await fetch(new URL('api/proposals', ctx.url))).json(); const p = list.find((x) => x.edits.some((e) => e.path === 'title.color' && String(e.value).toLowerCase() === '#c8553d')); return check(unchanged && p, `file unchanged: ${unchanged}; proposals: ${JSON.stringify(list.map((x) => x.summary))}`); } },
  { id: 'move', prompt: 'In the Card, move the body node so it comes before the image (keep both inside the root).',
    check: (dir) => { const ids = doc(dir, 'Card').root.children.map((c) => c.id); return check(ids.includes('body') && ids.includes('image') && ids.indexOf('body') < ids.indexOf('image'), `order: ${ids}`); } },
  { id: 'bind-text', prompt: 'Make the Card body\'s text editable as a setting: add a string prop called "body" whose default is the text the body has now, and bind the body node\'s text to it.',
    check: (dir) => { const d = doc(dir, 'Card'); const p = d.props.find((x) => x.name === 'body'); return check(p?.type === 'string' && /person and an agent/.test(p.default) && node(d, 'body')?.textProp === 'body', `prop ${JSON.stringify(p)}, textProp ${node(d, 'body')?.textProp}`); } },
  { id: 'remove-variant', prompt: 'Remove the "lg" size from the Button, including its overrides.',
    check: (dir) => { const d = doc(dir, 'Button'); const a = d.props.find((x) => x.name === 'size'); return check(!a.options.includes('lg') && !d.variants.size?.lg, `options ${a.options}, overrides ${JSON.stringify(d.variants.size?.lg)}`); } },
);
export const listTsx = (dir) => readdirSync(dir).filter((f) => f.endsWith('.tsx'));
