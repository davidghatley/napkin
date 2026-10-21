// HIS-01 undo and redo your own edits, HIS-02 refused after someone else's change, HIS-03 restore, and the history record
// (who approved a proposal). Server side, no browser: the canvas's Cmd+Z is tested in test/history/ui.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { rig, waitFor } from './helpers.js';

const PAD = (v) => [{ op: 'set', path: 'card.padding', value: v }];
const WEIGHT = (v) => [{ op: 'set', path: 'title.fontWeight', value: v }];

test('HIS-01: undo and redo are your own edits, as new attributed revisions, and the file goes back byte for byte', async () => {
  const r = await rig(['Card']);
  try {
    const original = r.read('Card');
    const first = await r.edit('you', 'Card', PAD('40px'));
    assert.equal(first.ok, true);
    const edited = r.read('Card');
    assert.notEqual(edited, original);
    // an agent changes something else afterwards: it is not yours to undo
    assert.equal((await r.edit('bot', 'Card', WEIGHT(700))).ok, true);
    const revBefore = await r.rev('Card');

    const u = await r.call('you', 'POST', '/api/undo', {});
    assert.equal(u.status, 200, JSON.stringify(u));
    assert.notEqual(u.revision, revBefore, 'a new revision');
    const now = r.read('Card');
    assert.match(now, /padding: '16px'/, 'the old value is back');
    assert.match(now, /fontWeight: 700/, "the agent's edit stays");
    const top = (await r.history('Card'))[0];
    assert.equal(top.by, 'you'); assert.equal(top.kind, 'undo'); assert.equal(top.undoOf, first.revision);
    assert.match(top.summary, /^undo: card\.padding = "40px"/);
    // the reverse diff of the original: the one changed line is the inverse
    const git = (...a) => execFileSync('git', a, { cwd: r.dir, encoding: 'utf8' });
    const d = git('diff', '--unified=0', '--', 'components/Card.tsx');
    assert.match(d, /^-\s+fontWeight: 400,\n\+\s+fontWeight: 700,/m);
    assert.doesNotMatch(d, /padding/, 'padding is back to what HEAD has');

    const redo = await r.call('you', 'POST', '/api/redo', {});
    assert.equal(redo.status, 200, JSON.stringify(redo));
    assert.match(r.read('Card'), /padding: '40px'/);
    assert.equal((await r.history('Card'))[0].kind, 'redo');
    // undo again goes back (redo's step is undoable)
    assert.equal((await r.call('you', 'POST', '/api/undo', {})).status, 200);
    assert.match(r.read('Card'), /padding: '16px'/);
    // nothing left of yours
    const none = await r.call('you', 'POST', '/api/undo', {});
    assert.equal(none.status, 409); assert.match(none.error, /nothing to undo/);
  } finally { await r.close(); }
});

test('HIS-01: nobody undoes someone else\'s edit, a file change, or a git change', async () => {
  const r = await rig(['Card']);
  try {
    await r.edit('bot', 'Card', PAD('50px'));
    const a = await r.call('you', 'POST', '/api/components/Card/undo', {});
    assert.equal(a.status, 409); assert.match(a.error, /nothing to undo/, "an agent's edit is not yours");
    writeFileSync(r.fileOf('Card'), r.read('Card').replace("fontWeight: 400", 'fontWeight: 900'));
    await waitFor(async () => (await r.history('Card'))[0].by === 'file');
    const b = await r.call('you', 'POST', '/api/undo', {});
    assert.equal(b.status, 409);
    assert.match(r.read('Card'), /fontWeight: 900/);
    assert.equal((await r.call(null, 'POST', '/api/undo', {})).status, 401, 'identity required');
    // and the agent can undo its own
    const c = await r.call('bot', 'POST', '/api/undo', {});
    assert.equal(c.status, 200, JSON.stringify(c));
    assert.match(r.read('Card'), /padding: '16px'/);
  } finally { await r.close(); }
});

