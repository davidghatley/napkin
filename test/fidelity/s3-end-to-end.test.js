// SCN-3 end to end: draw a ProfileCard in napkin (Fixed width 280, padding 16, radius 12, fill, a title that is a setting, a Button
// instance), "Copy usage", render that line in a plain React app (esbuild, no CSS), and compare pixels with the canvas at 100%.
// EVIDENCE=1 writes docs/evidence/SCN-3.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tempRepo, startServer, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { session, http, evidence } from '../helpers/agents.js';
import { plainApp, boxOf, clip, placeAt100, pixelDiff, TOL } from './helpers.js';

test('SCN-3: a Card drawn in napkin, copied as usage into a plain React app, is pixel-identical', { timeout: 120000 }, async () => {
  const repo = tempRepo(['Button']);
  const server = await startServer(repo.compDir);
  const canvas = await launchChromium({ width: 1440, height: 900 });
  const app = await launchChromium({ width: 1600, height: 1200 });
  const log = [];
  try {
    const token = await session(server.url, 'david');
    const made = await http(server.url, '/api/components', { method: 'POST', token, body: { name: 'ProfileCard' } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    await canvas.goto(server.url); await canvas.waitFor('document.body.dataset.ready === "1"');
    await canvas.waitFor(`!!napkin.find('ProfileCard')`);
    const send = (edits) => canvas.eval(`napkin.sendEdits(napkin.find('ProfileCard').component, ${JSON.stringify(edits)}).then((r) => JSON.stringify(r))`);
    const rid = await canvas.eval(`napkin.find('ProfileCard').doc.root?.id ?? 'root'`);
    for (const edits of [
      [{ op: 'set', path: `${rid}.width`, value: '280px' }, { op: 'set', path: `${rid}.borderRadius`, value: '12px' }, { op: 'set', path: `${rid}.background`, value: '#d9d9d9' }],
      [{ op: 'insert', parent: rid, node: { id: 'text1', tag: 'span', text: 'Ada Lovelace' } }],
      [{ op: 'bindText', id: 'text1', prop: 'title' }],
      [{ op: 'insertInstance', parent: rid, id: 'button', component: 'Button' }],
    ]) { const r = JSON.parse(await send(edits)); assert.ok(r.ok !== false, JSON.stringify(r)); }
    await sleep(500);
    const src = readFileSync(repo.fileOf('ProfileCard'), 'utf8');
    assert.match(src, /boxSizing: 'border-box'/, 'a new component root is border-box');
    log.push(`ProfileCard.tsx written by napkin: ${src.split('\n').length} lines; width 280px: ${/280px/.test(src)}; setting title: ${/title\??: string/.test(src)}; Button instance: ${/<Button data-n="button"/.test(src)}`);
    // Inspect > Copy usage
    await canvas.eval(`napkin.select({ component: napkin.find('ProfileCard').component, node: '${rid}', variant: {} })`);
    await sleep(100);
    await canvas.eval(`document.querySelector('#open-inspect').click()`);
    await canvas.waitFor(`document.querySelector('#i-usage')?.textContent.includes('ProfileCard')`);
    await canvas.eval(`document.querySelector('#i-copy').click()`);
    await sleep(200);
    const copied = await canvas.eval(`napkin.copied`);
    const usage = copied.trim().split('\n').filter((l) => l.trim().startsWith('<')).join('\n'); // Copy usage may now carry its import line; the app below uses it
    const importLine = copied.split('\n').find((l) => l.startsWith('import ')) ?? `import { ProfileCard } from './ProfileCard';`;
    log.push(`Copy usage: ${JSON.stringify(copied)}`);
    assert.match(usage, /^<ProfileCard\b/);
    // canvas clip at 100%
    const sel = `section[data-name="ProfileCard"] .mount [data-n="${rid}"]`;
    await canvas.eval(`napkin.drawer?.close?.()`);
    await canvas.eval(`napkin.select(null)`); // the selection handles are editor chrome, drawn over the cell; take the picture without them
    await sleep(200);
    await canvas.waitFor(`!!document.querySelector(${JSON.stringify(sel)})`);
    await sleep(600);
    await placeAt100(canvas, sel);
    log.push(`root on the canvas at ${await canvas.eval(`JSON.stringify(Object.values(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().toJSON()).slice(0, 2))`)}`);
    const cb = await boxOf(canvas, sel);
    const pc = await clip(canvas, cb, false);
    // the plain app: the pasted line, nothing else
    await plainApp(app, repo.compDir, `import { createRoot } from 'react-dom/client';\nimport { flushSync } from 'react-dom';\n${importLine.replace(/from ['"]\.\/ProfileCard['"]/, "from '@components/ProfileCard'")}\nimport { Button } from '@components/Button';\nflushSync(() => createRoot(document.getElementById('m')!).render(${usage}));\n`);
    const ab = await boxOf(app, '#m [data-n=root], #m > *');
    const pa = await clip(app, ab, true);
    if (process.env.FIDELITY_OUT) { writeFileSync(`${process.env.FIDELITY_OUT}/s3-canvas.png`, pc); writeFileSync(`${process.env.FIDELITY_OUT}/s3-app.png`, pa); }
    log.push(`button rect canvas ${await canvas.eval(`JSON.stringify([...document.querySelector(${JSON.stringify(sel)} + ' button').getBoundingClientRect().toJSON ? Object.values(document.querySelector(${JSON.stringify(sel)} + ' button').getBoundingClientRect().toJSON()) : []])`)} app ${await app.eval(`JSON.stringify(Object.values(document.querySelector('#m button').getBoundingClientRect().toJSON()))`)}`);
    const d = await pixelDiff(app, pc, pa);
    log.push(`canvas clip ${cb.rw} x ${cb.rh} px; plain React app ${ab.rw} x ${ab.rh} px (W is the outer size: new elements are border-box)`);
    log.push(`pixels differing by more than ${TOL}/255: ${d.n} of ${d.total}; not bit-identical: ${d.exact} (antialiasing on rounded corners)`);
    log.push(`computed colour of the title in canvas: ${await canvas.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)} + ' [data-n=text1]')).color`)}; in the app: ${await app.eval(`getComputedStyle(document.querySelector('#m [data-n=text1]')).color`)}`);
    log.push(`box-sizing in canvas: ${await canvas.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).boxSizing`)}; in the app: ${await app.eval(`getComputedStyle(document.querySelector('#m > *')).boxSizing`)}`);
    evidence('SCN-3', `SCN-3 re-run after the cell-isolation fix (decision 0012). test/fidelity/s3-end-to-end.test.js\n${log.join('\n')}\nVERDICT: ${cb.rw === ab.rw && cb.rh === ab.rh && d.n === 0 ? 'pixel-identical at 100%' : 'NOT identical'}`);
    assert.equal(cb.rw, 280, 'Fixed width 280 is the outer size: 280 px on the canvas');
    assert.equal(ab.rw, 280, 'and 280 px in a plain app');
    assert.equal(cb.rw, ab.rw, 'same width');
    assert.equal(cb.rh, ab.rh, 'same height');
    assert.equal(d.n, 0, `0 px differ: ${JSON.stringify(d.ex)} ${log.join(' | ')}`);
  } finally { await canvas.close(); await app.close(); await server.stop(); }
});
