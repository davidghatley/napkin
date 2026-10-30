// Screenshots of moments 2, 3, 4, 6, 8 and 9 on real components: node tools/smooth-shots.mjs <ss-ds folder> <out-dir> [--only m2,m3] [--sizes 1440x900,1280x720] [--schemes light,dark]
// The folder is copied first; nothing is written into it. Out: <moment>-<scheme>-<W>x<H>.png
import { writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { cli } from '../test/helpers/open.js';
import { launchChromium } from '../test/helpers/cdp.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { values: opt, positionals: [src, out] } = parseArgs({ allowPositionals: true, options: { only: { type: 'string', default: 'm2,m3,m4,m6,m8,m9' }, sizes: { type: 'string', default: '1440x900,1280x720' }, schemes: { type: 'string', default: 'light,dark' } } });
const only = opt.only.split(',');

async function session(W, H, scheme, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-shots-')), state = mkdtempSync(join(tmpdir(), 'napkin-shots-state-'));
  cpSync(src, dir, { recursive: true });
  const sh = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', ...a], { stdio: 'ignore' });
  sh('init', '-q'); sh('add', '.'); sh('commit', '-qm', 'first');
  const server = await cli(dir, [], { NAPKIN_STATE_DIR: state });
  const b = await launchChromium({ width: W, height: H });
  try {
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await b.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await b.goto(server.url);
    await b.waitFor('document.body.dataset.ready === "1"', 30000);
    await sleep(400);
    if (await b.eval(`!!document.querySelector('#ask-styles')`)) {
      await b.eval(`(() => { for (const i of document.querySelectorAll('#ask-styles input[type=checkbox]')) i.checked = /(^|\\/)(tokens|components)\\.css$/.test(i.value); document.querySelector('#ask-styles-apply').click(); })()`);
      await b.waitFor(`!document.querySelector('#ask-styles')`);
    }
    await b.waitFor(`document.querySelectorAll('.doc-frame').length >= 20`, 60000);
    await sleep(1500);
    const h = {
      b, dir, sleep,
      key: async (key, code, mods = 0, vk) => { const v = vk ?? key.toUpperCase().charCodeAt(0); await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers: mods, windowsVirtualKeyCode: v }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: mods, windowsVirtualKeyCode: v }); },
      async select(name, sel) { await b.eval(`(() => { const c = napkin.find(${JSON.stringify(name)}), f = napkin.stage.sections.get(c.component).docFrame, el = f.doc().querySelector(${JSON.stringify(sel)}); napkin.select({ component: c.component, node: f.nodeOf(el), variant: {} }); })()`); await sleep(500); },
      async type(selector, text) { await b.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, 8000); await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select(); })()`); await b.send('Input.insertText', { text }); },
      async centre(name, sel) { return JSON.parse(await b.eval(`(() => { const c = napkin.find(${JSON.stringify(name)}), f = napkin.stage.sections.get(c.component).docFrame, r = f.element(f.nodeOf(f.doc().querySelector(${JSON.stringify(sel)}))).getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`)); },
      async mouse(type, x, y, extra = {}) { await b.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra }); },
      async edit(name, edit) { return b.eval(`napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: napkin.find(${JSON.stringify(name)}).component, baseRevision: napkin.find(${JSON.stringify(name)}).revision, edits: [${JSON.stringify(edit)}] }) }).then((r) => r.text())`); },
      shot: async (name) => writeFileSync(join(out, `${name}-${scheme}-${W}x${H}.png`), await b.screenshot()),
    };
    await fn(h);
    const errs = b.consoleLines.filter((l) => /error|exception/i.test(l));
    if (errs.length) console.log(W, scheme, 'console:', errs.slice(0, 3).join(' | '));
  } finally { await b.close(); await server.stop(); rmSync(dir, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); }
}

const MOMENTS = {
  async m2(h) { // edit at scope: padding of a Note tag, class scope
    await h.select('Note', '.ss-note__tag');
    await h.b.eval(`napkin.view.fitSelection?.({ animate: false })`).catch(() => {});
    await h.sleep(500);
    await h.shot('m2-selected');
    await h.type('.vrow input[data-prop="padding"]', 'var(--space-1) var(--space-4)');
    await h.sleep(1600);
    await h.b.eval(`document.querySelector('#doc-staged [data-scope="class"]')?.click()`);
    await h.sleep(1400);
    await h.shot('m2');
  },
  async m3(h) { // one rule lights up, then the change
    await h.b.eval(`napkin.view.fitAll({ animate: false })`); await h.sleep(600);
    await h.select('Note', '.ss-note__tag');
    await h.b.eval(`napkin.stage.highlight({ selector: '.ss-label', file: 'components.css' })`);
    await h.sleep(1500);
    await h.shot('m3-lit');
    await h.edit('Plate', { op: 'rule', file: 'components.css', selector: '.ss-label', prop: 'letter-spacing', value: '.12em' });
    await h.sleep(2500);
    await h.shot('m3');
  },
  async m4(h) { // frame width, breakpoints
    await h.select('Plate', 'figure');
    await h.b.eval(`napkin.nav.focus(napkin.find('Plate').component, null, { animate: false })`); await h.sleep(800);
    await h.b.eval(`napkin.stage.sections.get(napkin.find('Plate').component).docFrame.setWidth(624, true)`); await h.sleep(900);
    await h.b.eval(`napkin.breakpoints.open()`); await h.sleep(2500);
    await h.shot('m4');
  },
  async m6(h) { // variables as instruments
    await h.select('Callout', '.ss-call, li, p, span');
    await h.b.eval(`document.querySelector('#doc-vars')?.scrollIntoView({ block: 'start' })`);
    await h.sleep(600);
    await h.shot('m6');
  },
  async m8(h) { // honest measurement: fit-all, then Alt-hover
    await h.b.eval(`napkin.view.fitAll({ animate: false })`); await h.sleep(800);
    await h.b.eval(`napkin.inspector?.toggle('contrast', true) ?? 0`).catch(() => {}); await h.sleep(800);
    await h.shot('m8-contrast-fit');
    await h.b.eval(`napkin.inspector?.toggle('contrast', false)`).catch(() => {});
    await h.select('Plate', 'figure');
    await h.b.eval(`napkin.nav.focus(napkin.find('Plate').component, null, { animate: false })`); await h.sleep(800);
    const c = await h.centre('Plate', 'header, figcaption');
    await h.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', modifiers: 1, windowsVirtualKeyCode: 18 });
    await h.mouse('mouseMoved', c.x, c.y, { modifiers: 1 }); await h.sleep(800);
    await h.shot('m8');
    await h.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 });
  },
  async m9(h) { // the film strip after a few edits
    await h.select('Note', '.ss-note__tag');
    for (const [prop, value] of [['letter-spacing', '.2em'], ['padding', '8px 24px'], ['font-size', '13px']]) { await h.edit('Note', { op: 'rule', file: 'components.css', selector: '.ss-note__tag', prop, value }); await h.sleep(1200); }
    await h.b.eval(`napkin.time.open?.() ?? napkin.time.toggle()`); await h.sleep(3000);
    await h.b.eval(`document.querySelector('#stage').focus()`);
    await h.shot('m9');
  },
};
for (const size of opt.sizes.split(',')) for (const scheme of opt.schemes.split(',')) {
  const [W, H] = size.split('x').map(Number);
  await session(W, H, scheme, async (h) => {
    for (const m of only) { const t = Date.now(); try { await MOMENTS[m](h); console.log(size, scheme, m, 'ok', Date.now() - t, 'ms'); } catch (e) { console.log(size, scheme, m, 'FAILED', e.message); } await h.b.goto(await h.b.eval('location.href')); await h.b.waitFor('document.body.dataset.ready === "1"', 30000); await h.b.waitFor(`document.querySelectorAll('.doc-frame').length >= 20`, 60000); await h.sleep(1200); }
  });
}
