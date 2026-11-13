// The board: what the person sees and has chosen, and how work is grouped (GET|POST /api/board).
// State lives in the state directory, never in the opened folder (nothing is imposed on a folder that is only looked at).
//   { revision, arrange: { by }, groups: [{ id, name, items, groups?, pinned? }], views: [...],
//     selection: [id], compare: { item, variants }, presentation: boolean, view?: { x, y, z } }
// The canvas reports selection and viewport; agents read it and set groups, arrangement and views.
// `runs` is derived on every read: one section per run, holding the files that run made, so artifacts land in a
// run's section as they are made without anyone writing a group.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeAgentState } from '../commit.js';
import { join } from 'node:path';
import { stateRoot } from '../doc/folder.js';
import { RunError } from './store.js';

const bad = (m, status = 400) => { throw new RunError(m, status); };
const MAX_BYTES = 1024 * 1024;

function checkGroups(groups, depth = 0, seen = new Set()) {
  if (!Array.isArray(groups)) bad('groups must be an array of { id, name, items }. Next: send groups: [{ id, name, items: [item ids] }].');
  if (depth > 6) bad('groups nest at most 6 deep. Next: flatten the groups.');
  return groups.map((g) => {
    if (!g || typeof g !== 'object') bad('each group is { id, name, items }. Next: fix the group.');
    if (typeof g.id !== 'string' || !g.id || g.id.length > 120) bad('every group needs a string id up to 120 characters. Next: give it an id.');
    if (seen.has(g.id)) bad(`group id ${JSON.stringify(g.id)} is used twice. Next: give each group its own id.`);
    seen.add(g.id);
    if (typeof g.name !== 'string' || g.name.length > 300) bad(`group ${g.id} needs a name. Next: send name.`);
    if (!Array.isArray(g.items) || g.items.some((x) => typeof x !== 'string')) bad(`group ${g.id} items must be an array of item ids. Next: send items: ["path/to/file.png"].`);
    const out = { ...g, items: [...new Set(g.items)] };
    if (g.groups !== undefined) out.groups = checkGroups(g.groups, depth + 1, seen);
    return out;
  });
}

export function createBoard({ root, stateDir = stateRoot(), emit = () => {}, broadcast = () => {}, runSections = () => [] }) {
  const dir = join(stateDir, createHash('sha256').update(Buffer.from(root)).digest('hex').slice(0, 20), 'agents');
  const file = join(dir, 'board.json');
  let s = { revision: 0, arrange: { by: 'kind' }, groups: [], views: [], selection: [], compare: { item: null, variants: [] }, presentation: false };
  try { s = { ...s, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* first start */ }
  // What the person sees right now is not worth keeping across a restart.
  s.selection = []; s.view = undefined;
  const save = () => writeAgentState(file, JSON.stringify({ ...s, selection: undefined, view: undefined }));
  const get = () => ({ ...JSON.parse(JSON.stringify(s)), runs: runSections() });

  function set(by, body = {}) {
    if (body.baseRevision !== undefined && body.baseRevision !== s.revision)
      bad(`stale revision: the board is at ${s.revision}, you sent ${body.baseRevision}. Next: get_board again and retry on the new revision.`, 409);
    const next = { ...s }, changed = [];
    if (body.arrange !== undefined) {
      if (!body.arrange || typeof body.arrange.by !== 'string' || !body.arrange.by || body.arrange.by.length > 80) bad('arrange must be { by: "kind" | "folder" | "date" | "similarity" | "tag" | "status" | "run" | "meta.<column>" }. Next: send arrange.by.');
      next.arrange = { ...body.arrange }; changed.push('arrange');
    }
    if (body.groups !== undefined) { next.groups = checkGroups(body.groups); changed.push('groups'); }
    if (body.views !== undefined) {
      if (!Array.isArray(body.views) || body.views.length > 200) bad('views must be an array of up to 200 saved views. Next: send views: [].');
      next.views = body.views; changed.push('views');
    }
    if (body.selection !== undefined) {
      if (!Array.isArray(body.selection) || body.selection.length > 2000 || body.selection.some((x) => typeof x !== 'string')) bad('selection must be an array of item ids. Next: send selection: ["id"].');
      next.selection = body.selection; changed.push('selection');
    }
    if (body.compare !== undefined) {
      const c = body.compare;
      if (!c || typeof c !== 'object' || (c.item !== null && typeof c.item !== 'string') || (c.variants !== undefined && !Array.isArray(c.variants))) bad('compare must be { item, variants: [] }. Next: fix compare.');
      next.compare = { item: c.item ?? null, variants: c.variants ?? [] }; changed.push('compare');
    }
    if (body.presentation !== undefined) { next.presentation = !!body.presentation; changed.push('presentation'); }
    if (body.view !== undefined) {
      const v = body.view;
      if (!v || ![v.x, v.y, v.z].every(Number.isFinite)) bad('view must be { x, y, z } numbers. Next: fix view.');
      next.view = { x: v.x, y: v.y, z: v.z }; changed.push('view');
    }
    if (!changed.length) bad('send at least one of arrange, groups, views, selection, compare, presentation. Next: add a field.');
    if (JSON.stringify(next).length > MAX_BYTES) bad('the board is over 1 MiB. Next: send fewer groups or views.', 413);
    // The person's own state (selection, view, compare, presentation) is shown live but not written to the audit log.
    const persisted = changed.some((k) => ['arrange', 'groups', 'views'].includes(k));
    if (persisted) next.revision = s.revision + 1;
    s = next;
    if (persisted) { save(); emit('board-set', { by, fields: changed, revision: s.revision }); }
    broadcast({ type: 'board', revision: s.revision, by, fields: changed, ...(changed.includes('selection') ? { selection: s.selection } : {}), ...(persisted ? { arrange: s.arrange, groups: s.groups } : {}) });
    return { ok: true, revision: s.revision };
  }
  return { get, set };
}