// Every op comes back exactly: the undo of each batch leaves the file identical to before it.
const BATCHES = {
  'set base style': ['Card', [{ op: 'set', path: 'card.padding', value: '3px' }, { op: 'set', path: 'title.margin', value: null }]],
  'set text': ['Card', [{ op: 'set', path: 'body.text', value: 'Hello there' }]],
  'insert a node': ['Card', [{ op: 'insert', parent: 'card', index: 1, node: { id: 'extra', tag: 'span', text: 'x', style: { color: 'red' } } }]],
  'delete a node': ['Card', [{ op: 'delete', id: 'image' }]],
  'move a node': ['Card', [{ op: 'move', id: 'title', parent: 'card', index: 0 }]],
  'rename a node': ['Card', [{ op: 'rename', id: 'body', to: 'copy' }]],
  'make a setting': ['Card', [{ op: 'bindText', id: 'body', prop: 'blurb' }]],
  'add a prop': ['Card', [{ op: 'addProp', name: 'subtitle', type: 'string', default: 'Sub' }]],
  'add a variant': ['Card', [{ op: 'addVariant', axis: 'tone', value: 'dark', base: 'light' }]],
  'variant override': ['Button', [{ op: 'set', path: 'root.padding', variant: { size: 'sm' }, value: '1px 2px' }, { op: 'set', path: 'label.color', variant: { state: 'hover' }, value: '#fff' }]],
  'remove a variant override': ['Button', [{ op: 'set', path: 'root.padding', variant: { size: 'sm' }, value: null }]],
  'remove a variant value': ['Button', [{ op: 'removeVariant', axis: 'size', value: 'lg' }]],
  'change a default': ['Button', [{ op: 'setDefault', name: 'label', value: 'Pay' }]],
  'delete a node with overrides': ['Button', [{ op: 'delete', id: 'label' }]],
};
for (const [name, [comp, edits]] of Object.entries(BATCHES)) {
  test(`HIS-01: undo restores the file exactly after "${name}"`, async () => {
    const r = await rig(['Card', 'Button']);
    try {
      const original = r.read(comp);
      const e = await r.edit('you', comp, edits);
      assert.equal(e.ok, true, JSON.stringify(e));
      const edited = r.read(comp);
      assert.notEqual(edited, original);
      const u = await r.call('you', 'POST', `/api/components/${comp}/undo`, {});
      assert.equal(u.status, 200, JSON.stringify(u));
      assert.equal(r.read(comp), original, 'file identical to before the edit');
      const re = await r.call('you', 'POST', `/api/components/${comp}/redo`, {});
      assert.equal(re.status, 200, JSON.stringify(re));
      assert.equal(r.read(comp), edited, 'redo gives the edit back');
    } finally { await r.close(); }
  });
}

test('HIS-02: undo is refused when someone else changed one of the same keys afterwards: 100% of 30 races', async () => {
  const r = await rig(['Card']);
  try {
    let refused = 0, names = 0;
    for (let i = 0; i < 30; i++) {
      const who = i % 3 === 0 ? 'file' : 'bot' + (i % 2);
      await r.edit('you', 'Card', PAD(`${20 + i}px`));
      const mine = await r.rev('Card');
      let theirs;
      if (who === 'file') {
        writeFileSync(r.fileOf('Card'), r.read('Card').replace(/padding: '\d+px'/, `padding: '${60 + i}px'`));
        await waitFor(async () => (await r.history('Card'))[0].by === 'file' && (await r.history('Card'))[0].revision !== mine);
        theirs = (await r.history('Card'))[0].revision;
      } else if (i % 2) { // the other writer lands while the undo is already queued behind it
        const base = await r.rev('Card'); await r.as(who);
        const p = r.call(who, 'POST', '/api/components/Card/edits', { baseRevision: base, edits: PAD(`${60 + i}px`) });
        const u = r.call('you', 'POST', '/api/undo', {});
        const [e, undo] = await Promise.all([p, u]);
        theirs = e.revision;
        assert.equal(undo.status, 409, JSON.stringify(undo));
        refused++; if (undo.error.includes(who) && undo.error.includes(`revision ${theirs}`)) names++;
        assert.equal(undo.refused.by, who); assert.equal(undo.refused.revision, theirs); assert.ok(undo.refused.keys.includes('card.padding'));
        continue;
      } else theirs = (await r.edit(who, 'Card', PAD(`${60 + i}px`))).revision;
      const before = r.read('Card');
      const undo = await r.call('you', 'POST', '/api/undo', {});
      assert.equal(undo.status, 409, JSON.stringify(undo));
      assert.equal(r.read('Card'), before, 'a refused undo writes nothing');
      refused++;
      if (undo.error.includes(who) && undo.error.includes(`revision ${theirs}`)) names++;
      assert.equal(undo.refused.by, who);
      // clear this step so the next round starts clean (the step stays refused until someone resolves it)
      r.api.proposals.clear();
      await r.call('you', 'POST', '/api/components/Card/restore', { revision: mine });
    }
    assert.equal(refused, 30); assert.equal(names, 30, 'every refusal names who and which revision');
  } finally { await r.close(); }
});

