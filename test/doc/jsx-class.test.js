// className built by cn() / clsx() / classNames(): add and remove in the first plain string, exact splice, the file's own quotes; refuse with words when there is none.
// A new attribute goes after a {...props} spread (where it wins) and on its own line when the tag's attributes are one per line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openFolder } from '../../src/doc/folder.js';

const SRC = `import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("border-input flex min-h-16 w-full", error && 'bad', className)}
      {...props}
    />
  );
}
function Chip({ on }) { return <span className={clsx('chip', { on })}>x</span>; }
function Plain({ x }) { return <p className={cn(x, 'tail')}>y</p>; }
function None({ x }) { return <p className={cn(x, props.className)}>z</p>; }
export { Textarea, Chip, Plain, None };
`;
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-cls-'));
  writeFileSync(join(dir, 'T.tsx'), SRC);
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-cls-state-')) });
  const root = (name) => eng.tree(`T.tsx#${name}`).tree[0].node;
  const edit = (name, e) => eng.edit(`T.tsx#${name}`, { by: 't', edits: [{ ...e, node: root(name) }] });
  const text = () => readFileSync(join(dir, 'T.tsx'), 'utf8');
  return { dir, eng, edit, text, done: () => { eng.close(); rmSync(dir, { recursive: true, force: true }); } };
};
const changed = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return y.filter((l, i) => l !== x[i]); };

test('cn(): classes are added to and removed from the first plain string, with the quotes it has, as one-line splices', () => {
  const t = setup();
  try {
    t.edit('Textarea', { op: 'class', add: ['resize-none'] });
    assert.deepEqual(changed(SRC, t.text()), ['      className={cn("border-input flex min-h-16 w-full resize-none", error && \'bad\', className)}']);
    const mid = t.text();
    t.edit('Textarea', { op: 'class', remove: ['flex', 'min-h-16'] });
    assert.deepEqual(changed(mid, t.text()), ['      className={cn("border-input w-full resize-none", error && \'bad\', className)}']);
    t.edit('Chip', { op: 'class', add: ['big'], remove: ['chip'] });
    assert.match(t.text(), /className=\{clsx\('big', \{ on \}\)\}/);
    t.edit('Plain', { op: 'class', add: ['a'] });
    assert.match(t.text(), /className=\{cn\(x, 'tail a'\)\}/);
  } finally { t.done(); }
});

test('cn() with no plain string is refused in words, naming the function, and writes nothing', () => {
  const t = setup();
  try {
    assert.throws(() => t.edit('None', { op: 'class', add: ['a'] }), (e) => /computed in code: cn\(\) has no plain class string/.test(e.message) && /line \d+/.test(e.message));
    assert.equal(t.text(), SRC);
  } finally { t.done(); }
});

test('a new attribute lands after the spread, on its own line when the tag is written one attribute per line', () => {
  const t = setup();
  try {
    t.edit('Textarea', { op: 'attr', name: 'placeholder', value: 'hi' });
    assert.match(t.text(), /\{\.\.\.props\}\n      placeholder="hi"\n    \/>/);
    t.edit('Chip', { op: 'attr', name: 'title', value: 'c' });
    assert.match(t.text(), /<span className=\{clsx\('chip', \{ on \}\)\} title="c">/);
  } finally { t.done(); }
});
