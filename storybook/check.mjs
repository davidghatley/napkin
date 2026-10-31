// Headless check of the running Storybook: opens every story in both themes, fails on console errors, page errors or
// failed requests, and (with --feedback) proves the Feedback panel saves a note and shows it again after a reload.
//   node storybook/check.mjs [--base http://127.0.0.1:6006] [--shots id,id --out DIR] [--feedback] [--only substring]
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchChromium } from '../test/helpers/cdp.js';

const { values: a } = parseArgs({ options: { base: { type: 'string', default: 'http://127.0.0.1:6006' }, shots: { type: 'string' }, out: { type: 'string', default: '.' }, feedback: { type: 'boolean' }, only: { type: 'string' }, themes: { type: 'string', default: 'light,dark' } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const index = await (await fetch(`${a.base}/index.json`)).json();
let stories = Object.values(index.entries).filter((e) => e.type === 'story');
if (a.only) stories = stories.filter((s) => s.id.includes(a.only));
const b = await launchChromium({ width: 1500, height: 1000 });
await b.send('Log.enable'); await b.send('Network.enable');
let errs = [];
b.onEvent((m) => {
  if (m.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + m.params.args.map((x) => x.value ?? x.description).join(' ').slice(0, 200));
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('log: ' + m.params.entry.text.slice(0, 160) + ' ' + (m.params.entry.url || '').slice(0, 100));
  else if (m.method === 'Network.loadingFailed' && !m.params.canceled) errs.push('request failed: ' + m.params.errorText);
});
const shots = new Set((a.shots || '').split(',').filter(Boolean));
if (shots.size) mkdirSync(a.out, { recursive: true });
let bad = 0, n = 0;
try {
  for (const theme of a.themes.split(',')) {
    for (const s of stories) {
      errs = [];
      await b.goto(`${a.base}/iframe.html?id=${s.id}&viewMode=story&globals=theme:${theme}`);
      try { await b.waitFor(`document.querySelector('.sb-fixture')?.dataset.ready==='1'`, 15000); } catch { errs.push('fixture never became ready'); }
      await sleep(250);
      const ok = await b.eval(`(()=>{const f=document.querySelector('.sb-fixture iframe'); if(!f) return 'no iframe'; const d=f.contentDocument; return d && d.body && d.body.children.length ? '' : 'empty fixture'})()`);
      if (ok) errs.push(ok);
      const styled = await b.eval(`(()=>{const d=document.querySelector('.sb-fixture iframe')?.contentDocument; return d? getComputedStyle(d.documentElement).getPropertyValue('--nk-chrome').trim() : ''})()`);
      if (!styled) errs.push('real stylesheet not applied (--nk-chrome unset)');
      const t = await b.eval(`document.querySelector('.sb-fixture iframe')?.contentDocument?.documentElement.dataset.theme`);
      if (t !== theme) errs.push(`theme is ${t}, wanted ${theme}`);
      n++;
      if (errs.length) { bad++; console.log(`FAIL ${s.id} [${theme}]\n   ` + [...new Set(errs)].join('\n   ')); }
      if (shots.has(s.id)) writeFileSync(join(a.out, `${s.id}.${theme}.png`), await b.screenshot());
    }
  }
  console.log(`${n} story views checked (${stories.length} stories x ${a.themes.split(',').length} themes), ${bad} with errors`);
  if (a.feedback) {
    const id = stories.find((s) => s.id.startsWith('2-panels-p01'))?.id || stories[0].id;
    const MARK = 'check-note-' + Date.now();
    await b.goto(`${a.base}/?path=/story/${id}&addonPanel=napkin/feedback/panel`);
    await b.waitFor(`!!document.querySelector('[data-testid="feedback-panel"]')`, 20000);
    await b.eval(`(()=>{const t=document.querySelector('[data-testid="feedback-panel"] textarea'); const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(t,${JSON.stringify(MARK)}); t.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-decision="change"]').click(); true})()`);
    await sleep(600);
    await b.eval(`document.querySelector('[data-save]').click()`); await sleep(800);
    const file = join(import.meta.dirname, 'feedback/feedback.json');
    const onDisk = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8'))[id] : null;
    console.log('feedback on disk:', onDisk && onDisk.note === MARK && onDisk.decision === 'change' && onDisk.at ? 'OK' : 'MISSING ' + JSON.stringify(onDisk));
    await b.goto(`${a.base}/?path=/story/${id}&addonPanel=napkin/feedback/panel`);
    await b.waitFor(`document.querySelector('[data-testid="feedback-panel"] textarea')?.value===${JSON.stringify(MARK)}`, 20000).then(() => console.log('feedback after reload: OK (note and decision shown again)'), () => console.log('feedback after reload: NOT SHOWN'));
    const pressed = await b.eval(`document.querySelector('[data-decision="change"]')?.getAttribute('aria-pressed')`);
    console.log('decision pressed after reload:', pressed);
    if (shots.size) writeFileSync(join(a.out, 'feedback-panel.png'), await b.screenshot());
    // remove the test note
    await b.eval(`document.querySelector('[data-remove]')?.click()`); await sleep(800);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    console.log('test note removed:', after[id] ? 'NO' : 'yes');
  }
} finally { await b.close(); }
process.exitCode = bad ? 1 : 0;
