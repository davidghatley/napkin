// D4 nothing imposed (LOCKED P0 measure; builders never edit). For each P0 corpus folder: git init and commit the copy,
// run `node src/cli.js open <folder> --port P`, time the first GET /api/files answer and the first /view render,
// answer the stylesheet question (POST /api/styles), make one edit through POST /api/edit, stop napkin.
// `git status --porcelain --untracked-files=all --ignored` must be empty after opening, show exactly one modified
// file (the edited one) after the edit, and still exactly that after napkin stops.
// Pass: every folder passes, and for ss-ds the first /view render lands within 2 s of running the command.
//   node bench/imposed.js [--corpus DIR] [--folder ss-ds] [--keep]
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { readFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { assembleCorpus, P0_FOLDERS } from './corpus.js';
import { SCRATCH, startNapkin, call, brief, listFiles, getComponent, viewPath, launchBrowser, finish, git, walk, L } from './p0-lib.js';

const FIRST_VIEW_MS = 2000;
const { values } = parseArgs({ options: { corpus: { type: 'string' }, folder: { type: 'string' }, keep: { type: 'boolean' } } });
const status = (dir) => git(dir, 'status', '--porcelain', '--untracked-files=all', '--ignored').split('\n').filter(Boolean);

async function main() {
  let corpus = values.corpus, made = false;
  if (!corpus) { corpus = assembleCorpus().dir; made = true; }
  const manifest = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8'));
  const stateDir = mkdtempSync(join(SCRATCH, 'napkin-p0-imposed-state-'));
  const folders = values.folder ? values.folder.split(',') : Object.keys(P0_FOLDERS);
  const browser = await launchBrowser(); // started before the clock: browser launch is not napkin's time
  const rows = [];
  try {
    for (const name of folders) {
      const dir = join(corpus, name);
      const row = { folder: name, opened: false, filesMs: null, firstViewMs: null, cleanAfterOpen: false, editOk: false, onlyEditedFile: false, cleanAfterStop: false, configFiles: walk(dir).filter((f) => /(^|\/)napkin\.json$|\.napkin\.json$/.test(f)), pass: false, reason: '' };
      const fail = (why) => { row.reason = row.reason || why; };
      rows.push(row);
      if (!existsSync(join(dir, '.git'))) { git(dir, 'init', '-q'); git(dir, 'add', '--all', '.'); git(dir, 'commit', '-q', '-m', 'P0 corpus copy'); }
      const before = status(dir);
      if (before.length) { fail(`the copy was not clean before napkin ran: ${before.slice(0, 3).join(' | ')}`); }
      const t0 = performance.now();
      const nk = await startNapkin(dir, { stateDir });
      let edited = null;
      try { body: {
        if (!nk.ok) { fail(nk.error); break body; }
        row.opened = true; row.filesMs = Math.round(performance.now() - t0);
        // First /view: the first component file the folder must show, its first component.
        const l = await listFiles(nk.base);
        const want = manifest.folders[name].components;
        const entry = l.ok && want.map((f) => l.files.find((x) => x.path === f && x.components.length)).find(Boolean);
        if (!entry) { fail(l.ok ? 'GET /api/files lists none of the folder\'s component files' : l.error); break body; }
        const comp = entry.components[0];
        const shot = await browser.shoot(nk.base + viewPath(comp.id, 800, 'light'), { width: 800, theme: 'light' });
        if (!shot.ok) fail(`first /view: ${shot.error}`); else row.firstViewMs = Math.round(performance.now() - t0);
        if (name === 'ss-ds' && row.firstViewMs !== null && row.firstViewMs > FIRST_VIEW_MS) fail(`first /view took ${row.firstViewMs} ms (bar ${FIRST_VIEW_MS})`);
        await call(nk.base, 'POST', '/api/styles', { applied: P0_FOLDERS[name].applied });
        const s1 = status(dir); row.cleanAfterOpen = s1.length === 0;
        if (!row.cleanAfterOpen) fail(`opening wrote into the folder: ${s1.slice(0, 4).join(' | ')}`);
        // One edit: an attribute (HTML) or prop (TSX) on the component's first node.
        const tree = await getComponent(nk.base, comp.id);
        if (!tree.ok) { fail(tree.error); break body; }
        const src = L(readFileSync(join(dir, entry.path)));
        const node = tree.flat.find((n) => Number.isInteger(n.start) && src[n.start] === '<');
        if (!node) { fail('GET /api/component has no node with a byte offset at a start tag'); break body; }
        const edit = entry.kind === 'html' ? { op: 'attr', node: node.node, name: 'data-bench', value: 'one' } : { op: 'prop', node: node.node, name: 'data-bench', value: 'one' };
        const r = await call(nk.base, 'POST', '/api/edit', { component: comp.id, baseRevision: tree.revision, edits: [edit] });
        row.editOk = r.status === 200 && r.json?.ok === true;
        if (!row.editOk) { fail(`POST /api/edit -> ${brief(r)}`); break body; }
        edited = entry.path;
        let s2 = []; for (let i = 0; i < 80; i++) { s2 = status(dir); if (s2.length) break; await new Promise((x) => setTimeout(x, 25)); }
        row.onlyEditedFile = s2.length === 1 && s2[0] === ` M ${edited}`;
        if (!row.onlyEditedFile) fail(`after one edit git status shows: ${s2.slice(0, 4).join(' | ') || '(nothing)'}`);
      } } finally { await nk.stop(); }
      const s3 = status(dir);
      row.cleanAfterStop = edited ? s3.length === 1 && s3[0] === ` M ${edited}` : s3.length === 0;
      if (!row.cleanAfterStop) fail(`after napkin stopped git status shows: ${s3.slice(0, 4).join(' | ') || '(nothing)'}`);
      row.pass = row.opened && row.cleanAfterOpen && row.editOk && row.onlyEditedFile && row.cleanAfterStop && !row.reason;
      console.log(`${row.pass ? 'PASS' : 'FAIL'} ${name}  files ${row.filesMs ?? '-'} ms  first view ${row.firstViewMs ?? '-'} ms${row.configFiles.length ? '  (config files in the corpus: ' + row.configFiles.join(', ') + ')' : ''}${row.reason ? '  ' + row.reason.slice(0, 220) : ''}`);
    }
  } finally { await browser.close(); rmSync(stateDir, { recursive: true, force: true }); }
  if (made && !values.keep) rmSync(corpus, { recursive: true, force: true });
  const ss = rows.find((r) => r.folder === 'ss-ds');
  finish({
    measure: 'D4-imposed', pass: rows.length > 0 && rows.every((r) => r.pass), fullRun: !values.folder,
    folders: Object.fromEntries(rows.map((r) => [r.folder, { pass: r.pass, filesMs: r.filesMs, firstViewMs: r.firstViewMs, cleanAfterOpen: r.cleanAfterOpen, editOk: r.editOk, onlyEditedFile: r.onlyEditedFile, cleanAfterStop: r.cleanAfterStop }])),
    ssDsFirstViewMs: ss?.firstViewMs ?? null,
    firstFailures: rows.filter((r) => !r.pass).map((r) => `${r.folder}: ${r.reason.slice(0, 160)}`),
    passLine: 'every folder: opens with one command, git status empty after open, exactly " M <edited file>" after one edit and after stop; ss-ds first /view <= 2000 ms from the command',
  });
}
main().catch((e) => { console.error(e.stack); finish({ measure: 'D4-imposed', pass: false, error: e.message }); });
