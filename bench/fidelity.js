// D1 fidelity (LOCKED P0 measure; builders never edit). For every component napkin lists in the P0 corpus, and for every
// component file the corpus must show, screenshot napkin's GET /view/<id>?width=W&theme=T and the same file opened
// directly in Chromium (same applied stylesheets, same width, same colour scheme), then pixel-diff the two.
// Pass: 100% of components rendered, every measured component at most 0.1% of pixels differing (a pixel differs when a
// channel differs by more than 2/255), napkin threw no error the reference did not, and 100% of HTML elements are
// selectable (a node in GET /api/component/<id> starts at the element's byte offset).
//   node bench/fidelity.js [--corpus DIR] [--folder ss-ds,edge] [--widths 360,1024] [--themes light,dark] [--keep]
import { parseArgs } from 'node:util';
import { join, dirname } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { assembleCorpus, P0_FOLDERS } from './corpus.js';
import { SCRATCH, MAX_DIFF, startNapkin, call, brief, listFiles, getComponent, viewPath, launchBrowser, diffPng, tsxReference, selectableStarts, finish, pct } from './p0-lib.js';

const { values } = parseArgs({ options: { corpus: { type: 'string' }, folder: { type: 'string' }, widths: { type: 'string', default: '360,1024' }, themes: { type: 'string', default: 'light,dark' }, keep: { type: 'boolean' } } });
const widths = values.widths.split(',').map(Number), themes = values.themes.split(',');
const defaults = values.widths === '360,1024' && values.themes === 'light,dark' && !values.folder;

