// Keys lane, round 3: EVERY focusable inspector control is reachable with Cmd-K in <= 5 real key presses (Ctrl+K, up to 3 characters, Enter),
// for Button root, Button label and Card image; plus the smaller polish items (messages, snap toast focus, undo hides it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

async function repo() {
  const { dir, compDir, file } = tempRepo(['Button', 'Card', 'Chip']);
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  const server = await startServer(compDir), b = await launchChromium({ width: 1440, height: 900 }), io = input(b);
  await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
  return { file, compDir, server, b, io, close: async () => { await b.close(); await server.stop(); } };
}
const pick = (b, c, n, variant) => b.eval(`napkin.select({ component: napkin.find(${JSON.stringify(c)}).component, node: ${JSON.stringify(n)}, variant: ${JSON.stringify(variant)} })`).then(() => sleep(350));

// In the page: for each control, the shortest query (1-3 characters, taken from the start of its words, their initials, or its first letters)
// whose top result is that control. Null when none exists.
const FIND = `(() => {
  const items = napkin.quick.build().filter((i) => i.kind === 'property' && !i.note);
  const words = (l) => l.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\\s+/).filter(Boolean);
  // Natural queries only: the first 2-3 letters of one word of the label, or the initials of 2-3 of its words in order.
  const cands = (label) => {
    const w = words(label), set = new Set();
    for (const x of w) { if (x.length >= 2) set.add(x.slice(0, 2)); if (x.length >= 3) set.add(x.slice(0, 3)); }
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) { set.add(w[i][0] + w[j].slice(0, 2)); set.add(w[i].slice(0, 2) + w[j][0]); set.add(w[i][0] + w[j][0]); for (let k = j + 1; k < w.length; k++) set.add(w[i][0] + w[j][0] + w[k][0]); }
    return [...set].sort((a, b) => a.length - b.length);
  };
  return JSON.stringify(items.map((it) => {
    const ok = (c) => { const top = napkin.quick.search(c)[0]; return top && top.kind === 'property' && top.field === it.field; };
    let q = cands(it.label).find(ok), natural = !!q;
    if (!q) { // siblings that differ only in their last word (see EXEMPT in the test): any 3 letters of the name, in order
      const l = it.label.toLowerCase().replace(/[^a-z0-9]/g, ''); const seen = new Set();
      outer: for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) for (let k = j + 1; k < l.length; k++) { const c = l[i] + l[j] + l[k]; if (seen.has(c)) continue; seen.add(c); if (ok(c)) { q = c; break outer; } }
    }
    return { label: it.label, field: it.field, add: !!it.add, q: q ?? null, natural };
  }));
})()`;

