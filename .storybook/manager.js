// The Feedback panel (keep / change / drop + a note, per story) and a reviewed tick in the sidebar.
// Saves through the dev server's /__feedback endpoint to storybook/feedback/feedback.json.
import React from 'react';
import { addons, types, useStorybookState } from 'storybook/manager-api';
import { AddonPanel } from 'storybook/internal/components';

const h = React.createElement;
const store = { data: {}, loaded: false, error: '', subs: new Set() };
const emit = () => store.subs.forEach((f) => f());
async function load() {
  try { const r = await fetch('/__feedback'); store.data = await r.json(); store.error = ''; } catch { store.error = 'Feedback saves only while `npm run storybook` is running.'; }
  store.loaded = true; emit();
}
async function save(id, note, decision) {
  const r = await fetch('/__feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, note, decision }) });
  const j = await r.json(); if (!j.ok) throw new Error(j.error || 'not saved');
  store.data = j.all; emit(); return j.saved;
}
function useStore() { const [, n] = React.useState(0); React.useEffect(() => { const f = () => n((x) => x + 1); store.subs.add(f); if (!store.loaded) load(); return () => store.subs.delete(f); }, []); return store; }
const reviewed = (id) => !!store.data[id] && (store.data[id].decision || store.data[id].note);

const COLORS = { keep: '#1d7a4f', change: '#a8480b', drop: '#c0262c' };
function Feedback() {
  const st = useStore();
  const { storyId } = useStorybookState();
  const saved = st.data[storyId];
  const [note, setNote] = React.useState(''), [decision, setDecision] = React.useState(''), [msg, setMsg] = React.useState('');
  React.useEffect(() => { setNote(saved?.note || ''); setDecision(saved?.decision || ''); setMsg(''); }, [storyId, st.loaded, saved?.at]);
  const doSave = async (n, d) => { try { const s = await save(storyId, n, d); setMsg('Saved ' + new Date(s.at).toLocaleTimeString()); } catch (e) { setMsg('Not saved: ' + e.message); } };
  if (!storyId) return h('div', { style: { padding: 12 } }, 'Pick a story.');
  return h('div', { style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720, font: '13px system-ui, sans-serif' }, 'data-testid': 'feedback-panel' },
    h('div', { style: { opacity: .7, fontSize: 12 } }, 'Feedback for ', h('code', null, storyId)),
    h('div', { role: 'group', 'aria-label': 'Decision', style: { display: 'flex', gap: 8 } },
      ['keep', 'change', 'drop'].map((d) => h('button', { key: d, type: 'button', 'data-decision': d, 'aria-pressed': decision === d, onClick: () => { const nd = decision === d ? '' : d; setDecision(nd); doSave(note, nd); },
        style: { padding: '6px 14px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + COLORS[d], background: decision === d ? COLORS[d] : 'transparent', color: decision === d ? '#fff' : COLORS[d], fontWeight: 600 } }, d))),
    h('textarea', { 'aria-label': 'Notes', placeholder: 'What should change, and why?', value: note, rows: 5, onChange: (e) => setNote(e.target.value), style: { width: '100%', font: 'inherit', padding: 8, borderRadius: 6, border: '1px solid #8886', boxSizing: 'border-box' } }),
    h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
      h('button', { type: 'button', 'data-save': '1', onClick: () => doSave(note, decision), style: { padding: '6px 14px', borderRadius: 6, cursor: 'pointer' } }, 'Save note'),
      saved && h('button', { type: 'button', 'data-remove': '1', onClick: async () => { await fetch('/__feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: storyId, remove: true }) }); await load(); setMsg('Removed'); }, style: { padding: '6px 14px', borderRadius: 6, cursor: 'pointer' } }, 'Clear'),
      h('span', { 'data-msg': '1', role: 'status', style: { opacity: .75 } }, st.error || msg || (saved ? `Saved ${new Date(saved.at).toLocaleString()}` : 'Not reviewed yet'))));
}

const MARK = { keep: '✓', change: '✎', drop: '✗' };
// A story is reviewed once it has a decision or a note. An item (or level) shows ✓ when every story under it is reviewed, • when some are.
function progress(item, api) {
  if (!item) return [0, 0];
  if (item.type === 'story') return [reviewed(item.id) ? 1 : 0, 1];
  let done = 0, all = 0;
  for (const c of item.children || []) { const [d, n] = progress(api.getData(c), api); done += d; all += n; }
  return [done, all];
}
const makeLabel = (api) => (item) => {
  let tick = '', title = '';
  if (item.type === 'story') { const f = store.data[item.id]; tick = f?.decision ? MARK[f.decision] : f?.note ? '•' : ''; title = f ? 'Reviewed' : ''; }
  else { const [d, n] = progress(item, api); if (n && d) { tick = d === n ? '✓' : `${d}/${n}`; title = `${d} of ${n} reviewed`; } }
  return h('span', { 'data-reviewed': tick ? '1' : '0', title }, item.name, tick ? h('span', { style: { marginLeft: 6, opacity: .85, fontSize: '0.85em' } }, tick) : null);
};

addons.register('napkin/feedback', (api) => {
  addons.setConfig({ selectedPanel: 'napkin/feedback/panel' });
  addons.add('napkin/feedback/panel', { type: types.PANEL, title: 'Feedback', render: ({ active }) => h(AddonPanel, { active }, h(Feedback)) });
  const apply = () => api.setOptions({ sidebar: { renderLabel: makeLabel(api) } });
  store.subs.add(apply);
  load();
});