async function main() {
  let corpus = values.corpus, made = false;
  if (!corpus) { corpus = assembleCorpus().dir; made = true; }
  const manifest = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8'));
  const out = mkdtempSync(join(SCRATCH, 'napkin-p0-fidelity-'));
  const stateDir = join(out, 'state');
  const folders = values.folder ? values.folder.split(',') : Object.keys(P0_FOLDERS);
  const browser = await launchBrowser();
  const rows = [], contractErrors = [];
  try {
    for (const name of folders) {
      const folder = join(corpus, name), applied = P0_FOLDERS[name].applied, expected = manifest.folders[name].components;
      console.log(`\n== ${name} (${expected.length} component files; applied: ${applied.join(', ') || 'none'})`);
      const nk = await startNapkin(folder, { stateDir });
      if (!nk.ok) {
        console.log(`  napkin did not open: ${nk.error}`);
        for (const f of expected) rows.push({ folder: name, file: f, id: null, rendered: false, pass: false, reason: 'napkin did not open the folder: ' + nk.error.slice(0, 160) });
        await nk.stop(); continue;
      }
      try {
        // The "ask once" answer: which stylesheets apply to this folder. Checked back with GET /api/styles.
        const set = await call(nk.base, 'POST', '/api/styles', { applied });
        const got = await call(nk.base, 'GET', '/api/styles');
        if (set.status !== 200 || JSON.stringify(got.json?.applied) !== JSON.stringify(applied)) contractErrors.push(`${name}: POST /api/styles -> ${brief(set)}; GET /api/styles -> ${brief(got)} (expected applied ${JSON.stringify(applied)})`);
        const list = await listFiles(nk.base);
        if (!list.ok) { contractErrors.push(`${name}: ${list.error}`); for (const f of expected) rows.push({ folder: name, file: f, id: null, rendered: false, pass: false, reason: list.error }); continue; }
        const byPath = new Map(list.files.map((f) => [f.path, f]));
        for (const f of expected) if (!byPath.get(f)?.components?.length) rows.push({ folder: name, file: f, id: null, rendered: false, pass: false, reason: byPath.has(f) ? 'listed with 0 components' : 'not listed by GET /api/files' });
        for (const file of list.files) {
          if (!['html', 'tsx', 'jsx'].includes(file.kind) || !file.components.length) continue;
          const abs = join(folder, file.path);
          // HTML: every element of the file must be selectable (union of the file's component trees).
          let selectable = null;
          if (file.kind === 'html' && existsSync(abs)) {
            const want = selectableStarts(readFileSync(abs)); const have = new Set();
            for (const c of file.components) { const t = await getComponent(nk.base, c.id); if (t.ok) for (const n of t.flat) if (Number.isInteger(n.start)) have.add(n.start); }
            const missing = want.filter((w) => !have.has(w.start));
            selectable = { want: want.length, have: want.length - missing.length, missing: missing.slice(0, 5).map((m) => `<${m.tag}>@${m.start}`) };
          }
          for (const c of file.components) {
            const row = { folder: name, file: file.path, id: c.id, name: c.name, rendered: true, worst: 0, configs: [], selectable, pass: true, reason: '' };
            const fail = (why) => { row.pass = false; row.reason = row.reason || why; };
            let ref = null;
            if (file.kind === 'html') ref = file.components.length === 1 ? { url: 'file://' + abs, inject: applied.map((p) => 'file://' + join(folder, p)) } : { error: 'the contract defines no direct-open reference for one of several components in one HTML file' };
            else { const r = await tsxReference(abs, c.name, folder, join(out, 'ref', name, c.id.replace(/[^\w.-]+/g, '_')), applied); ref = r.ok ? { url: r.url, inject: [] } : { error: r.error }; }
            for (const width of widths) for (const theme of themes) {
              const cfg = { width, theme };
              const head = await call(nk.base, 'GET', viewPath(c.id, width, theme));
              const a = head.status === 200 ? await browser.shoot(nk.base + viewPath(c.id, width, theme), { width, theme }) : { ok: false, error: `GET /view -> ${brief(head)}` };
              if (!a.ok) { row.rendered = false; fail(`not rendered at ${width}/${theme}: ${a.error}`); row.configs.push(cfg); continue; }
              if (ref.error) { cfg.reference = ref.error; row.configs.push(cfg); continue; }
              const b = await browser.shoot(ref.url, { width, theme, inject: ref.inject });
              const refThrew = !b.ok || b.errors.length || (await browser.eval('window.__refError || null').catch(() => null));
              if (!b.ok || (file.kind !== 'html' && refThrew)) { cfg.reference = b.ok ? `reference render error: ${refThrew}` : b.error; row.configs.push(cfg); continue; }
              const d = diffPng(a.png, b.png);
              Object.assign(cfg, { diffPct: pct(d.differing, d.total), sizes: d.sizes, napkinErrors: a.errors.length });
              row.worst = Math.max(row.worst, d.ratio);
              if (d.ratio > MAX_DIFF) {
                fail(`${pct(d.differing, d.total)}% pixels differ at ${width}/${theme} (napkin ${d.sizes[0]}x${d.sizes[1]}, reference ${d.sizes[2]}x${d.sizes[3]})`);
                const base = join(out, 'diff', name, `${c.id}-${width}-${theme}`.replace(/[^\w.-]+/g, '_'));
                mkdirSync(dirname(base), { recursive: true }); writeFileSync(base + '.napkin.png', a.png); writeFileSync(base + '.reference.png', b.png);
              }
              if (a.errors.length && !b.errors.length) fail(`napkin's view threw where the reference did not: ${a.errors[0]}`);
              row.configs.push(cfg);
            }
            row.measured = row.configs.some((x) => x.diffPct !== undefined);
            if (row.rendered && !row.measured && row.configs.every((x) => x.reference)) row.noReference = row.configs[0].reference;
            if (selectable && selectable.have < selectable.want) fail(`${selectable.want - selectable.have} of ${selectable.want} elements not selectable (${selectable.missing.join(' ')})`);
            rows.push(row);
            console.log(`  ${row.pass ? 'PASS' : 'FAIL'} ${file.path}${file.components.length > 1 ? '#' + c.name : ''}  worst ${pct(row.worst, 1)}%${selectable ? `  selectable ${selectable.have}/${selectable.want}` : ''}${row.noReference ? '  (no reference: ' + row.noReference + ')' : ''}${row.reason ? '  ' + row.reason : ''}`);
          }
        }
        for (const r of rows.filter((x) => x.folder === name && !x.id)) console.log(`  FAIL ${r.file}  ${r.reason}`);
      } finally { await nk.stop(); }
    }
  } finally { await browser.close(); }

  const total = rows.length, rendered = rows.filter((r) => r.rendered).length;
  const measured = rows.filter((r) => r.measured), within = measured.filter((r) => r.worst <= MAX_DIFF).length;
  const sel = rows.filter((r) => r.selectable), selWant = sel.reduce((n, r) => n + r.selectable.want, 0), selHave = sel.reduce((n, r) => n + r.selectable.have, 0);
  const per = Object.fromEntries(folders.map((f) => { const r = rows.filter((x) => x.folder === f); return [f, { components: r.length, rendered: r.filter((x) => x.rendered).length, pass: r.filter((x) => x.pass).length }]; }));
  const pass = total > 0 && rendered === total && rows.every((r) => r.pass) && selHave === selWant && contractErrors.length === 0;
  if (contractErrors.length) console.log('\ncontract errors:\n  ' + contractErrors.join('\n  '));
  if (made && !values.keep) rmSync(corpus, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true }); rmSync(join(out, 'ref'), { recursive: true, force: true });
  const kept = existsSync(join(out, 'diff')); if (!kept) rmSync(out, { recursive: true, force: true });
  finish({
    measure: 'D1-fidelity', pass, fullRun: defaults, corpus: values.keep || !made ? corpus : '(removed)', out: kept ? out : null,
    components: total, renderedPct: pct(rendered, total), measured: measured.length, withinDiffPct: pct(within, measured.length),
    worstDiffPct: measured.length ? Math.max(...measured.map((r) => pct(r.worst, 1))) : null,
    noReference: rows.filter((r) => r.noReference).map((r) => `${r.folder}/${r.file}#${r.name}`),
    selectablePct: pct(selHave, selWant), perFolder: per, contractErrors: contractErrors.length,
    firstFailures: rows.filter((r) => !r.pass).slice(0, 8).map((r) => `${r.folder}/${r.file}${r.name ? '#' + r.name : ''}: ${r.reason.slice(0, 140)}`),
    passLine: 'renderedPct 100, every measured component worst diff <= 0.1% (>2/255 per channel), selectablePct 100, 0 contract errors',
  });
}
main().catch((e) => { console.error(e.stack); finish({ measure: 'D1-fidelity', pass: false, error: e.message }); });
