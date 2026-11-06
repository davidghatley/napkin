// Child for REL-01. node atomic-loop.mjs <file> <mode: atomic|naive> <kb>
// Writes two big payloads alternately, forever. "atomic" uses src/atomic.js; "naive" truncates and writes in place (the control).
import { writeFileSync } from 'node:fs';
import { writeAtomic } from '../../src/atomic.js';
import { payload } from './payload.js';

const [file, mode, kb] = process.argv.slice(2);
const A = payload('A', Number(kb)), B = payload('B', Number(kb));
const write = mode === 'atomic' ? (t) => writeAtomic(file, t) : (t) => writeFileSync(file, t);
process.stdout.write('ready\n');
for (;;) { write(A); write(B); }
