// Drives the REAL napkin on a REAL folder (the ss-ds corpus folder) and saves the actual DOM of every inventory item in
// its key states as fixtures: storybook/fixtures/<item>--<n>.html (+ manifest.json). Then writes the stories and INVENTORY.md.
//   node storybook/capture.mjs [--only I01,P03] [--port 4872]
// Needs: chromium (see src/chromium.js), the napkin repo. Starts and stops its own server and browser.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchChromium } from '../test/helpers/cdp.js';
import { grab } from './lib/grab.js';
import { ITEMS } from './inventory.mjs';
import { generate } from './generate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const { values } = parseArgs({ options: { only: { type: 'string' }, port: { type: 'string', default: '4872' } } });
const only = values.only ? new Set(values.only.split(',')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIX = join(HERE, 'fixtures');

const corpusOut = execFileSync(process.execPath, [join(ROOT, 'bench/corpus.js')], { encoding: 'utf8' });
const corpus = corpusOut.match(/P0 corpus: (\S+)/)[1];
const scratch = mkdtempSync(join(tmpdir(), 'napkin-sb-'));
const work = join(scratch, 'ss-ds');
cpSync(join(corpus, 'ss-ds'), work, { recursive: true });
rmSync(corpus, { recursive: true, force: true });

const port = values.port, url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [join(ROOT, 'src/cli.js'), 'open', work, '--port', port], { env: { ...process.env, BROWSER: 'true', NAPKIN_STATE_DIR: join(scratch, 'state') }, stdio: 'ignore' });
let b;
const cleanup = async () => { try { await b?.close(); } catch {} server.kill('SIGTERM'); await sleep(300); rmSync(scratch, { recursive: true, force: true }); };
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

const p = {
  get b() { return b; },
  ev: (e) => b.eval(e),
  wait: sleep,
  until: (e, t = 6000) => b.waitFor(e, t),
  click: (sel) => b.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('no '+${JSON.stringify(sel)}); e.click(); return true})()`),
  // a real pointer click at the element's centre (for code that listens to pointerdown, not click)
  async pointer(sel, { dx = 0, dy = 0, button = 'left', hover = false } = {}) {
    const r = await b.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('no '+${JSON.stringify(sel)}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const x = r.x + dx, y = r.y + dy;
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    if (!hover) { await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 }); await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 }); }
  },
  async key(key, { mod = 0, code } = {}) { const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 })[key] || 0; for (const t of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type: t, key, code: code || (key.length === 1 ? 'Key' + key.toUpperCase() : key), windowsVirtualKeyCode: vk, modifiers: mod, text: t === 'keyDown' && key.length === 1 && !mod ? key : undefined }); await sleep(250); },
  async type(text) { await b.send('Input.insertText', { text }); await sleep(200); },
  async reset() {
    await b.goto(url); await b.waitFor('document.body.dataset.ready==="1"', 40000).catch(() => {}); await sleep(1800);
    if (await b.eval(`!!document.querySelector('#ask-styles-apply')`)) { await b.eval(`document.querySelector('#ask-styles-apply').click()`); await sleep(2500); }
  },
  // expand a component in Layers and select the n-th descendant node row (0 = first child); returns its text
  async selectNode(comp, n = 0, { expand = [] } = {}) {
    await b.eval(`(()=>{const r=[...document.querySelectorAll('#layers .lrow.lcomp')].find(e=>e.querySelector('.lname')?.textContent.trim()===${JSON.stringify(comp)}); if(!r.nextElementSibling?.classList.contains('lnode')) r.querySelector('.twirl').click()})()`); await sleep(500);
    for (const k of expand) { await b.eval(`[...document.querySelectorAll('#layers .lrow.lnode .twirl')][${k}].click()`); await sleep(400); }
    const t = await b.eval(`(()=>{const rows=[...document.querySelectorAll('#layers .lrow.lnode')]; const r=rows[${n}]; r.click(); return r.textContent.trim()})()`); await sleep(1200); return t;
  },
  async drawer(name) { await p.click(`#open-${name}`); await sleep(900); },
};

