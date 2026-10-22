// Child for the kill tests (INV-01). node edit-loop.mjs <file> <seed>
// Opens the store and applies random valid edits as fast as it can. Before each write it prints "P <sha>" (the file it is
// about to write) and after the write "C <sha>", so the parent knows the only two files the disk may hold when it kills us.
import { createHash } from 'node:crypto';
import { openStore } from '../../src/store.js';
import { rng, nextValidEdit } from './fuzz.js';

const [file, seed] = process.argv.slice(2);
const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const store = await openStore(file);
const rand = rng(Number(seed));
const first = await store.read();
process.stdout.write(`C ${sha(first.source)}\nready\n`);
for (let n = 0; ; n++) {
  const { doc, revision } = await store.read();
  const r = nextValidEdit(doc, rand, n);
  if (!r) continue;
  const dry = await store.apply({ baseRevision: revision, edits: [r.edit], dryRun: true });
  process.stdout.write(`P ${sha(dry.source)}\n`);
  const res = await store.apply({ baseRevision: revision, edits: [r.edit], by: 'loop' });
  if (res.ok) process.stdout.write(`C ${sha((await store.read()).source)}\n`);
}