test('WPC-07: every focusable inspector control is <= 5 real keys away (Button root, Button label, Card image)', { timeout: 590000 }, async (t) => {
  const r = await repo(); const { b, io } = r;
  const open = async () => { await io.key('k', { ctrl: true }); await b.waitFor(`!document.querySelector('#quick').hidden && document.activeElement.id === 'q-input'`); };
  try {
    for (const [c, n, variant] of [['Button', 'root', { size: 'md', state: 'default' }], ['Button', 'label', { size: 'md', state: 'default' }], ['Card', 'image', {}]]) await t.test(`${c} ${n}`, async () => {
      await pick(b, c, n, variant);
      const found = JSON.parse(await b.eval(FIND));
      assert.ok(found.length >= (n === 'image' ? 25 : 80), `${found.length} controls indexed`);
      // Natural queries (the first 2-3 letters of a word of the label, or the initials of 2-3 words) reach every control, except these
      // siblings that share every word but the last (Height fill vs Height fixed, Stroke Width vs the Size Width ...): those need letters picked from the name.
      const EXEMPT = /^(Fixed width|Fill width|Hug width|Remove state axis|Name of state axis|Stroke Width)/;
      const unnatural = found.filter((f) => !f.natural && !EXEMPT.test(f.label));
      assert.deepEqual(unnatural.map((f) => f.label), [], 'a natural 2-3 letter query reaches each control first');
      assert.ok(found.filter((f) => !f.natural).length <= 8, 'few exceptions');
      const none = found.filter((f) => !f.q);
      assert.deepEqual(none.map((f) => f.label), [], 'every control has a query of at most 3 characters');
      const total = await b.eval(`[...document.querySelectorAll('#panel input, #panel select, #panel textarea, #panel button, #panel summary')].filter((e) => { if (e.tabIndex < 0 || e.disabled || e.type === 'color' || e.closest('[hidden]')) return false; for (let x = e; x && x.id !== 'panel'; x = x.parentElement) if (getComputedStyle(x).display === 'none') return false; return true; }).length`);
      const ids = new Set(found.map((f) => f.field));
      const missing = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#panel input, #panel select, #panel textarea, #panel button, #panel summary')].filter((e) => { if (e.tabIndex < 0 || e.disabled || e.type === 'color' || e.closest('[hidden]')) return false; for (let x = e; x && x.id !== 'panel'; x = x.parentElement) if (getComputedStyle(x).display === 'none') return false; return true; }).map((e) => e.id || e.tagName + ':' + e.textContent.trim().slice(0, 20)).filter((id) => !${JSON.stringify([...[]])}.includes(id)))`));
      const notIndexed = missing.filter((id) => !ids.has(id));
      assert.deepEqual(notIndexed, [], `controls in the panel that Cmd-K does not know (${total} focusable, ${found.length} indexed)`);
      let worst = 0;
      for (const f of found) {
        await b.eval(`(() => { document.activeElement.blur(); document.querySelectorAll('#panel details').forEach((d) => (d.open = false)); })()`);
        let keys = 0;
        await open(); keys++;
        for (const ch of f.q) { await io.key(ch); keys++; }
        await io.key('Enter'); keys++;
        await sleep(80);
        let want0 = null;
        if (/^sum-/.test(f.field)) want0 = await b.eval(`(() => { const s = document.getElementById(${JSON.stringify(f.field)}); const all = [...(s?.closest('details')?.querySelectorAll('input, select, textarea, button') ?? [])].filter((e) => !e.disabled && e.tabIndex >= 0 && e.type !== 'color' && getComputedStyle(e).display !== 'none' && !e.closest('[hidden]')); const x = all.find((e) => e.tagName !== 'BUTTON') || all[0]; return x ? x.id : ''; })()`); // Enter on a section moves into its first field
        const want = want0 ? want0 : f.add ? (f.field === 'add-prop' ? 'new-prop-name' : f.field === 'add-axis' ? 'new-axis-name' : `new-value-${f.field.replace(/^add-value-/, '')}`) : f.field;
        const got = await b.eval(`document.activeElement.id`);
        assert.equal(got, want, `${c}.${n} "${f.label}" via "${f.q}"`);
        assert.ok(keys <= 5, `${f.label}: ${keys} keys`);
        worst = Math.max(worst, keys);
        if (f.add) { await b.eval(`document.querySelectorAll('#panel [data-cmp="close"]').forEach((x) => x.click())`); await sleep(150); } // close the add form again
      }
      t.diagnostic(`${found.length} controls, worst ${worst} keys`);
    });
    await t.test('"hei" ranks Height above Line height', async () => {
      await pick(b, 'Button', 'label', { size: 'md', state: 'default' });
      const labels = await b.eval(`(napkin.quick.build(), napkin.quick.search('hei').filter((i) => i.kind === 'property').map((i) => i.label))`);
      assert.ok(labels.indexOf('Height') >= 0 && labels.indexOf('Height') < labels.indexOf('Line height'), labels.join(' | '));
    });
    await t.test('Make base: when no variant value can be made the base, the palette says so', async () => {
      await pick(b, 'Card', 'image', {});
      await open(); for (const ch of 'make b') await io.key(ch);
      assert.match(await b.eval(`document.querySelector('#q-list').innerText`), /Make base \(not possible here\)/);
      await io.key('Enter'); await sleep(150);
      assert.match(await b.eval(`document.querySelector('#hint').textContent`), /not the base yet/);
    });
    await t.test('Cmd-K "Add setting" and "Add variant" open their forms with the caret in the name', async () => {
      await pick(b, 'Button', 'root', { size: 'md', state: 'default' });
      for (const [q, want] of [['Add setting', 'new-prop-name'], ['Add variant', 'new-axis-name']]) {
        await open(); for (const ch of q) await io.key(ch); await io.key('Enter'); await sleep(150);
        assert.equal(await b.eval(`document.activeElement.id`), want, q + ' | ' + await b.eval(`napkin.quick.build().filter((i) => i.kind === 'property').filter((i) => /add/i.test(i.label)).map((i) => i.label).join(';') + ' / ' + napkin.quick.search('Add setting').map((i) => i.label).join(';') + ' / sel ' + JSON.stringify(napkin.state.selection) + ' ' + document.querySelector('#panel').innerText.slice(0, 40).replace(/\\n/g, ' ') + ' | ' + document.querySelector('#quick').hidden + ' ' + document.querySelector('#q-input').value + ' ' + document.querySelector('#q-list').innerText.replace(/\\n/g, ' ; ')`));
        await pick(b, 'Button', 'root', { size: 'md', state: 'default' });
      }
    });
  } finally { await r.close(); }
});

