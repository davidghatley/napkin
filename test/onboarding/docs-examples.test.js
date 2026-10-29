import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readComponent } from '../../src/tsx/read.js';
import { ROOT } from '../helpers/harness.js';

test('WPC-04: every complete TSX component in docs and docs/guide is editable', () => {
  let complete = 0;
  for (const folder of ['docs', 'docs/guide']) {
    for (const name of readdirSync(join(ROOT, folder)).filter(n => n.endsWith('.md'))) {
      const file = `${folder}/${name}`, text = readFileSync(join(ROOT, file), 'utf8');
      for (const block of text.matchAll(/^```tsx[^\n]*\n([\s\S]*?)^```/gm)) {
        const source = block[1];
        // Usage lines and fragments have no exported component. Check every
        // exported component, including unsupported arrow/default forms, so
        // a future example cannot silently become a read-only file.
        if (!/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\s+[A-Z]|(?:const|let)\s+[A-Z])/.test(source)) continue;
        const line = text.slice(0, block.index).split('\n').length;
        assert.doesNotThrow(() => readComponent(source), `${file}:${line} must open editable`);
        complete++;
      }
    }
  }
  assert.ok(complete > 0, 'the docs must include a complete, pasteable component');
});

// WPC-36: the docs state counts and persistence; they must match what the product does.
import { parseTokens } from '../../src/tokens.js';
test('WPC-36: the README token count is the demo token count, and no guide says proposals die with the session', () => {
  const demo = parseTokens(readFileSync(join(ROOT, 'fixtures/tokens/demo-tokens.json'), 'utf8')).tokens.length;
  const stated = [...readFileSync(join(ROOT, 'README.md'), 'utf8').matchAll(/demo includes (\d+) tokens/g)].map((m) => Number(m[1]));
  assert.deepEqual(stated, [demo], `README says ${stated}, the demo has ${demo}`);
  for (const file of ['README.md', 'docs/guide/concepts.md', 'docs/guide/GAPS.md']) {
    const text = readFileSync(join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /(proposals?[^.]{0,60}(last only|server memory|live in memory)|History and proposals last)/i, `${file} says proposals do not survive a restart, but .napkin/proposals.json keeps them`);
  }
  assert.match(readFileSync(join(ROOT, 'docs/guide/concepts.md'), 'utf8'), /\.napkin\/proposals\.json/);
});

test('WPC-36: the quickstart makes the new folder outside this checkout', () => {
  for (const file of ['README.md', 'docs/guide/quickstart.md']) {
    const inits = [...readFileSync(join(ROOT, file), 'utf8').matchAll(/node src\/cli\.js (?:init|open) (\S*my-napkin)/g)].map((m) => m[1]);
    assert.ok(inits.length >= 2, file);
    for (const path of inits) assert.match(path, /^(\.\.\/|\/|~)/, `${file}: ${path} is inside the checkout`);
  }
});
