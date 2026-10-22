// REL-03: after a server restart the page reconnects (<= 2 s). An edit that was in flight when the connection broke
// is reported stale, never silently lost. Writes are never replayed by the client.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { gateway } from '../helpers/gateway.js';
import { launchChromium } from '../helpers/cdp.js';
import { evidence } from '../helpers/agents.js';
import { connectCanvas } from '../../src/canvas-client.js';

const lines = [];
after(() => evidence('REL-03', `REL-03: ${lines.join('\n')}\n\nRe-run: EVIDENCE=1 node --test test/engine/reconnect.test.js\nMeasured: ${new Date().toISOString()}; ${process.version}; Chromium page and Node client against a real server restarted on its own port.`));
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const setLabel = (file, text) => writeFileSync(file, readFileSync(file, 'utf8').replace(/title = '[^']*'/, `title = '${text}'`));
const defaultOf = (doc, name) => doc.props.find((p) => p.name === name)?.default;

test('the client reconnects within 2 s of a restart, tells what changed meanwhile, and refuses writes while down', async (t) => {
  const { compDir, fileOf } = tempRepo(['Card']);
  const port = await freePort();
  let server = await startServer(compDir, { port });
  const client = await connectCanvas(server.url, { by: 'tester' });
  t.after(async () => { client.close(); await server.stop(); });
  const frames = []; client.onChange((f) => frames.push(f));
  const comp = client.components()[0].component, before = client.state(comp);

  await server.stop();
  await waitFor(() => !client.connected(), 3000);
  assert.ok(frames.some((f) => f.type === 'connection' && f.connected === false), 'a connection-lost frame');

  const bytes = readFileSync(fileOf('Card'), 'utf8');
  const refused = await client.sendEdits(comp, before.revision, [{ op: 'setDefault', name: 'title', value: 'While down' }]);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /^stale revision/);
  assert.equal(readFileSync(fileOf('Card'), 'utf8'), bytes, 'nothing was written while down');

  setLabel(fileOf('Card'), 'Hand edit while down');
  server = await startServer(compDir, { port });
  const t0 = performance.now();
  await waitFor(() => client.connected(), 2000, 5);
  const ms = performance.now() - t0;
  assert.ok(ms <= 2000, `reconnected in ${ms.toFixed(0)} ms`);
  assert.ok(frames.some((f) => f.type === 'connection' && f.connected === true));
  const change = frames.find((f) => f.type === 'change' && f.component === comp);
  assert.ok(change, 'the page is told the component changed while it was away');
  assert.equal(defaultOf(client.state(comp).doc, 'title'), 'Hand edit while down');
  assert.notEqual(client.state(comp).revision, before.revision);
  assert.equal(frames.filter((f) => f.type === 'change').length, 1, 'only what differs is announced');

  // The client took a fresh session with the new server: its writes are accepted and attributed to it.
  const ok = await client.sendEdits(comp, client.state(comp).revision, [{ op: 'setDefault', name: 'title', value: 'Back again' }]);
  assert.equal(ok.ok, true, ok.error);
  assert.match(readFileSync(fileOf('Card'), 'utf8'), /title = 'Back again'/);
  // five more restarts for a distribution
  const times = [ms];
  for (let i = 0; i < 5; i++) {
    await server.stop();
    await waitFor(() => !client.connected(), 3000);
    server = await startServer(compDir, { port });
    const s0 = performance.now();
    await waitFor(() => client.connected(), 2000, 5);
    times.push(performance.now() - s0);
  }
  const worst = Math.max(...times);
  assert.ok(worst <= 2000, `slowest of ${times.length} reconnects: ${worst.toFixed(0)} ms`);
  lines.push(`Node client: ${times.length} server restarts on the same port, reconnected ${times.map((x) => x.toFixed(0)).join(', ')} ms after the new server printed its address (bar <= 2000 ms; worst ${worst.toFixed(0)} ms). A write while the server was down answered "${refused.error.slice(0, 40)}..." and left the file untouched; a hand edit made during the outage arrived as exactly one change frame; the first write after reconnecting (new session token) was accepted.`);
});

test('an edit that landed but whose reply was lost is reported stale, never lost or applied twice', async (t) => {
  const { compDir, fileOf } = tempRepo(['Card']);
  const server = await startServer(compDir);
  const gw = await gateway(server.url);
  const client = await connectCanvas(gw.url, { by: 'tester' });
  t.after(async () => { client.close(); await gw.close(); await server.stop(); });
  const comp = client.components()[0].component, base = client.state(comp).revision;
  gw.dropReplies((req) => req.method === 'POST' && /\/edits$/.test(req.url));
  const r = await client.sendEdits(comp, base, [{ op: 'setDefault', name: 'title', value: 'Landed' }]);
  gw.dropReplies(null);
  assert.equal(r.ok, false);
  assert.match(r.error, /^stale revision/);
  assert.match(r.error, /may have landed/);
  assert.match(readFileSync(fileOf('Card'), 'utf8'), /title = 'Landed'/, 'the edit really landed');
  await waitFor(() => defaultOf(client.state(comp).doc, 'title') === 'Landed', 3000);
  // The caller reads, sees its edit, and does not send it again: a second send on the old base is stale too.
  const again = await client.sendEdits(comp, base, [{ op: 'setDefault', name: 'title', value: 'Landed' }]);
  assert.equal(again.ok, false);
  assert.match(again.error, /stale revision/);
  lines.push('An edit whose reply was cut after the server applied it: the client answered "stale revision ... may have landed", the file holds the edit exactly once, the canvas state caught up through the event stream, and a resend on the old base is stale (0 silent losses).');
});

test('the page shows the loss, reconnects, repaints what changed while it was away, and can edit again', async (t) => {
  const { compDir, fileOf } = tempRepo(['Card', 'Button']);
  const port = await freePort();
  let server = await startServer(compDir, { port });
  const b = await launchChromium();
  t.after(async () => { await b.close(); await server.stop(); });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1" && document.querySelectorAll(".cell .mount > *").length === 7');
  assert.equal(await b.eval('document.body.dataset.connection || "ok"'), 'ok');

  await server.stop();
  await b.waitFor('document.body.dataset.connection === "lost"', 3000);
  setLabel(fileOf('Card'), 'Repainted after reconnect');
  server = await startServer(compDir, { port });
  const t0 = performance.now();
  await b.waitFor('document.body.dataset.connection === "ok"', 2000);
  await b.waitFor(`[...document.querySelectorAll('.cmp[data-name="Card"] .mount')].some((m) => m.textContent.includes('Repainted after reconnect'))`, 3000);
  const ms = performance.now() - t0;
  assert.ok(ms <= 2000, `page current again ${ms.toFixed(0)} ms after the restart`);
  const r = await b.eval(`(async () => { const c = napkin.find('Card'); const r = await napkin.sendEdits(c.component, [{ op: 'setDefault', name: 'title', value: 'Edited by the reconnected page' }]); return r.ok ? 'ok' : r.error })()`);
  assert.equal(r, 'ok');
  assert.match(readFileSync(fileOf('Card'), 'utf8'), /Edited by the reconnected page/);
  lines.push(`Chromium page: the connection state went lost, then ok; the hand edit made during the outage was painted ${ms.toFixed(0)} ms after the restarted server printed its address (bar <= 2000 ms); the page's next edit was accepted.`);
});
