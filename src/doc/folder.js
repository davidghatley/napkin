// The document engine (decision 0014): one folder, opened as it is.
//   openFolder(root, { stateDir }) -> engine
// It finds the folder's components (one .html file = one component; every exported component of a .tsx/.jsx file),
// maps each file's elements and CSS rules to their bytes (html.js, css.js, jsx.js), renders a component as its own
// document (view.js), and applies edits through one path (edit.js) as minimal splices, with revisions, undo/redo per
// component and caller, and a watcher. The only state it keeps is outside the folder: the "ask once" stylesheets, in
// napkin's state dir under a hash of the folder's real path. The folder only ever changes by an edit someone made.
import { readFileSync, readdirSync, statSync, lstatSync, existsSync, realpathSync, watch, mkdirSync } from 'node:fs';
import { join, relative, resolve, dirname, extname, basename, sep, posix } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { L, toL, fromL, lineOf, applySplices, mapPos } from './source.js';
import { parseHtml, byId as htmlNode, attrOf } from './html.js';
import { parseCss, varUses, stripCommentsKeep, specificity, splitList } from './css.js';
import { parseJsx, componentTree } from './jsx.js';
import { planNodeEdit, planInsert, planMove, planRule, planVar, EditRefused, styleDecls, mediaOf, runsOf, decodeText } from './edit.js';
import { writeAtomic } from '../atomic.js';
import { explainError } from '../errors.js';

