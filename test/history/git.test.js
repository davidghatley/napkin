// HIS-05 git awareness: who a change is attributed to when git rewrote the file, the changed-since-HEAD list and the diff
// against HEAD, and "napkin never commits" (the commit count stays put through all of it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { rig, sleep, waitFor } from './helpers.js';

const commits = (r) => Number(r.git('rev-list', '--count', 'HEAD').trim());
const ident = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid'];
// the newest history entry once the history has grown past `seen` entries
async function next(r, seen, n = 'Card') {
  const { value } = await waitFor(async () => { const h = await r.history(n, 500); return h.length > seen ? h : null; }, 5000);
  return { entry: value[0], count: value.length };
}
const hand = (r, from, to) => writeFileSync(r.fileOf('Card'), r.read('Card').replace(from, to));

test('HIS-05: git checkout, restore and a branch switch are attributed to git; a hand edit stays file', async () => {
  const r = await rig(['Card']);
  const n0 = commits(r);
  try {
    let seen = (await r.history('Card', 500)).length, e;
    hand(r, 'fontWeight: 400', 'fontWeight: 900');
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'file'); assert.equal(e.summary, 'file changed on disk');

    r.git('checkout', '--', 'components/Card.tsx'); // back to the committed text
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'git', JSON.stringify(e)); assert.equal(e.summary, 'git checkout'); assert.equal(e.kind, 'git');
    const act = (await r.call(null, 'GET', '/api/activity')).activity[0];
    assert.equal(act.by, 'git');

    hand(r, "padding: '16px'", "padding: '99px'");
    ({ count: seen } = await next(r, seen));
    r.git('restore', 'components/Card.tsx');
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'git', 'git restore');

    // a branch switch that changes the file: HEAD moved, and the new text is not the old HEAD's
    const main = r.git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    r.git('checkout', '-q', '-b', 'other');
    hand(r, "padding: '16px'", "padding: '77px'");
    ({ count: seen } = await next(r, seen));
    r.git(...ident, 'commit', '-qam', 'pad');
    await sleep(100);
    r.git('checkout', '-q', main);
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'git'); assert.equal(e.summary, 'git checkout');
    r.git(...ident, 'merge', '-q', '--ff-only', 'other');
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'git'); assert.equal(e.summary, 'git merge', 'a fast-forward merge');

    // right after a commit, a hand edit is still a hand edit
    hand(r, "padding: '77px'", "padding: '55px'");
    ({ count: seen } = await next(r, seen));
    r.git(...ident, 'commit', '-qam', 'again');
    hand(r, "padding: '55px'", "padding: '44px'");
    ({ entry: e } = await next(r, seen));
    assert.equal(e.by, 'file', 'a commit is not a file change, and the edit after it is the person');
    assert.ok(commits(r) > n0, 'only the test made commits');
  } finally { await r.close(); }
});

test('HIS-05: changed-since-HEAD list, diff against HEAD, and 0 commits made by napkin', async () => {
  const r = await rig(['Card', 'Button']);
  try {
    const n0 = commits(r), head0 = r.git('rev-parse', 'HEAD').trim();
    let st = await r.call(null, 'GET', '/api/git');
    assert.equal(st.git, true); assert.deepEqual(st.components, [], 'clean at HEAD: no dots');
    assert.equal((await r.call(null, 'GET', '/api/components/Card/diff')).diff, '');

    await r.edit('you', 'Card', [{ op: 'set', path: 'card.padding', value: '31px' }]);
    st = await r.call(null, 'GET', '/api/git');
    assert.deepEqual(st.components.map((c) => [c.name, c.state]), [['Card', 'modified']], 'a dot on Card only');
    const d = (await r.call(null, 'GET', '/api/components/Card/diff')).diff;
    assert.match(d, /^-\s+padding: '16px',$/m); assert.match(d, /^\+\s+padding: '31px',$/m);

    await r.edit('you', 'Card', [{ op: 'set', path: 'card.padding', value: '16px' }]); // back to the committed text: no longer changed
    assert.deepEqual((await r.call(null, 'GET', '/api/git')).components, []);

    // a component that was never committed
    const c = await r.call('you', 'POST', '/api/components', { name: 'Fresh' });
    assert.equal(c.status, 201);
    st = await r.call(null, 'GET', '/api/git');
    assert.deepEqual(st.components.map((x) => [x.name, x.state]), [['Fresh', 'added']]);
    assert.match((await r.call(null, 'GET', '/api/components/Fresh/diff')).diff, /^\+export function Fresh/m);

    // undo, restore and approval are all revisions, never commits
    await r.edit('you', 'Button', [{ op: 'set', path: 'root.padding', value: '1px' }]);
    await r.call('you', 'POST', '/api/undo', {});
    assert.equal(commits(r), n0); assert.equal(r.git('rev-parse', 'HEAD').trim(), head0);
    assert.equal(r.git('status', '--porcelain', '--', 'components/Button.tsx').trim(), '', 'undo left Button as committed');
  } finally { await r.close(); }
});

test('HIS-05: git stash and stash pop are git; a hand edit right after checkout -b, git status or a commit is file', async () => {
  const r = await rig(['Card']);
  try {
    let seen = (await r.history('Card', 500)).length, e;
    // a hand edit, then stash it away and bring it back
    hand(r, "padding: '16px'", "padding: '61px'");
    ({ count: seen } = await next(r, seen));
    r.git(...ident, 'stash', '-q');
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'git'); assert.equal(e.summary, 'git stash');
    r.git(...ident, 'stash', 'pop', '-q');
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'git', 'stash pop is git, not file'); assert.equal(e.summary, 'git stash');
    assert.match(r.read('Card'), /padding: '61px'/);

    // checkout -b changes no content; a hand edit within the window is the person
    r.git('checkout', '-q', '-b', 'topic');
    hand(r, "padding: '61px'", "padding: '62px'");
    ({ entry: e, count: seen } = await next(r, seen));
    assert.equal(e.by, 'file', 'a hand edit right after checkout -b');
    // and right after `git status` (which rewrites the index)
    r.git('status', '--short');
    hand(r, "padding: '62px'", "padding: '63px'");
    ({ entry: e } = await next(r, seen));
    assert.equal(e.by, 'file', 'a hand edit right after git status');
  } finally { await r.close(); }
});
