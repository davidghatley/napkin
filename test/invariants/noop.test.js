// INV-02: opening a component and saving with no change gives the same bytes, for every fixture and for a
// 40-component corpus generated at test time (test/helpers/corpus.js: varied props, variants, nesting, and hand
// formatting such as tabs, CRLF, double quotes and comments). Checked at the codec and through the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { tsxCodec } from '../../src/codecs.js';
import { openStore } from '../../src/store.js';
import { newComponentSource } from '../../src/tsx/write.js';
import { fixture } from '../helpers/harness.js';
import { makeCorpus } from '../helpers/corpus.js';
import { ROOT } from '../helpers/harness.js';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const fixtures = readdirSync(join(ROOT, 'fixtures')).map((n) => fixture(n)).filter((f) => existsSync(f));

// A change that is not a change: set the first styled property of the root to the value it has.
function nothing(doc) {
  const [k, v] = Object.entries(doc.root.style)[0];
  return [{ op: 'set', path: `${doc.root.id}.${k}`, value: v }];
}

test('INV-02: every fixture and a new component: codec save without edits is byte-identical', () => {
  const texts = [...fixtures.map((f) => readFileSync(f, 'utf8')), newComponentSource('Badge')];
  for (const t of texts) {
    const { doc, state } = tsxCodec.load(t);
    assert.equal(tsxCodec.save(state, doc, doc).text, t);
  }
  assert.ok(texts.length >= 3);
});

test('INV-02: 40/40 generated corpus components: open, apply a no-change edit, save: sha256 identical', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-corpus-'));
  const files = makeCorpus(dir, 40);
  for (const f of fixtures) copyFileSync(f, join(dir, basename(f)));
  assert.equal(files.length, 40);
  const crlf = files.filter((f) => readFileSync(f, 'utf8').includes('\r\n')).length;
  const tabs = files.filter((f) => /^\t/m.test(readFileSync(f, 'utf8'))).length;
  const doubleQuoted = files.filter((f) => /: "/.test(readFileSync(f, 'utf8'))).length;
  assert.ok(crlf > 0 && tabs > 0 && doubleQuoted > 0, 'the corpus really is varied');
  let identical = 0;
  for (const f of [...files, ...fixtures.map((x) => join(dir, basename(x)))]) {
    const before = sha(f);
    const t = readFileSync(f, 'utf8');
    const { doc, state } = tsxCodec.load(t);
    assert.equal(tsxCodec.save(state, doc, doc).text, t, `${basename(f)}: codec`);
    const store = await openStore(f);
    try {
      const { revision, doc: d } = await store.read();
      const mtime = statSync(f).mtimeMs;
      const r = await store.apply({ baseRevision: revision, edits: nothing(d), by: 'test' });
      assert.equal(r.ok, true, `${basename(f)}: ${r.error}`);
      assert.equal(statSync(f).mtimeMs, mtime, `${basename(f)}: a no-change save does not even touch the file`);
    } finally { await store.close(); }
    assert.equal(sha(f), before, `${basename(f)}: sha256`);
    identical++;
  }
  console.log(`INV-02: ${identical}/${files.length + fixtures.length} files byte-identical (corpus ${files.length}: ${crlf} CRLF, ${tabs} tab-indented, ${doubleQuoted} double-quoted; fixtures ${fixtures.length})`);
  assert.equal(identical, files.length + fixtures.length);
});

test('INV-02: reopening leaves the sidecar bytes alone too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-side-'));
  const [f] = makeCorpus(dir, 1);
  const s0 = await openStore(f);
  assert.equal(existsSync(f.replace(/\.tsx$/, '.napkin.json')), false);
  await s0.moveCanvas(10, 20); await s0.close();
  const { readSidecar } = await import('../../src/codecs.js');
  readSidecar(f, 'Badge'); // reads the already saved sidecar
  const side = f.replace(/\.tsx$/, '.napkin.json');
  const before = sha(side);
  const s = await openStore(f); await s.close();
  readSidecar(f, 'Badge');
  assert.equal(sha(side), before);
});
