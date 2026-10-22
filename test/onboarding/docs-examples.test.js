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
