// Screenshots of the stage moments (docs/stage/): node tools/stage-shots.mjs <folder> <out-dir> [1440x900]. The folder is a design-system folder such as the ss-ds corpus (bench/corpus.js).
import { writeFileSync } from 'node:fs';
import { cli } from '../test/helpers/open.js';
import { launchChromium } from '../test/helpers/cdp.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = process.argv[2], out = process.argv[3];
const server = await cli(dir);
const [W, H] = (process.argv[4] || '1440x900').split('x').map(Number), tag = W === 1440 ? '' : `-${W}x${H}`;
const b = await launchChromium({ width: W, height: H });
const shot = async (name) => writeFileSync(`${out}/${name}${tag}.png`, await b.screenshot());
const key = async (type, key, code, vk) => b.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk });
try {
  for (const scheme of ['light', 'dark']) {
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await b.goto(server.url);
    await b.waitFor('document.body.dataset.ready === "1"', 30000);
    await b.eval(`document.documentElement.dataset.theme = ${JSON.stringify(scheme)}`);
    if (await b.eval(`!!document.querySelector('#ask-styles')`)) await b.eval(`document.querySelector('#ask-styles-apply').click()`);
    await sleep(2500);
    await b.eval(`napkin.view.set({ x: 30, y: 70, z: 0.62 }, { animate: false })`); await sleep(1200);
    await shot(`overview-${scheme}`);
    // M3
    const r = await b.eval(`JSON.stringify(napkin.stage.highlight({ selector: '.ss-label', file: 'components.css' }))`);
    console.log(scheme, 'highlight .ss-label', r);
    await sleep(500); await shot(`m3-${scheme}`);
    // the change: edit the rule; "The change" shows the one-line diff with Keep and Revert (Revert is undo)
    const lab = await b.eval(`napkin.find('Plate').component`);
    await b.eval(`napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: ${JSON.stringify(lab)}, baseRevision: napkin.find('Plate').revision, edits: [{ op: 'rule', file: 'components.css', selector: '.ss-label', prop: 'letter-spacing', value: '.12em' }] }) }).then((r) => r.text())`);
    await b.waitFor(`!!document.querySelector('#hl-side .hl-change .add')`, 20000); await sleep(1200); await shot(`m3-change-${scheme}`);
    await b.eval(`document.querySelector('#hl-revert').click()`); await sleep(1500);
    await b.eval(`napkin.stage.clearHighlight()`);
    const v = await b.eval(`JSON.stringify(napkin.stage.highlight({ variable: '--ink-muted' }))`);
    console.log(scheme, 'highlight --ink-muted', v);
    await b.eval(`napkin.stage.clearHighlight()`);
    // M4
    const plate = await b.eval(`napkin.find('Plate').component`);
    await b.eval(`napkin.nav.focus(${JSON.stringify(plate)}, null, { animate: false })`); await sleep(800);
    await b.eval(`napkin.select({ component: ${JSON.stringify(plate)}, node: napkin.stage.sections.get(${JSON.stringify(plate)}).docFrame.tree().tree[0].children[0].children[0].node, variant: {} })`);
    console.log(scheme, 'Plate ticks', await b.eval(`JSON.stringify([...napkin.stage.sections.get(${JSON.stringify(plate)}).docFrame.cell.querySelectorAll('.rt')].map((x) => x.dataset.px))`));
    await b.eval(`napkin.stage.sections.get(${JSON.stringify(plate)}).docFrame.setWidth(480, true)`); await sleep(900);
    await b.eval(`napkin.breakpoints.open()`); await sleep(1800);
    await b.eval(`napkin.breakpoints.open()`); await sleep(1800);
    await shot(`m4-${scheme}`);
    await b.eval(`napkin.breakpoints.close()`);
    await b.eval(`napkin.breakpoints.close()`);
    await b.eval(`napkin.stage.sections.get(${JSON.stringify(plate)}).docFrame.setWidth(640)`);
    await b.eval(`napkin.nav.unfocus({ animate: false }); napkin.select(null); napkin.view.set({ x: 30, y: 70, z: 0.62 }, { animate: false })`); await sleep(800);
    // M5
    await b.eval(`napkin.theme.set({ left: 'light', right: 'dark', at: 50 }); napkin.theme.open()`);
    await b.waitFor(`napkin.theme.clones().size > 5`, 30000); await sleep(2500);
    await shot(`m5-${scheme}`);
    await b.eval(`napkin.theme.close()`); await sleep(2000);
    // M11
    await b.eval(`document.querySelector('#stage').focus()`);
    await key('keyDown', 'Tab', 'Tab', 9); await key('keyUp', 'Tab', 'Tab', 9); await sleep(900);
    await shot(`m11-${scheme}`);
    await key('keyDown', 'Tab', 'Tab', 9); await key('keyUp', 'Tab', 'Tab', 9); await sleep(500);
    // M1 play (hold)
    const motion = await b.eval(`napkin.find('Motion').component`);
    await b.eval(`napkin.select({ component: ${JSON.stringify(motion)}, node: napkin.stage.sections.get(${JSON.stringify(motion)}).docFrame.tree().tree[0].children[0].children[0].node, variant: {} })`);
    await key('keyDown', ' ', 'Space', 32); await key('keyDown', 'p', 'KeyP', 80); await sleep(700);
    await shot(`m1-${scheme}`);
    await key('keyUp', 'p', 'KeyP', 80); await key('keyUp', ' ', 'Space', 32); await sleep(300);
  }
} finally { await b.close(); await server.stop(); }