const manifest = { items: {}, skipped: [] };
const save = (item, idx, state, g) => {
  const key = `${item.id}--${String(idx + 1).padStart(2, '0')}`;
  const bad = /\/home\/|\/tmp\/|davidhatley|napkin-sb-/.exec(g.html + JSON.stringify(g.chain || []) + JSON.stringify(g.body));
  if (bad) throw new Error(`${key}: fixture contains a local path (${bad[0]})`);
  writeFileSync(join(FIX, key + '.html'), g.html);
  const { html, ...meta } = g;
  manifest.items[item.id] ??= { states: [] };
  manifest.items[item.id].states.push({ key, name: state.name, ...meta });
};

try {
  for (let i = 0; i < 80 && !(await fetch(url).then((r) => r.ok).catch(() => false)); i++) await sleep(250);
  b = await launchChromium({ width: 1440, height: 900 });
  mkdirSync(FIX, { recursive: true });
  // the ask comes first: it is only asked once per folder
  await b.goto(url); await b.waitFor('document.body.dataset.ready==="1"', 40000).catch(() => {}); await sleep(1800);
  const grabState = async (item, s) => {
    const st = item.states[s];
    try {
      await st.prep?.(p);
      const g = await b.eval(`(${grab})(${JSON.stringify({ sel: st.sel || item.sel, whole: item.level === 1 })})`);
      if (g.missing) throw new Error(`selector not found: ${st.sel || item.sel}`);
      save(item, s, st, g); process.stdout.write('.');
    } catch (e) { manifest.skipped.push({ id: item.id, state: st.name, why: e.message.split('\n')[0] }); process.stdout.write('x'); }
  };
  // phase 1: states of the very first open (the stylesheet question is only asked once per folder)
  for (const item of ITEMS) {
    if (only && !only.has(item.id)) continue;
    for (let s = 0; s < item.states.length; s++) if (item.states[s].first) { process.stdout.write(`${item.id} ${item.name} [first open]: `); await grabState(item, s); console.log(); }
  }
  for (const item of ITEMS) {
    if (only && !only.has(item.id)) continue;
    process.stdout.write(`${item.id} ${item.name}: `);
    await p.reset();
    if (item.pre) await item.pre(p);
    for (let s = 0; s < item.states.length; s++) {
      if (item.states[s].first) continue;
      if (s > 0 && item.states[s].fresh) { await p.reset(); if (item.pre) await item.pre(p); }
      await grabState(item, s);
    }
    await st_cleanup(); console.log();
  }
  // the shared stylesheets the frames use (the folder's own tokens.css and components.css, with its fonts)
  const fr = join(FIX, 'frame'); mkdirSync(join(fr, 'fonts'), { recursive: true });
  for (const f of ['tokens.css', 'components.css']) cpSync(join(work, f), join(fr, f));
  for (const f of readdirSync(join(work, 'fonts'))) cpSync(join(work, 'fonts', f), join(fr, 'fonts', f));
  if (only && existsSync(join(FIX, 'manifest.json'))) { const old = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8')); for (const [k, v] of Object.entries(old.items)) if (!only.has(k)) manifest.items[k] = v; manifest.skipped = [...old.skipped.filter((x) => !only.has(x.id)), ...manifest.skipped]; }
  for (const v of Object.values(manifest.items)) v.states.sort((x, y) => x.key.localeCompare(y.key));
  writeFileSync(join(FIX, 'manifest.json'), JSON.stringify(manifest, null, 1));
  generate();
  console.log(`captured ${Object.values(manifest.items).reduce((n, i) => n + i.states.length, 0)} fixtures; skipped ${manifest.skipped.length}`);
  for (const s of manifest.skipped) console.log('  skipped', s.id, s.state, '-', s.why);
} finally { await cleanup(); }

async function st_cleanup() { try { for (let i = 0; i < 2; i++) await p.key('Escape'); } catch {} }
