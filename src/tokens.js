// Token files are read as ranges: a value edit replaces that literal alone, never reserializes JSON.
// Files on disk remain authoritative. The parent watcher survives atomic editor replacements.
import { readFileSync, existsSync, realpathSync, watch } from 'node:fs';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseExpression } from '@babel/parser';
import { writeTokens } from './commit.js';
import { explainError } from './errors.js';
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const cssValue = v => String(v).replace(/\{([\w-]+)\}/g, 'var(--$1)');
const typeOf = (group, name, v) => /color|colour/.test(group + name) || /^(#|rgb|hsl|oklch)/.test(String(v)) ? 'color' : /radius/.test(group + name) ? 'radius' : /font.*size|fontSize/.test(group + name) ? 'fontSize' : /spacing|space|gap|padding|margin/.test(group + name) ? 'spacing' : group;
const error = message => ({ ok: false, error: explainError(message) });
function jsonRanges(text) {
  const ranges = new Map();
  function walk(n, path) {
    if (n.type === 'ObjectExpression') for (const p of n.properties) walk(p.value, [...path, p.key.value ?? p.key.name]);
    else if (n.type === 'ArrayExpression') n.elements.forEach((e, i) => walk(e, [...path, i]));
    else ranges.set(JSON.stringify(path), { start: n.start, end: n.end });
  }
  walk(parseExpression(text), []); return ranges;
}
// CSS block stack retains nested media conditions and arbitrary data-theme modes.
function cssDeclarations(text) {
  const out = [], stack = []; let boundary = 0;
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, ' '));
  const re = /[{}]|--([\w-]+)\s*:\s*([^;{}]+)(?:;|(?=\}))/g; let m;
  while ((m = re.exec(clean))) {
    if (m[0] === '{') { stack.push(clean.slice(boundary, m.index).trim()); boundary = re.lastIndex; }
    else if (m[0] === '}') { stack.pop(); boundary = re.lastIndex; }
    else {
      const selectors = stack.join(' ').replace(/:not\([^)]*\)/g, ''), themes = [...selectors.matchAll(/(?:data-theme|data-mode)\s*=\s*["']?([\w-]+)/g)].map(x => x[1]);
      const mode = themes.at(-1) ?? (/prefers-color-scheme\s*:\s*dark|\.dark\b/.test(selectors) ? 'dark' : 'light');
      const start = m.index + m[0].indexOf(m[2]);
      out.push({ name: m[1], mode, value: m[2].trim(), start, end: start + m[2].trimEnd().length });
      boundary = re.lastIndex;
    }
  }
  return out;
}
export function parseTokens(text, format = 'json') {
  const tokens = [], modes = ['light'], locations = new Map();
  const addMode = mode => { if (!modes.includes(mode)) modes.push(mode); };
  function add(name, value, group, type, usage, path) {
    const raw = value && typeof value === 'object' ? value : null;
    if (raw) Object.keys(raw).forEach(addMode);
    tokens.push({ name, group, type, usage: usage || '', value, values: raw ? { ...raw } : { light: value } });
    locations.set(name, { path, raw: !!raw });
  }
  let ranges;
  if (format === 'css') {
    const decls = cssDeclarations(text);
    for (const d of decls) {
      addMode(d.mode);
      let t = tokens.find(t => t.name === d.name);
      if (!t) { t = { name: d.name, group: typeOf('', d.name, d.value), type: typeOf('', d.name, d.value), usage: '', values: {} }; tokens.push(t); }
      t.values[d.mode] = d.value;
      const loc = locations.get(d.name) || []; loc.push(d); locations.set(d.name, loc);
    }
  } else {
    const data = JSON.parse(text); ranges = jsonRanges(text);
    for (const theme of data.color?.themes || []) addMode(theme.id);
    for (const [group, section] of Object.entries(data)) {
      for (const [i, t] of (section?.tokens || []).entries()) add(t.name, t.value, group, typeOf(group, t.name, t.value?.light ?? t.value), t.usage, [group, 'tokens', i, 'value']);
    }
    for (const [name, value] of Object.entries(data.type?.families || {})) add(`font-${name}`, value, 'type', 'fontFamily', '', ['type', 'families', name]);
    for (const [i, group] of (data.type?.groups || []).entries()) for (const [j, style] of (group.styles || []).entries()) {
      for (const prop of ['fontSize', 'lineHeight', 'fontWeight', 'letterSpacing', 'fontStyle']) if (prop in style) add(`${style.name}-${kebab(prop)}`, style[prop], group.name, prop, style.usage, ['type', 'groups', i, 'styles', j, prop]);
    }
  }
  const names = new Set();
  for (const t of tokens) {
    if (!/^[\w-]+$/.test(t.name) || names.has(t.name)) throw new Error(explainError(`token name ${t.name} is invalid or duplicated. Next: use unique CSS names.`));
    names.add(t.name);
    for (const mode of modes) if (!(mode in t.values)) t.values[mode] = t.values.light ?? Object.values(t.values)[0];
  }
  function resolved(t, mode, seen = new Set()) {
    if (seen.has(t.name)) return '';
    seen.add(t.name);
    return cssValue(t.values[mode]).replace(/var\(--([\w-]+)\)/g, (match, name) => { const ref = tokens.find(x => x.name === name); return ref ? resolved(ref, mode, new Set(seen)) : match; });
  }
  for (const t of tokens) { t.resolved = Object.fromEntries(modes.map(mode => [mode, resolved(t, mode)])); }
  return { tokens, modes, locations, ranges };
}
export function openTokens(dir) {
  const events = new EventEmitter(); let config, root;
  for (const d of [dir, dirname(dir)]) {
    const file = join(d, 'napkin.json');
    if (!existsSync(file)) continue;
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (c.tokens?.source) { config = c.tokens; root = d; break; }
  }
  const source = config && resolve(root, config.source), css = config?.css && resolve(root, config.css);
  const format = source && extname(source) === '.css' ? 'css' : 'json';
  let text = '', parsed = { tokens: [], modes: [] }, revision = hash(''), problem, log = [];
  const publicRead = () => ({ ok: !problem, configured: !!source, source: config?.source, css: config?.css, revision, tokens: parsed.tokens, modes: parsed.modes, ...(problem && { error: explainError(problem) }), history: log.slice().reverse() });
  function reload(by = 'file', announce = true) {
    if (!source) return;
    try {
      const next = readFileSync(source, 'utf8');
      if (next === text && !problem) return;
      const p = parseTokens(next, format);
      text = next; parsed = p; revision = hash(text); problem = undefined;
      if (announce) { const row = { at: Date.now(), kind: 'tokens', by, revision, summary: 'tokens changed on disk' }; log.push(row); events.emit('change', { ...publicRead(), ...row }); }
    } catch (e) { problem = e.message; if (announce) events.emit('change', publicRead()); }
  }
  reload('file', false);
  const watcher = source && existsSync(dirname(source)) ? watch(dirname(source), () => reload()) : null;
  const allowed = file => { const rel = relative(realpathSync(root), realpathSync(file)); return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/'); };
  return {
    events, read() { reload(); return publicRead(); }, history: () => log.slice().reverse(),
    write({ name, mode, value, baseRevision, by }) {
      reload();
      if (!source || problem) return error('token source unavailable. Next: configure a valid tokens.source in napkin.json.');
      if (typeof by !== 'string' || !by.trim() || by.trim().toLowerCase() === 'unknown') return error('by is required: send a real caller name.');
      if (baseRevision !== revision) return { ...error('stale revision: token source changed. Next: read tokens and retry.'), currentRevision: revision };
      const t = parsed.tokens.find(t => t.name === name);
      if (!t || !parsed.modes.includes(mode)) return error('unknown token or mode. Next: choose a listed token and mode.');
      if (!['string', 'number'].includes(typeof value) || !String(value).trim() || /[;{}\n\r<>]/.test(String(value).replace(/\{[\w-]+\}/g, ''))) return error('invalid token value. Next: send one CSS value without declarations or newlines.');
      if (!allowed(source) || css && !allowed(css)) return error('token writes outside the project are refused. Next: use a local token fixture.');
      if (String(t.values[mode]) === String(value)) return { ...publicRead(), noop: true };
      let next = text, replacements;
      if (format === 'json') {
        const loc = parsed.locations.get(name), path = [...loc.path, ...(loc.raw ? [mode] : [])], range = parsed.ranges.get(JSON.stringify(path));
        if (!range) return error('mode has no source value. Next: add it in the token source first.');
        next = text.slice(0, range.start) + JSON.stringify(value) + text.slice(range.end);
      } else {
        replacements = parsed.locations.get(name).filter(d => d.mode === mode);
        if (!replacements.length) return error('mode inherits this token. Next: edit its light value or add an explicit declaration.');
        for (const d of replacements.sort((a, b) => b.start - a.start)) next = next.slice(0, d.start) + value + next.slice(d.end);
      }
      let cssText, warning;
      if (css && css !== source) {
        cssText = readFileSync(css, 'utf8');
        if (/generated|do not edit by hand/i.test(cssText) && !/^\s*\/\* generated by napkin/i.test(cssText)) { warning = 'run your token build to update tokens.css'; cssText = undefined; }
        else {
          const loc = parsed.locations.get(name), shared = format === 'json' && !loc.raw;
          const ds = cssDeclarations(cssText).filter(d => d.name === name && (shared || d.mode === mode));
          if (!ds.length) { warning = 'run your token build to update tokens.css'; cssText = undefined; }
          else for (const d of ds.sort((a, b) => b.start - a.start)) cssText = cssText.slice(0, d.start) + cssValue(value) + cssText.slice(d.end);
        }
      }
      // Validate before either file changes. The source is the durable authority if interrupted between renames.
      parseTokens(next, format);
      writeTokens(source, next, cssText === undefined ? undefined : { file: css, text: cssText });
      reload(by, false);
      const row = { at: Date.now(), kind: 'tokens', by, revision, name, mode, value, summary: `${name} (${mode}) = ${value}` };
      log.push(row); if (log.length > 200) log.shift();
      const result = { ...publicRead(), ...(warning && { warning }) };
      events.emit('change', { ...result, ...row }); return result;
    },
    close() { watcher?.close(); },
  };
}