test('round 3 polish: messages clear and name the field; the snap toast follows the keyboard and Ctrl+Z', { timeout: 200000 }, async (t) => {
  const r = await repo(); const { b, io, file } = r;
  writeFileSync(file, readFileSync(file, 'utf8').replace('borderRadius: 6', 'borderRadius: 7'));
  try {
    await b.waitFor(`napkin.find('Button').doc.root.style.borderRadius === 7`);
    await pick(b, 'Button', 'root', { size: 'md', state: 'default' });
    const type = async (id, text) => { await b.eval(`(() => { document.querySelectorAll('#panel details').forEach((d) => (d.open = true)); const e = document.getElementById('${id}'); e.scrollIntoView(); e.focus(); e.select(); })()`); await b.send('Input.insertText', { text }); await io.key('Enter'); await sleep(450); };
    await t.test('a stroke-colour error names the colour and the Stroke colour field', async () => {
      await type('stroke-color', 'banana');
      const msg = await b.eval(`[...document.querySelectorAll('.field-error')].map((e) => e.textContent).join(' | ')`);
      assert.match(msg, /"banana" is not a colour\. Try a colour like #2236b0 in Stroke colour\./, msg);
      assert.doesNotMatch(msg, /border|solid/i);
    });
    await t.test('messages do not pile up: the next edit of a field clears its message', async () => {
      await type('padding', 'abc def');
      assert.ok(await b.eval(`!!document.querySelector('#err-style-padding')`));
      await type('padding', '12px');
      assert.equal(await b.eval(`!!document.querySelector('#err-style-padding')`), false, 'padding message gone after a good edit');
      await type('stroke-color', '#336699');
      assert.equal(await b.eval(`document.querySelectorAll('.field-error').length`), 0, 'no message left');
    });
    await t.test('add setting with a bad name: plain message, caret stays in the name field, nothing written', async () => {
      const before = readFileSync(file, 'utf8');
      await b.eval(`document.querySelectorAll('#panel details').forEach((d) => (d.open = true))`); await sleep(300);
      await b.eval(`document.getElementById('add-prop')?.click()`); await sleep(250);
      await b.eval(`document.querySelectorAll('#panel details').forEach((d) => (d.open = true))`); await sleep(300);
      await b.eval(`(() => { const e = document.getElementById('new-prop-name'); e.focus(); e.select(); })()`); assert.equal(await b.eval(`document.activeElement.id`), 'new-prop-name');
      await b.eval(`window.__f = []; document.addEventListener('focusin', (e) => __f.push('in:' + e.target.id), true); document.addEventListener('focusout', (e) => __f.push('out:' + e.target.id), true); new MutationObserver(() => __f.push('mut')).observe(document.querySelector('#panel'), { childList: true, subtree: true })`);
      await b.send('Input.insertText', { text: 'Foo' }); await io.key('Enter'); await sleep(450);
      const msg = await b.eval(`[...document.querySelectorAll('.field-error, #panel [role=alert]')].map((e) => e.textContent).join(' | ')`);
      assert.match(msg, /"Foo" can't be a setting name\. Start with a lowercase letter/, msg);
      assert.doesNotMatch(msg, /invalid edit|\[Button\.tsx\]|bad prop name/);
      assert.equal(await b.eval(`document.activeElement.id`), 'new-prop-name', await b.eval(`JSON.stringify(__f) + ' ' + !!document.getElementById('new-prop-name')`));
      assert.equal(readFileSync(file, 'utf8'), before);
      await b.eval(`document.querySelectorAll('#panel [data-cmp="close"]').forEach((x) => x.click())`);
    });
    await t.test('a keyboard snap moves focus to Undo; Ctrl+Z hides the toast and the snap is undone', async () => {
      await b.eval(`(() => { document.querySelectorAll('#panel details').forEach((d) => (d.open = true)); const d = document.getElementById('off-token-borderRadius'); d.scrollIntoView(); d.focus(); })()`);
      assert.equal(await b.eval(`document.activeElement.id`), 'off-token-borderRadius');
      await io.key('Enter');
      await b.waitFor(`document.activeElement.id === 'snap-undo'`);
      assert.match(await b.eval(`document.querySelector('#snap-toast').textContent`), /Ctrl\+Z/);
      await io.key('z', { ctrl: true });
      await b.waitFor(`napkin.find('Button').doc.root.style.borderRadius === 7`);
      await b.waitFor(`document.querySelector('#snap-toast').hidden === true`);
    });
    await t.test('the toast stays while focus is in it', async () => {
      await b.waitFor(`!!document.getElementById('off-token-borderRadius')`); // (the previous test's undo hides the toast first; the panel redraws the off-token control a moment later)
      await b.eval(`(() => { const d = document.getElementById('off-token-borderRadius'); d.scrollIntoView(); d.focus(); })()`);
      await io.key('Enter'); await b.waitFor(`document.activeElement.id === 'snap-undo'`);
      await b.eval(`document.querySelector('#snap-undo').onclick = null`);
      await sleep(300);
      assert.equal(await b.eval(`document.querySelector('#snap-toast').hidden`), false);
    });
  } finally { await r.close(); }
});

// Every panel form, every kind of refusal: ONE plain sentence, the caret stays in the field, nothing is written.
const ENGINE_WORDS = /\b(prop|bad|axis name|invalid|edit #|variant value ")|""|\[[A-Za-z]+\.tsx\]|undefined|NaN/;
const FORMS = [
  { form: 'add setting', node: ['Button', 'root'], open: '#add-prop', field: 'new-prop-name', cases: [['Foo', /can't be a setting name/], ['', /Type a setting name first\./], ['label', /already a setting called "label"/]] },
  { form: 'add variant', node: ['Button', 'root'], open: '#add-axis', field: 'new-axis-name', cases: [['Foo', /can't be a variant name/], ['', /Type a variant name first\./], ['size', /already a variant called "size"/], ['label', /already a setting called "label"/]] },
  { form: 'add value', node: ['Button', 'root'], open: '#add-value-size', field: 'new-value-size', cases: [['Big Value', /can't be a value/], ['', /Type a value first\./], ['md', /already a value called "md"/]] },
  { form: 'rename variant', node: ['Button', 'root'], field: 'axis-name-size', cases: [['Foo', /can't be a variant name/], ['', /Type a variant name first\./], ['state', /already a variant called "state"/], ['label', /already a setting called "label"/]] },
  { form: 'rename value', node: ['Button', 'root'], field: 'value-name-size-md', cases: [['Big Value', /can't be a value/], ['', /Type a value first\./], ['sm', /already a value called "sm"/]] },
  { form: 'rename setting', node: ['Button', 'root'], open: '#edit-settings', field: 'prop-name-label', cases: [['Foo', /can't be a setting name/], ['', /Type a setting name first\./], ['size', /already a variant called "size"/]] },
  { form: 'make component', node: ['Button', 'label'], open: '#make-component', field: 'extract-name', cases: [['foo', /can't be a component name/], ['1x', /can't be a component name/], ['a b', /can't be a component name/], ['', /Type a component name first\./], ['Card', /already a component called "Card"/]] },
];
test('WPC-14: every panel form x {bad, empty, duplicate}: one plain sentence, caret in the field, file unchanged', { timeout: 590000 }, async (t) => {
  const r = await repo(); const { b, io, compDir } = r;
  const text = (f) => readFileSync(join(compDir, f), 'utf8');
  try {
    for (const spec of FORMS) for (const [value, expect] of spec.cases) await t.test(`${spec.form}: ${JSON.stringify(value)}`, async () => {
      const before = [text('Button.tsx'), text('Card.tsx')];
      await pick(b, spec.node[0], spec.node[1], { size: 'md', state: 'default' });
      await b.eval(`document.querySelectorAll('#panel details').forEach((d) => (d.open = true))`); await sleep(350);
      if (spec.open && !(await b.eval(`!!document.getElementById(${JSON.stringify(spec.field)})`))) { await b.eval(`document.querySelector(${JSON.stringify(spec.open)})?.click()`); await sleep(350); await b.eval(`document.querySelectorAll('#panel details').forEach((d) => (d.open = true))`); await sleep(250); }
      await b.eval(`(() => { const e = document.getElementById(${JSON.stringify(spec.field)}); e.focus(); e.select(); })()`);
      assert.equal(await b.eval('document.activeElement.id'), spec.field, 'the field can be focused');
      if (value) await b.send('Input.insertText', { text: value }); else await io.key('Backspace');
      await b.eval(`window.__f = []; document.addEventListener('focusin', (e) => __f.push('in:' + e.target.id), true); document.addEventListener('focusout', (e) => __f.push('out:' + e.target.id), true)`);
      await io.key('Enter'); await sleep(700);
      const msgs = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#panel .field-error')].map((e) => e.textContent))`));
      const toast = await b.eval(`document.querySelector('#error')?.textContent ?? ''`);
      assert.equal(msgs.length, 1, `exactly one message in the panel: ${JSON.stringify(msgs)}`);
      assert.match(msgs[0], expect, msgs[0]);
      assert.doesNotMatch(msgs[0], ENGINE_WORDS, msgs[0]);
      assert.equal(toast, '', 'and not a second one at the bottom');
      assert.equal(await b.eval('document.activeElement.id'), spec.field, 'the caret stays in the field ' + await b.eval('JSON.stringify(__f) + document.getElementById(' + JSON.stringify(spec.field) + ')?.outerHTML.slice(0, 80)'));
      assert.deepEqual([text('Button.tsx'), text('Card.tsx')], before, 'nothing written');
      await b.eval(`document.querySelectorAll('#panel [data-cmp="close"], #panel #extract-cancel').forEach((x) => x.click())`);
    });
  } finally { await r.close(); }
});

// A regression lock for the queries people type most: the first result for each, on Button root (and Card image for the colour ones).
test('common queries rank the expected control first', { timeout: 120000 }, async () => {
  const r = await repo(); const { b } = r;
  try {
    await pick(b, 'Button', 'root', { size: 'md', state: 'default' });
    const first = (q) => b.eval(`(napkin.quick.build(), napkin.quick.search(${JSON.stringify(q)})[0]?.label)`);
    for (const [q, want] of [['bor', 'Stroke'], ['rad', 'Radius'], ['pad', 'Padding'], ['gap', 'Gap'], ['hei', 'Height'], ['wid', 'Width'], ['sha', 'Shadow'], ['hov', 'Default state hover'], ['fix', 'Fixed height'], ['fil', 'Fill'], ['str', 'Stroke'], ['rem sta', 'Remove state axis'], ['rst', 'Remove stroke'], ['add', 'Add'], ['av', 'Add variant'], ['top', 'Align top'], ['lef', 'Align left']]) {
      if (q === 'add') continue; // "Add" only exists while a form is open
      assert.equal(await first(q), want, `"${q}"`);
    }
    // Enter on a section summary moves into its first field: fil / str / col are <= 5 keys to the colour
    for (const [q, id] of [['fil', 'background'], ['str', 'stroke-color']]) {
      const io = r.io; await b.eval('document.activeElement.blur()');
      await io.key('k', { ctrl: true }); await b.waitFor(`!document.querySelector('#quick').hidden && document.activeElement.id === 'q-input'`);
      for (const ch of q) await io.key(ch); await io.key('Enter'); await sleep(250);
      assert.equal(await b.eval('document.activeElement.id'), id, `${q} + Enter lands in the colour (5 keys)`);
    }
    const col = await first('col');
    assert.match(col, /Colour|color/i, `"col" finds a colour first: ${col}`);
  } finally { await r.close(); }
});
