// A running napkin server and a headless Chromium on its canvas, for the history lane's page tests.
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';
import { session, http } from '../helpers/agents.js';

export async function open(names = ['Button', 'Card', 'Chip'], { width = 1440, height = 900 } = {}) {
  const repo = tempRepo(names);
  const server = await startServer(dirname(repo.fileOf(names[0])));
  const browser = await launchChromium({ width, height });
  const errors = [];
  browser.send('Runtime.enable');
  await browser.send('Log.enable').catch(() => {});
  await browser.goto(server.url);
  await browser.waitFor('document.body.dataset.ready === "1"');
  const q = (e) => browser.eval(e);
  const rev = (n) => q(`napkin.find('${n}').revision`);
  const api = {
    ...repo, server, browser, io: input(browser), q, rev, errors,
    read: (n) => readFileSync(repo.fileOf(n), 'utf8'),
    // an agent or script writing through the HTTP API under its own name
    async as(name, comp, edits) {
      const token = await session(server.url, name);
      const cur = (await http(server.url, `/api/components/${comp}`)).json.revision;
      return (await http(server.url, `/api/components/${comp}/edits`, { method: 'POST', token, body: { baseRevision: cur, edits } })).json;
    },
    // your own edit through the page (identity "you")
    async you(comp, edits) { return q(`napkin.sendEdits(napkin.find('${comp}').component, ${JSON.stringify(edits)})`); },
    async settled(comp) { await browser.waitFor(`document.querySelector('section[data-name="${comp}"]')?.dataset.revision === String(napkin.find('${comp}').revision)`); await sleep(120); },
    async history(comp, limit = 100) { return (await http(server.url, `/api/components/${comp}/history?limit=${limit}`)).json.history; },
    async select(comp, node, variant = {}) { await q(`napkin.select({ component: napkin.find('${comp}').component, node: '${node}', variant: ${JSON.stringify(variant)} })`); await sleep(80); },
    async shot(name) { // docs/evidence/history-<name>.png when EVIDENCE_OUT is set
      if (!process.env.EVIDENCE_OUT) return;
      mkdirSync(process.env.EVIDENCE_OUT, { recursive: true });
      const f = join(process.env.EVIDENCE_OUT, `history-${name}.png`);
      writeFileSync(f, await browser.screenshot());
      if (statSync(f).size > 300 * 1024) throw new Error(`${f} is over 300 KB`);
    },
    async close() { await browser.close(); await server.stop(); },
  };
  return api;
}
export { sleep, waitFor, ROOT };