test('HIS-02: a change to a different property does not block undo, and keeps the other writer\'s change', async () => {
  const r = await rig(['Card']);
  try {
    await r.edit('you', 'Card', PAD('33px'));
    await r.edit('bot', 'Card', WEIGHT(800));
    assert.equal((await r.call('you', 'POST', '/api/undo', {})).status, 200);
    assert.match(r.read('Card'), /padding: '16px'/); assert.match(r.read('Card'), /fontWeight: 800/);
  } finally { await r.close(); }
});

test('HIS-03: restore makes ONE new revision that brings back an older document', async () => {
  const r = await rig(['Card']);
  try {
    const original = r.read('Card');
    const base = (await r.history('Card'))[0].revision;
    await r.edit('you', 'Card', PAD('20px'));
    const keep = (await r.history('Card'))[0].revision;
    const afterFirst = r.read('Card');
    await r.edit('bot', 'Card', WEIGHT(700));
    await r.edit('you', 'Card', [{ op: 'insert', parent: 'card', node: { id: 'note', tag: 'p', text: 'new' } }]);
    const n = (await r.history('Card', 200)).length;
    const res = await r.call('you', 'POST', '/api/components/Card/restore', { revision: keep });
    assert.equal(res.status, 200, JSON.stringify(res));
    assert.equal((await r.history('Card', 200)).length, n + 1, 'exactly one new revision');
    assert.equal(r.read('Card'), afterFirst);
    const top = (await r.history('Card'))[0];
    assert.equal(top.by, 'you'); assert.equal(top.kind, 'restore'); assert.equal(top.restoreOf, keep);
    // restoring the opening revision goes all the way back
    assert.equal((await r.call('you', 'POST', '/api/components/Card/restore', { revision: base })).status, 200);
    assert.equal(r.read('Card'), original);
    // the past is readable too (scrub preview)
    const at = await r.call(null, 'GET', `/api/components/Card/at?revision=${keep}`);
    assert.equal(at.ok, true); assert.equal(at.source, afterFirst);
    assert.equal((await r.call('you', 'POST', '/api/components/Card/restore', { revision: 'nope' })).status, 409);
  } finally { await r.close(); }
});

test('history records who approved an accepted proposal', async () => {
  const r = await rig(['Card'], { napkinJson: { agents: { bot: 'propose', you: 'write' } } });
  try {
    const p = await r.edit('bot', 'Card', WEIGHT(600));
    assert.equal(p.proposed, true, JSON.stringify(p));
    const ok = await r.call('you', 'POST', `/api/proposals/${p.proposal.id}/accept`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok));
    const top = (await r.history('Card'))[0];
    assert.equal(top.by, 'bot'); assert.equal(top.approvedBy, 'you');
    const act = (await r.call(null, 'GET', '/api/activity')).activity[0];
    assert.equal(act.by, 'bot'); assert.equal(act.approvedBy, 'you');
    // approving is not authoring: "you" cannot undo it; the agent can
    assert.equal((await r.call('you', 'POST', '/api/undo', {})).status, 409);
  } finally { await r.close(); }
});
