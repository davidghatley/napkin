// Build-first #5 (F04 + F05), on TSX: the proving demo as one end-to-end test.
// Headless Chromium (CPU) selects the Card, changes Padding in the panel while a scripted MCP agent sets the
// title weight to 600, both from the same revision. Both must show on the canvas and be in the file.
// Set DEMO_OUT=docs/demo to save screenshots and the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readComponent } from '../src/tsx/read.js';
import { getValue } from '../src/model.js';
import { tempRepo, startServer, startMcp, ROOT } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';

test('person on the canvas and agent over MCP edit the Card together', { timeout: 30000 }, async () => {
  const out = process.env.DEMO_OUT ? join(ROOT, process.env.DEMO_OUT) : null;
  if (out) mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  const lines = [];
  const log = (who, msg) => { const l = `[${(performance.now() - t0).toFixed(0).padStart(5)} ms] ${who.padEnd(7)} ${msg}`; lines.push(l); console.log(l); };

  const { compDir, file, git } = tempRepo();
  const server = await startServer(compDir);
  log('napkin', `server up at ${server.url} watching components/*.tsx`);
  const agent = await startMcp(server.url);
  log('agent', `MCP connected: ${agent.init.result.serverInfo?.name}`);
  const browser = await launchChromium();
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    const rev0 = await browser.eval('document.querySelector("#revision").textContent');
    const cells = await browser.eval('document.querySelectorAll(\'section[data-name="Button"] .cell\').length');
    log('canvas', `headless Chromium opened the canvas, last drawn revision ${rev0}, Button grid shows ${cells} variants`);
    // The person clicks the Card in its grid cell to select it.
    await browser.eval('document.querySelector(\'section[data-name="Card"] [data-n="card"]\').click()');
    await browser.waitFor('document.querySelector("#sel-node")?.textContent.startsWith("card")');
    log('person', 'clicked the Card: panel shows ' + await browser.eval('document.querySelector("#panel").innerText.split("\\n").slice(0, 6).join(" | ")'));
    if (out) writeFileSync(join(out, '1-before.png'), await browser.screenshot());

    const read = await agent.call('read_component', { component: 'Card' });
    log('agent', `read_component Card -> revision ${read.data.revision}, title.fontWeight ${getValue(read.data.doc, 'title.fontWeight')}`);

    // Both start from the same revision, at the same moment.
    log('person', 'types 28px into Padding');
    log('agent', `apply_edits title.fontWeight = 600 at base revision ${read.data.revision}`);
    const [, applied] = await Promise.all([
      browser.type('#padding', '28px'),
      agent.call('apply_edits', { component: 'Card', baseRevision: read.data.revision, edits: [{ op: 'set', path: 'title.fontWeight', value: 600 }] }),
    ]);
    assert.equal(applied.isError, false, applied.text);
    log('agent', `apply_edits ok -> revision ${applied.data.revision}`);

    const ms = await browser.waitFor(`(() => {
      const sec = document.querySelector('section[data-name="Card"]');
      const card = sec.querySelector('[data-n="card"]'), title = sec.querySelector('[data-n="title"]');
      return card && title && getComputedStyle(card).paddingTop === '28px' && getComputedStyle(title).fontWeight === '600';
    })()`, 3000);
    await browser.waitFor(`document.querySelector("#padding").value === "28px"`, 2000);
    const rev = await browser.eval('document.querySelector(\'section[data-name="Card"]\').dataset.revision');
    assert.equal(await browser.eval('document.querySelector("#overlay-select").style.display'), 'block', 'selection outline survives the re-render');
    log('canvas', `shows padding 28px and title weight 600 (revision ${rev}, settled ${ms} ms after both edits)`);
    const notices = agent.notifications.filter((n) => n.method === 'notifications/napkin/change');
    for (const n of notices) log('agent', `change notice: revision ${n.params.revision} by ${n.params.by}${n.params.edits ? ' ' + JSON.stringify(n.params.edits) : ''}`);
    assert.ok(notices.some((n) => n.params.by === 'canvas'), 'agent heard about the person\'s edit');

    const onDisk = readComponent(readFileSync(file, 'utf8')).doc;
    assert.equal(getValue(onDisk, 'card.padding'), '28px');
    assert.equal(getValue(onDisk, 'title.fontWeight'), 600);
    const diff = git('diff', '--', 'components/Card.tsx');
    log('file', 'git diff components/Card.tsx:\n' + diff.trimEnd().split('\n').map((l) => '            ' + l).join('\n'));
    assert.equal(git('diff', '--numstat').trim(), '2\t2\tcomponents/Card.tsx');
    if (out) {
      writeFileSync(join(out, '2-after.png'), await browser.screenshot());
      writeFileSync(join(out, 'Card.after.tsx'), readFileSync(file));
    }
    log('result', 'PASS: both edits are on the canvas and in the file');
  } finally {
    if (browser.consoleLines.length) lines.push('', 'browser console:', ...browser.consoleLines.map((l) => '  ' + l));
    if (out) writeFileSync(join(out, 'e2e-log.txt'), lines.join('\n') + '\n');
    await browser.close(); agent.stop(); await server.stop();
  }
});