const KINDS = { '.html': 'html', '.htm': 'html', '.tsx': 'tsx', '.jsx': 'jsx', '.css': 'css' };
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'bower_components', 'vendor', 'target']);
const HISTORY = 200;          // undo steps kept per component
const REVS = 20;              // past texts kept per file (stale edits are re-based onto the current text)
export const stateRoot = () => process.env.NAPKIN_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'napkin');
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const posixRel = (p) => p.split(sep).join('/');
// Component name of an HTML file: its folder for index/preview/demo files ("components/Pill/preview.html" -> "Pill").
// A TSX/JSX file that does not parse still gets one component, named after the file ("game-view.tsx" -> "GameView"),
// so its frame can say why it does not build instead of disappearing.
const fileComponentName = (path) => basename(path).replace(/\.[jt]sx$/i, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Component';
const htmlName = (path) => { const b = basename(path).replace(/\.html?$/i, ''); return /^(index|preview|demo|example|component)$/i.test(b) && dirname(path) !== '.' ? basename(dirname(path)) : b; };

export class DocError extends Error { constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }

export function openFolder(rootIn, { stateDir = stateRoot() } = {}) {
  const root = resolve(rootIn);
  const real = (() => { try { return realpathSync(root); } catch { return root; } })();
  const state = join(stateDir, createHash('sha256').update(real).digest('hex').slice(0, 24));
  const events = new EventEmitter();
  const cache = new Map();        // path -> { buf, s, rev, mtimeMs, size, ino, html?, jsx?, css? }
  const past = new Map();         // path -> Map(rev -> s)   a few recent texts, for stale edits
  let list = null;                // [{ path, kind }]
  const dirs = new Set();
  let applied = [], answered = false;
  try { const j = JSON.parse(readFileSync(join(state, 'styles.json'), 'utf8')); applied = j.applied || []; answered = true; } catch { /* never answered */ }
  let layout = {};  // component -> { x, y }: where its frame sits on the canvas (state dir, never the folder)
  try { layout = JSON.parse(readFileSync(join(state, 'layout.json'), 'utf8')).frames || {}; } catch { /* nothing moved yet */ }
  const undo = new Map(), redo = new Map(); // component -> [step]
  const history = new Map();      // component -> [{ revision, by, at, summary }]

  // ---------- files ----------
  const abs = (path) => {
    const p = resolve(root, path);
    if (p !== root && !p.startsWith(root + sep)) throw new DocError(`${path} is outside the folder. Next: use a path inside the folder napkin opened`, 400);
    return p;
  };
  function scan() {
    const out = []; dirs.clear();
    const walk = (d, depth) => {
      dirs.add(d);
      let names; try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
      names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of names) {
        if (e.name.startsWith('.')) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && depth < 12) walk(p, depth + 1); continue; }
        if (e.isSymbolicLink()) { try { if (!statSync(p).isFile()) continue; } catch { continue; } }
        else if (!e.isFile()) continue;
        const kind = KINDS[extname(e.name).toLowerCase()];
        if (kind && !/\.d\.tsx?$/.test(e.name)) out.push({ path: posixRel(relative(root, p)), kind });
      }
    };
    walk(root, 0);
    list = out;
    return out;
  }
  function read(path) {
    const p = abs(path);
    let st; try { st = statSync(p); } catch { cache.delete(path); throw new DocError(`no file ${path}. Next: check the path against GET /api/files`, 404); }
    const c = cache.get(path);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size && c.ino === st.ino) return c;
    const buf = readFileSync(p);
    if (c && c.buf.equals(buf)) { Object.assign(c, { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino }); return c; }
    return remember(path, buf, st);
  }
  function remember(path, buf, st) {
    const entry = { buf, s: L(buf), rev: hash(buf), mtimeMs: st?.mtimeMs, size: st?.size, ino: st?.ino };
    cache.set(path, entry);
    if (past.has(path)) keep(path, entry);
    return entry;
  }
  // Past texts are kept only for files whose node ids napkin has handed out (tree()), so an edit made against one of
  // those revisions can be re-based; a file nobody reads through the engine costs no history.
  const keep = (path, entry) => { if (!past.has(path)) past.set(path, new Map()); const m = past.get(path); m.set(entry.rev, entry.s); while (m.size > REVS) m.delete(m.keys().next().value); };
  const html = (path) => { const c = read(path); return (c.html ||= parseHtml(c.s)), c; };
  const jsx = (path) => { const c = read(path); return (c.jsx ||= parseJsx(c.s, extname(path))), c; };
  const css = (path) => { const c = read(path); return (c.css ||= parseCss(c.s)), c; };
  const kindOf = (path) => KINDS[extname(path).toLowerCase()];

  // ---------- components ----------
  // { kinds }: only files of those kinds (the canvas asks for html and css, so a big TSX folder is not parsed for it).
  function filesList({ kinds } = {}) {
    if (!list) scan();
    return list.filter((f) => !kinds || kinds.includes(f.kind)).map(({ path, kind }) => {
      const revision = (() => { try { return read(path).rev; } catch { return null; } })();
      if (kind === 'html') return { path, kind, revision, components: [{ id: path, name: htmlName(path) }] };
      if (kind === 'css') return { path, kind, revision, components: [] };
      let comps = [];
      try { const c = jsx(path); comps = c.jsx.error ? [{ id: `${path}#${fileComponentName(path)}`, name: fileComponentName(path), broken: true }] : c.jsx.components.map((x) => ({ id: `${path}#${x.name}`, name: x.name })); } catch { /* unreadable: listed with none */ }
      return { path, kind, revision, components: comps, ...(cache.get(path)?.jsx?.error && { error: explainError(cache.get(path).jsx.error, { file: path }) }) };
    });
  }
  function component(id) {
    if (typeof id !== 'string' || !id) throw new DocError('no component named. Next: send a component id from GET /api/files', 400);
    const [path, name] = id.includes('#') ? [id.slice(0, id.lastIndexOf('#')), id.slice(id.lastIndexOf('#') + 1)] : [id, null];
    const kind = kindOf(path);
    if (!kind || kind === 'css') throw new DocError(`no component ${id}. Next: use a component id from GET /api/files`, 404);
    try { abs(path); } catch { throw new DocError(`no component ${id}. Next: use a component id from GET /api/files`, 404); }
    if (!existsSync(abs(path))) throw new DocError(`no component ${id}: ${path} does not exist. Next: use a component id from GET /api/files`, 404);
    if (kind === 'html') { if (name) throw new DocError(`no component ${id}: one .html file is one component (${path}). Next: use the id ${path}`, 404); return { id, path, kind, name: htmlName(path) }; }
    const c = jsx(path);
    if (c.jsx.error && (!name || name === fileComponentName(path))) return { id: `${path}#${fileComponentName(path)}`, path, kind, name: fileComponentName(path), broken: c.jsx.error };
    const comp = name ? c.jsx.components.find((x) => x.name === name) : c.jsx.components[0];
    if (!comp) throw new DocError(`no component ${id}${c.jsx.error ? ` (${c.jsx.error})` : ''}. Next: use a component id from GET /api/files`, 404);
    return { id: `${path}#${comp.name}`, path, kind, name: comp.name, exportName: comp.exportName, isDefault: comp.isDefault };
  }
  const has = (id) => { try { component(id); return true; } catch { return false; } };
  // The nodes of a component in its file's current text: { nodes (flat), roots, find(id), entry }.
  function nodesOf(comp, entry = null) {
    if (comp.kind === 'html') {
      const e = entry || html(comp.path);
      const doc = e.html || (e.html = parseHtml(e.s));
      return { entry: e, roots: doc.root.children, flat: doc.nodes, find: (nid) => htmlNode(doc, nid), doc };
    }
    const e = entry || jsx(comp.path);
    const parsed = e.jsx || (e.jsx = parseJsx(e.s, extname(comp.path)));
    if (parsed.error) throw new DocError(`${comp.path}: ${parsed.error}. Next: fix the syntax error, then save; napkin reads it again`, 422);
    const decl = parsed.components.find((x) => x.name === comp.name);
    const t = componentTree(parsed, decl);
    return { entry: e, roots: t.roots, flat: t.flat, find: (nid) => t.flat.find((x) => x.id === String(nid)) || null };
  }
  const attrMap = (s, n) => Object.fromEntries(n.attrs.filter((a) => !a.spread).map((a) => [fromL(a.name), a.valStart === null ? '' : a.quote || !n.jsx ? fromL(a.value) : `{${fromL(a.value.slice(1, -1))}}`]));
  function tree(id) {
    const comp = component(id);
    if (comp.broken) return { component: comp.id, file: comp.path, kind: comp.kind, name: comp.name, revision: read(comp.path).rev, tree: [], error: explainError(`${comp.path}: ${comp.broken}`, { next: 'fix the syntax error, then save; napkin reads it again.' }) };
    const { entry, roots } = nodesOf(comp);
    keep(comp.path, entry);
    const s = entry.s;
    const out = (n) => ({
      node: n.id, tag: n.tag, start: n.start, end: n.end, openEnd: n.openEnd, closeStart: n.closeStart, line: lineOf(s, n.start),
      attrs: attrMap(s, n), ...(n.implicitEnd && { implicitEnd: true }), ...(n.jsx ? { textOnly: n.textOnly } : {}),
      ...((n.jsx ? n.textOnly : !n.children.length) && n.closeStart > n.openEnd && !['script', 'style'].includes(n.name) && { text: decodeText(fromL(s.slice(n.openEnd, n.closeStart))).trim().slice(0, 2000) }),
      // mixed content (text between child elements, or {"..."} / {expr} in JSX): each run of text, editable by index (op text, run)
      ...(!(n.jsx ? n.textOnly : !n.children.length) && (() => { const r = runsOf(s, n); return r.length ? { runs: r.map((x) => ({ index: x.index, text: n.jsx && x.kind !== 'text' ? fromL(x.text) : decodeText(fromL(x.text)), editable: x.editable, ...(x.kind !== 'text' && { kind: x.kind }) })) } : {}; })()),
      children: n.children.map(out),
    });
    return { component: comp.id, file: comp.path, kind: comp.kind, name: comp.name, revision: entry.rev, tree: roots.map(out) };
  }

  // ---------- the cascade of an HTML component ----------
  // Stylesheets in cascade order: the applied ones first (contract ruling 3), then the document's <link>s and <style>s in
  // source order, each preceded by what it @imports. { file, from, to, origin, media, href?, external? }
  function sheetsOf(comp) {
    const out = [], seen = new Set();
    const addFile = (path, origin, media, viaNode) => {
      if (seen.has(path)) return; seen.add(path);
      let c; try { c = css(path); } catch { out.push({ file: path, origin, missing: true, media }); return; }
      for (const im of c.css.imports) addUrl(im.url, path, 'import', im.media || null);
      out.push({ file: path, from: 0, to: c.s.length, origin, media, node: viaNode });
    };
    const addUrl = (href, from, origin, media, viaNode) => {
      if (!href || /^(https?:)?\/\//i.test(href) || /^data:/i.test(href)) { out.push({ href, external: true, origin, media }); return; }
      const clean = href.split(/[?#]/)[0];
      const target = posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(clean)));
      if (target.startsWith('../') || target === '..') { out.push({ href, external: true, origin, media }); return; }
      addFile(target.replace(/^\.\//, ''), origin, media, viaNode);
    };
    for (const p of applied) addFile(p, 'applied', null);
    if (comp.kind !== 'html') return out;
    const { entry } = nodesOf(comp);
    const doc = entry.html;
    for (const n of doc.nodes) {
      if (n.name === 'link') {
        const rel = attrOf(n, 'rel')?.value?.toLowerCase().split(/\s+/) || [];
        if (rel.includes('stylesheet') && !rel.includes('alternate')) addUrl(fromL(attrOf(n, 'href')?.value || ''), comp.path, 'link', attrOf(n, 'media') ? fromL(attrOf(n, 'media').value) : null, n.id);
      } else if (n.name === 'style') {
        const parsed = parseCss(entry.s, n.openEnd, n.closeStart);
        for (const im of parsed.imports) addUrl(im.url, comp.path, 'import', im.media || null);
        out.push({ file: comp.path, from: n.openEnd, to: n.closeStart, origin: 'style', media: attrOf(n, 'media') ? fromL(attrOf(n, 'media').value) : null, node: n.id });
      }
    }
    return out;
  }
  // Every rule of the cascade with where it is (for provenance: which rule, file and line a value comes from).
  function rulesOf(id) {
    const comp = component(id);
    const sheets = sheetsOf(comp);
    const rules = [];
    sheets.forEach((sh, k) => {
      if (sh.external || sh.missing) return;
      const c = read(sh.file);
      const parsed = sh.origin === 'style' ? parseCss(c.s, sh.from, sh.to) : (c.css ||= parseCss(c.s));
      for (const r of parsed.rules) {
        const selector = fromL(r.selector);
        rules.push({
          sheet: k, order: rules.length, file: sh.file, kind: r.kind, selector, line: lineOf(c.s, r.selStart), start: r.selStart, end: r.close + 1,
          // per selector of the list: its specificity [ids, classes, types]; a rule counts with the most specific part that matches
          parts: r.kind === 'style' ? splitList(selector).map((p) => ({ selector: p, specificity: specificity(p) })) : [],
          media: r.context.filter((x) => x.name === 'media').map((x) => fromL(x.prelude)), context: r.context.map((x) => `@${x.name} ${fromL(x.prelude)}`.trim()),
          decls: r.decls.map((d) => ({ prop: fromL(d.prop), value: fromL(d.value), important: d.important, line: lineOf(c.s, d.start), start: d.start, end: d.end, valStart: d.valStart, valEnd: d.valEnd,
            uses: [...new Set(varUses(c.s.slice(d.valStart, d.valEnd)).map((u) => u.name))] })),
        });
      }
    });
    // Variable provenance: every definition of each custom property in the cascade (and in the file's inline styles), with
    // where it is and under which selector and @media. The browser's matching picks the live one for an element.
    const vars = {};
    const def = (name, d) => { (vars[name] ||= []).push(d); };
    for (const r of rules) for (const d of r.decls) if (d.prop.startsWith('--')) def(d.prop, { file: r.file, line: d.line, start: d.start, end: d.end, valStart: d.valStart, valEnd: d.valEnd, value: d.value, selector: r.selector, media: r.media, context: r.context, rule: r.order, important: d.important });
    if (comp.kind === 'html') {
      const { entry } = nodesOf(comp);
      for (const n of entry.html.nodes) {
        const st = attrOf(n, 'style'); if (!st || st.valStart === null) continue;
        for (const d of styleDecls(entry.s, st.valStart, st.valEnd)) if (d.prop.startsWith('--')) def(fromL(d.prop), { file: comp.path, line: lineOf(entry.s, d.start), start: d.start, end: d.end, valStart: d.valStart, valEnd: d.valEnd, value: fromL(entry.s.slice(d.valStart, d.valEnd)), inline: true, node: n.id, media: [], context: [] });
      }
    }
    const used = new Set(rules.flatMap((r) => r.decls.flatMap((d) => d.uses)));
    return {
      component: comp.id, sheets: sheets.map((sh) => ({ file: sh.file ?? null, href: sh.href ?? null, origin: sh.origin, media: sh.media ?? null, external: !!sh.external, missing: !!sh.missing, node: sh.node ?? null })), rules, vars,
      undefinedVars: [...used].filter((n) => !vars[n]).sort(),
      cascade: 'for one element, the matching rules apply in this order: !important last, then higher specificity (of the matching part), then later order; inline style beats rules of the same importance',
    };
  }

  // ---------- "ask once": variables nothing defines ----------
  function varsOf(comp) {
    const used = new Map(), defined = new Set();
    const note = (u, where) => { if (!used.has(u.name)) used.set(u.name, { fallback: true, where }); if (!u.fallback) used.get(u.name).fallback = false; };
    for (const sh of sheetsOf(comp)) {
      if (sh.external || sh.missing) continue;
      const c = read(sh.file);
      const text = c.s.slice(sh.from, sh.to);
      for (const u of varUses(text)) note(u, sh.file);
      for (const m of stripCommentsKeep(text).matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) defined.add(m[1]);
    }
    if (comp.kind === 'html') {
      const { entry } = nodesOf(comp);
      for (const n of entry.html.nodes) {
        const st = attrOf(n, 'style'); if (!st || st.valStart === null) continue;
        for (const d of styleDecls(entry.s, st.valStart, st.valEnd)) if (d.prop.startsWith('--')) defined.add(d.prop);
        for (const u of varUses(entry.s.slice(st.valStart, st.valEnd))) note(u, comp.path);
      }
    }
    return { used, defined };
  }
  // Class names a component's elements use that no rule in its cascade mentions.
  const CLASS_IN_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;
  function unstyledOf(comp) {
    const { entry } = nodesOf(comp);
    const used = new Set();
    for (const n of entry.html.nodes) { const a = attrOf(n, 'class'); if (a?.value) for (const t of fromL(a.value).split(/\s+/)) if (t) used.add(t); }
    if (!used.size) return used;
    for (const sh of sheetsOf(comp)) {
      if (sh.external || sh.missing) continue;
      const c = read(sh.file);
      for (const r of parseCss(c.s, sh.from, sh.to).rules) for (const m of fromL(r.selector).matchAll(CLASS_IN_SELECTOR)) used.delete(m[1]);
    }
    return used;
  }
  function styles() {
    const missing = new Map(), unstyled = new Map(); // name -> count of components
    const comps = filesList({ kinds: ['html'] }).map((f) => ({ id: f.path, path: f.path, kind: 'html' }));
    for (const comp of comps) {
      let v; try { v = varsOf(comp); } catch { continue; }
      for (const [name, u] of v.used) if (!u.fallback && !v.defined.has(name)) missing.set(name, (missing.get(name) || 0) + 1);
      if (v.used.size && [...v.used].some(([name, u]) => !u.fallback && !v.defined.has(name))) for (const k of unstyledOf(comp)) unstyled.set(k, (unstyled.get(k) || 0) + 1);
    }
    // Stylesheets in the folder that define those variables, or style those classes, best first; `pick` is a small set
    // that covers them (variables first, so the cascade reads tokens before the rules that use them).
    const suggest = [];
    if (missing.size) {
      for (const f of filesList({ kinds: ['css'] })) {
        if (applied.includes(f.path)) continue;
        let c; try { c = css(f.path); } catch { continue; }
        const defs = new Set(); for (const m of stripCommentsKeep(c.s).matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) defs.add(m[1]);
        const classes = new Set(); for (const r of c.css.rules) for (const m of fromL(r.selector).matchAll(CLASS_IN_SELECTOR)) classes.add(m[1]);
        const vars = [...missing.keys()].filter((n) => defs.has(n)), styled = [...unstyled.keys()].filter((k) => classes.has(k));
        if (vars.length || styled.length) suggest.push({ path: f.path, defines: vars.length, styles: styled.length, vars, classes: styled });
      }
      suggest.sort((a, b) => (b.defines + b.styles) - (a.defines + a.styles) || a.path.length - b.path.length);
    }
    const pick = [], left = { vars: new Set(missing.keys()), classes: new Set(unstyled.keys()) };
    for (;;) {
      const gain = (x) => x.vars.filter((n) => left.vars.has(n)).length + x.classes.filter((k) => left.classes.has(k)).length;
      const best = suggest.filter((x) => !pick.includes(x)).sort((a, b) => gain(b) - gain(a) || a.path.length - b.path.length)[0];
      if (!best || !gain(best)) break;
      pick.push(best); best.vars.forEach((n) => left.vars.delete(n)); best.classes.forEach((k) => left.classes.delete(k));
    }
    pick.sort((a, b) => (b.defines > b.styles) - (a.defines > a.styles));
    return {
      undefinedVars: [...missing.keys()].sort(), applied: [...applied], answered, components: comps.length,
      missing: [...missing].map(([name, components]) => ({ name, components })), unstyledClasses: unstyled.size,
      suggest: suggest.map(({ path, defines, styles: st }) => ({ path, defines, styles: st })), pick: pick.map((x) => x.path),
    };
  }
  function setStyles(next) {
    if (!Array.isArray(next) || next.some((p) => typeof p !== 'string')) throw new DocError('send { applied: ["tokens.css", ...] }: folder-relative stylesheet paths', 400);
    const clean = [];
    for (const p of next) {
      const rel = posixRel(relative(root, abs(p)));
      if (kindOf(rel) !== 'css') throw new DocError(`${p} is not a .css file. Next: choose stylesheets (.css) from the folder`, 400);
      if (!existsSync(abs(rel))) throw new DocError(`no stylesheet ${p} in the folder. Next: choose a .css path listed by GET /api/files`, 404);
      if (!clean.includes(rel)) clean.push(rel);
    }
    applied = clean; answered = true;
    mkdirSync(state, { recursive: true });
    writeAtomic(join(state, 'styles.json'), JSON.stringify({ folder: real, applied }, null, 2) + '\n');
    events.emit('styles', { applied: [...applied] });
    return { ok: true, applied: [...applied] };
  }

  // Where a frame sits ({ x, y }) and how wide it is drawn ({ width }); either may be sent alone.
  function setLayout(id, { x, y, width } = {}) {
    const comp = component(id);
    const num = (v) => v === undefined || v === null || Number.isFinite(v);
    if (!num(x) || !num(y) || !num(width) || (x === undefined) !== (y === undefined) || (x === undefined && width === undefined)) throw new DocError('send { component, x, y } and/or { width } as numbers. Next: retry with the frame position or width', 400);
    const cur = layout[comp.id] || {};
    layout[comp.id] = { ...cur, ...(x !== undefined && { x: Math.round(x), y: Math.round(y) }), ...(width !== undefined && { width: width === null ? undefined : Math.max(120, Math.min(2400, Math.round(width))) }) };
    mkdirSync(state, { recursive: true });
    writeAtomic(join(state, 'layout.json'), JSON.stringify({ folder: real, frames: layout }) + '\n');
    return { ok: true, component: comp.id, canvas: layout[comp.id] };
  }

  // ---------- edits ----------
  const sheetsIn = (path, s) => (kindOf(path) === 'css' ? [{ from: 0, to: s.length }] : kindOf(path) === 'html' ? parseHtml(s).styles.map((n) => ({ from: n.openEnd, to: n.closeStart })) : []);
  function nodeIn(comp, s, start) {
    const e = { s, rev: null };
    if (comp.kind === 'html') e.html = parseHtml(s); else e.jsx = parseJsx(s, extname(comp.path));
    const { flat } = nodesOf(comp, e);
    return flat.find((n) => n.start === start) || null;
  }
  // Apply a batch: { baseRevision, edits, by } -> { ok, revision, changed } (throws DocError/EditRefused).
  function edit(id, { baseRevision, edits, by = 'unknown', summary } = {}) {
    const comp = component(id);
    if (!Array.isArray(edits) || !edits.length) throw new DocError('send { edits: [...] }', 400);
    const base = read(comp.path);
    const needsNodes = edits.some((e) => e && e.op !== 'rule' && e.op !== 'var');
    // Node ids name nodes of the base revision. A stale base is re-based when napkin still has its text: each node is
    // found again by its place, which must hold the same start tag in the current text.
    let baseText = base.s;
    if (needsNodes && baseRevision !== undefined && baseRevision !== null && baseRevision !== base.rev) {
      const old = past.get(comp.path)?.get(String(baseRevision));
      if (!old) throw new DocError(`stale revision: ${comp.path} is at ${base.rev}, not ${baseRevision}. Read the component again and retry`, 409, { revision: base.rev });
      baseText = old;
    }
    const baseNodes = needsNodes ? nodesOf(comp, comp.kind === 'html' ? { s: baseText, html: parseHtml(baseText) } : { s: baseText, jsx: parseJsx(baseText, extname(comp.path)) }) : null;
    const startOf = (nid, what, k) => {
      if (nid === undefined || nid === null) throw new DocError(`edit #${k}: ${what} is missing. Next: send the node id from GET /api/component`, 400);
      const n = baseNodes.find(String(nid));
      if (!n) throw new DocError(`edit #${k}: no node ${nid} in ${comp.id}. Next: read GET /api/component again and use a current node id`, 404);
      return { start: n.start, head: baseText.slice(n.start, n.openEnd) };
    };
    // Base offsets -> current text: when rebasing, a node must still begin with the same start tag at a unique place.
    const locate = (ref, k) => {
      if (baseText === base.s) return ref.start;
      const hits = []; for (let i = base.s.indexOf(ref.head); i >= 0 && hits.length < 3; i = base.s.indexOf(ref.head, i + 1)) hits.push(i);
      if (hits.length !== 1) throw new DocError(`stale revision: edit #${k}'s node changed or moved since ${baseRevision}. Read the component again and retry`, 409, { revision: base.rev });
      return hits[0];
    };
    const refs = edits.map((e, k) => {
      if (!e || typeof e !== 'object') throw new DocError(`edit #${k} is not an object. Next: send edits as objects like { op: 'text', node, value }`, 400);
      if (e.op === 'rule' || e.op === 'var') return {};
      const r = {};
      if (e.op === 'insert') r.parent = locate(startOf(e.parent, 'parent', k), k);
      else r.node = locate(startOf(e.node, 'node', k), k);
      if (e.op === 'move') r.parent = locate(startOf(e.parent, 'parent', k), k);
      return r;
    });
    const texts = new Map();   // path -> working text
    const done = new Map();    // path -> splices applied so far, in order (for mapping later edits' offsets)
    const textOf = (path) => { if (!texts.has(path)) texts.set(path, read(path).s); return texts.get(path); };
    const map = (path, pos) => { let p = pos; for (const sps of done.get(path) || []) p = mapPos(p, sps); return p; };
    edits.forEach((e, k) => {
      try {
        let path, splices;
        if (e.op === 'rule' || e.op === 'var') {
          if (typeof e.file !== 'string') throw new DocError(`edit #${k}: ${e.op} needs file. Next: send file as a folder-relative path`, 400);
          path = posixRel(relative(root, abs(e.file)));
          if (!['css', 'html'].includes(kindOf(path))) throw new DocError(`edit #${k}: ${e.file} is not a stylesheet or an HTML file. Next: choose a .css or .html file`, 400);
          const s = textOf(path);
          splices = (e.op === 'rule' ? planRule(s, sheetsIn(path, s), e) : planVar(s, sheetsIn(path, s), e)).splices;
        } else {
          path = comp.path;
          const s = textOf(path);
          const find = (start, what) => { const n = nodeIn(comp, s, map(path, start)); if (!n) throw new DocError(`edit #${k}: the ${what} is gone after an earlier edit of this batch. Next: send it as a separate batch`, 409); return n; };
          if (e.op === 'insert') splices = planInsert(s, find(refs[k].parent, 'parent'), e.index ?? 0, e.html ?? e.jsx);
          else if (e.op === 'move') splices = planMove(s, find(refs[k].node, 'node'), find(refs[k].parent, 'parent'), e.index ?? 0);
          else splices = planNodeEdit(s, find(refs[k].node, 'node'), e);
        }
        if (!splices.length) return;
        texts.set(path, applySplices(texts.get(path), splices));
        if (!done.has(path)) done.set(path, []);
        done.get(path).push(splices);
      } catch (err) {
        if (err instanceof EditRefused) throw new DocError(explainError(`edit #${k} (${e.op}): ${err.message}`), err.status, { matches: err.matches });
        if (err instanceof DocError) throw err;
        throw new DocError(explainError(`edit #${k} (${e.op}): ${err.message}`), 400);
      }
    });
    const changed = [...texts].filter(([path, s]) => s !== read(path).s);
    if (!changed.length) return { ok: true, revision: read(comp.path).rev, changed: [], component: comp.id, noop: true };
    const files = changed.map(([path, s]) => ({ path, before: read(path).s, after: s }));
    write(files);
    const step = { by, at: Date.now(), files, edits, summary: summary || summarize(edits) };
    push(undo, comp.id, step); redo.set(comp.id, (redo.get(comp.id) || []).filter((x) => x.by !== by));
    return done2(comp, step, 'edit');
  }
  const summarize = (edits) => edits.map((e) => e.op === 'rule' ? `${e.selector} ${e.prop}` : e.op === 'var' ? `${e.name}` : `${e.op}${e.name ? ' ' + e.name : e.prop ? ' ' + e.prop : ''}`).join(', ');
  const push = (m, id, step) => { if (!m.has(id)) m.set(id, []); const a = m.get(id); a.push(step); if (a.length > HISTORY) a.shift(); };
  function done2(comp, step, kind) {
    const revision = read(comp.path).rev;
    push(history, comp.id, { revision, by: step.by, at: Date.now(), summary: (kind === 'edit' ? '' : kind + ': ') + step.summary, files: step.files.map((f) => f.path) });
    // 'commit' carries the bytes before and after (the film strip, src/doc/history.js, keeps them outside the folder)
    for (const f of step.files) events.emit('commit', { path: f.path, before: Buffer.from(f.before, 'latin1'), after: Buffer.from(f.after, 'latin1'), by: step.by, kind, summary: step.summary, at: Date.now(), component: comp.id });
    for (const f of step.files) events.emit('change', { path: f.path, revision: read(f.path).rev, by: step.by, component: comp.id, kind, summary: step.summary });
    return { ok: true, revision, changed: step.files.map((f) => f.path), component: comp.id };
  }
  // Write each file, checking first that nobody changed it since we read it (then nothing is written).
  function write(files) {
    for (const f of files) { const now = readFileSync(abs(f.path)); if (L(now) !== f.before) throw new DocError(`${f.path} changed on disk while napkin was writing; read it again and retry`, 409); }
    for (const f of files) {
      writeAtomic(abs(f.path), Buffer.from(f.after, 'latin1'));
      let st = null; try { st = statSync(abs(f.path)); } catch { /* raced */ }
      remember(f.path, Buffer.from(f.after, 'latin1'), st);
    }
  }
  // Swap a step's text back (undo) or forward (redo). A file changed since (by someone else) is re-based when the
  // changed span can still be found exactly once; otherwise nothing is written.
  function swap(step, from, to) {
    const out = [];
    for (const f of step.files) {
      const now = read(f.path).s, a = f[from], b = f[to];
      if (now === a) { out.push({ path: f.path, before: now, after: b }); continue; }
      let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
      let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
      // the changed span with as much unchanged text around it as still identifies one place in the current file
      let i = -1, ctxA = '', ctxB = '';
      for (const c of [40, 16, 4]) {
        ctxA = a.slice(Math.max(0, p - c), a.length - q + c); ctxB = b.slice(Math.max(0, p - c), b.length - q + c);
        const at = now.indexOf(ctxA);
        if (at >= 0 && now.indexOf(ctxA, at + 1) < 0) { i = at; break; }
      }
      if (i < 0) throw new DocError(`${f.path} changed since that edit, around it; napkin will not overwrite those changes. Next: edit the value directly instead`, 409);
      out.push({ path: f.path, before: now, after: now.slice(0, i) + ctxB + now.slice(i + ctxA.length) });
    }
    return out;
  }
  function step(id, by, kind) {
    const comp = component(id);
    const [fromStack, toStack, a, b] = kind === 'undo' ? [undo, redo, 'after', 'before'] : [redo, undo, 'before', 'after'];
    const stack = fromStack.get(comp.id) || [];
    let k = stack.length - 1; while (k >= 0 && stack[k].by !== by) k--;
    if (k < 0) throw new DocError(`nothing of yours to ${kind} in ${comp.id}. Next: check GET /api/component/<id>/history for who made the edits`, 409);
    const st = stack[k];
    const files = swap(st, a, b);
    write(files);
    stack.splice(k, 1);
    push(toStack, comp.id, { ...st, files: files.map((f) => ({ path: f.path, before: kind === 'undo' ? f.after : f.before, after: kind === 'undo' ? f.before : f.after })) });
    return done2(comp, st, kind);
  }

  // Put files back to the bytes of an earlier version (the film strip's Restore): one step across all of them, so one undo.
  // files: [{ path, bytes }]
  function restore(id, { files: want, by = 'unknown', summary = 'restored an earlier version' } = {}) {
    const comp = component(id);
    if (!Array.isArray(want) || !want.length || want.some((f) => !Buffer.isBuffer(f.bytes) || typeof f.path !== 'string')) throw new DocError('restore needs the earlier version as files. Next: send the version from the strip', 400);
    const files = want.map((f) => ({ path: f.path, before: read(f.path).s, after: L(f.bytes) })).filter((f) => f.before !== f.after);
    if (!files.length) return { ok: true, revision: read(comp.path).rev, changed: [], component: comp.id, noop: true };
    write(files);
    const step = { by, at: Date.now(), files, edits: [{ op: 'restore' }], summary };
    push(undo, comp.id, step); redo.set(comp.id, (redo.get(comp.id) || []).filter((x) => x.by !== by));
    return done2(comp, step, 'edit');
  }

  // ---------- watcher ----------
  const watchers = new Map();
  let timer = null; const pending = new Set();
  function watchDirs() {
    for (const d of dirs) {
      if (watchers.has(d)) continue;
      try { const w = watch(d, { persistent: false }, (ev, name) => { pending.add(name ? join(d, name.toString()) : d); clearTimeout(timer); timer = setTimeout(flush, 40); }); w.on('error', () => {}); watchers.set(d, w); } catch { /* gone */ }
    }
    for (const [d, w] of watchers) if (!dirs.has(d)) { w.close(); watchers.delete(d); }
  }
  function flush() {
    const paths = [...pending]; pending.clear();
    let structural = false;
    for (const p of paths) {
      const rel = posixRel(relative(root, p));
      if (rel.startsWith('..') || rel.split('/').some((x) => x.startsWith('.'))) continue;
      const known = list?.some((x) => x.path === rel);
      let isFile = false, isDir = false; try { const st = statSync(p); isFile = st.isFile(); isDir = st.isDirectory(); } catch { /* removed */ }
      if (isDir || (!isFile && !known && !kindOf(rel))) { structural = true; continue; }
      if (!kindOf(rel)) continue;
      if (isFile !== !!known) { structural = true; if (!isFile) cache.delete(rel); continue; }
      if (!isFile) continue;
      const before = cache.get(rel)?.rev;
      let now; try { now = read(rel).rev; } catch { continue; }
      if (before !== now) events.emit('change', { path: rel, revision: now, by: 'file', kind: 'file' });
    }
    if (structural) { const old = new Set((list || []).map((x) => x.path)); scan(); watchDirs(); const cur = new Set(list.map((x) => x.path)); if ([...cur].some((x) => !old.has(x)) || [...old].some((x) => !cur.has(x))) events.emit('files', {}); }
  }

  // ---------- views ----------
  // Components whose rendering depends on `path`: the file's own, or (a stylesheet) the HTML components whose cascade
  // includes it. A TSX file is parsed alone; nothing else is read.
  const componentsUsing = (path) => {
    const kind = kindOf(path);
    if (kind === 'html') return [path];
    if (kind === 'tsx' || kind === 'jsx') { try { return jsx(path).jsx.components.map((x) => `${path}#${x.name}`); } catch { return []; } }
    if (kind !== 'css') return [];
    const out = [];
    for (const f of filesList({ kinds: ['html'] })) { try { if (sheetsOf({ id: f.path, path: f.path, kind: 'html' }).some((sh) => sh.file === path)) out.push(f.path); } catch { /* unreadable */ } }
    return out;
  };

  scan(); watchDirs();
  return {
    root, state, events,
    files: filesList, component, has, tree, rulesOf, sheetsOf, styles, setStyles, edit, restore, layout: () => ({ ...layout }), setLayout,
    latest(verb, by) { // the newest step this caller can undo (or redo) in any component: { component, at } | null
      let best = null;
      for (const [id, st] of verb === 'undo' ? undo : redo) for (const x of st) if (x.by === by && (!best || x.at > best.at)) best = { component: id, at: x.at };
      return best;
    },
    undo: (id, by) => step(id, by, 'undo'), redo: (id, by) => step(id, by, 'redo'),
    history: (id) => [...(history.get(component(id).id) || [])].reverse(),
    read: (path) => read(path), abs, kindOf, applied: () => [...applied], componentsUsing,
    rescan: () => { scan(); watchDirs(); },
    close() { clearTimeout(timer); for (const w of watchers.values()) w.close(); watchers.clear(); },
  };
}
