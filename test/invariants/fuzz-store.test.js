// FMT-05, through the real commit path: the fuzz runs through store.apply (revisions, atomic writes, the disk check) on
// hand-formatted starts (tabs, CRLF, double quotes, comments, compounded indentation), and after every edit the file on
// disk parses, is in the dialect, equals the store's model, and a no-change save leaves its bytes alone.
// FUZZ=2000 for the long run (default 200 edits spread over 4 files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { openStore } from '../../src/store.js';
import { tsxCodec } from '../../src/codecs.js';
import { readComponent } from '../../src/tsx/read.js';
import { makeCorpus } from '../helpers/corpus.js';
import { rng, nextValidEdit } from '../helpers/fuzz.js';

const FUZZ = Number(process.env.FUZZ || 200);
test(`FMT-05: ${FUZZ} edits through store.apply on hand-formatted files keep every file valid, equal to the model and stable`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-fuzzstore-'));
  const files = makeCorpus(dir, 24, 9090);
  // make sure the starts really differ in layout
  const kinds = new Set(files.map((f) => { const t = readFileSync(f, 'utf8'); return `${/\t/.test(t)}${t.includes('\r\n')}${/: "/.test(t)}`; }));
  assert.ok(kinds.size > 1, 'the starts are not all alike');
  const rand = rng(31);
  const per = Math.ceil(FUZZ / files.length);
  let applied = 0;
  for (const f of files) {
    const store = await openStore(f);
    try {
      for (let n = 0, done = 0; done < per && applied < FUZZ && n < per * 20; n++) {
        const { doc, revision } = await store.read();
        const r = nextValidEdit(doc, rand, n);
        if (!r) continue;
        const res = await store.apply({ baseRevision: revision, edits: [r.edit], by: 'fuzz' });
        assert.equal(res.ok, true, `${basename(f)} ${JSON.stringify(r.edit)}: ${res.error}`);
        const disk = readFileSync(f, 'utf8');
        const { id, ...model } = res.doc;
        assert.deepEqual(readComponent(disk).doc, model, `${basename(f)} after ${JSON.stringify(r.edit)}`);
        assert.doesNotMatch(disk, /\r\r/, 'no doubled line endings');
        const again = tsxCodec.load(disk);
        assert.equal(tsxCodec.save(again.state, again.doc, again.doc).text, disk, 'a no-change save is byte-identical');
        done++; applied++;
      }
    } finally { await store.close(); }
  }
  console.log(`FMT-05 (store.apply, hand-formatted starts): ${applied}/${FUZZ} edits applied; every file valid, equal to the model, no-change save identical`);
  assert.equal(applied, FUZZ);
});
