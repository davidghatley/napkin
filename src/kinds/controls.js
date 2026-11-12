import { delimited, scalar } from './readers.js';
const control = (id, label, value, target, extra = {}) => ({
  id,
  label,
  value,
  type:
    typeof value === 'boolean'
      ? 'boolean'
      : typeof value === 'number'
        ? 'number'
        : /^#[\da-f]{3,8}$/i.test(String(value))
          ? 'color'
          : 'text',
  depth: 1,
  figure: { type: typeof value === 'number' ? 'meter' : 'value' },
  ...extra,
  target,
});
// JSON token spans retain formatting and duplicate-key semantics; edits replace only one literal.
export function jsonLeaves(text) {
  let at = 0;
  const out = [];
  const ws = () => {
    while (/\s/.test(text[at] || '') && at < text.length) at++;
  };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') {
        at += 2;
        continue;
      }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    throw new Error('Unterminated JSON string');
  };
  function value(path) {
    ws();
    const start = at,
      c = text[at];
    if (c === '{' || c === '[') {
      at++;
      ws();
      let i = 0;
      while (text[at] !== (c === '{' ? '}' : ']')) {
        let k = i++;
        if (c === '{') {
          k = string();
          ws();
          if (text[at++] !== ':') throw new Error('Invalid JSON');
        }
        value([...path, k]);
        ws();
        if (text[at] === ',') {
          at++;
          ws();
        } else break;
      }
      at++;
      return;
    }
    let v;
    if (c === '"') v = string();
    else {
      while (at < text.length && !/[\s,}\]]/.test(text[at])) at++;
      v = JSON.parse(text.slice(start, at));
    }
    out.push({ path, start, end: at, value: v });
  }
  value([]);
  ws();
  if (at !== text.length) throw new Error('Invalid JSON');
  return out;
}
export function nativeControls(ctx) {
  const { kind, text } = ctx;
  const out = [];
  const splice = (id, label, value, start, end, extra = {}) =>
    out.push(control(id, label, value, { mode: 'splice', start, end }, extra));
  if (
    ['json', 'lottie', 'waapi', 'vega-lite', 'chart', 'gltf', 'ipynb', 'comfyui'].includes(kind)
  ) {
    try {
      for (const leaf of jsonLeaves(text).slice(0, 160)) {
        if (leaf.value === null) continue;
        const id = 'json:' + JSON.stringify(leaf.path);
        out.push(
          control(id, leaf.path.join(' › ') || 'Value', leaf.value, { mode: 'json', ...leaf }),
        );
      }
    } catch {
      /* invalid source: recipe controls remain available */
    }
  }
  if (['css', 'css-animation', 'html', 'svg', 'tsx', 'jsx'].includes(kind)) {
    for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;}\n]+)/g)) {
      const start = m.index + m[0].indexOf(m[2], m[0].indexOf(':') + 1);
      splice(`css:${m.index}`, m[1], m[2].trim(), start, start + m[2].trimEnd().length);
    }
  }
  if (kind === 'svg')
    for (const m of text.matchAll(
      /\b(fill|stroke|stroke-width|opacity|width|height|viewBox|rx|ry|r|cx|cy|x|y)\s*=\s*(["'])(.*?)\2/g,
    )) {
      const start = m.index + m[0].indexOf(m[3], m[0].indexOf(m[2]) + 1);
      splice(`attr:${m.index}`, m[1], m[3], start, start + m[3].length, {
        target: { mode: 'attribute', start, end: start + m[3].length },
      });
    }
  if (kind === 'csv' || kind === 'tsv') {
    const delimiter = kind === 'tsv' ? '\t' : ',',
      rows = delimited(text, delimiter, { limit: 9 });
    for (let r = 1; r < Math.min(9, rows.length); r++)
      for (let c = 0; c < Math.min(12, rows[r].length); c++)
        out.push(
          control(
            `cell:${r}:${c}`,
            `${rows[0]?.[c] || `Column ${c + 1}`} · row ${r}`,
            scalar(rows[r][c]) ?? '',
            { mode: 'cell', row: r, column: c, delimiter },
          ),
        );
  }
  if (kind === 'md') {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (front)
      for (const m of front[1].matchAll(/^([\w-]+):\s*([^\n\r]*)/gm)) {
        const start = front.index + front[0].indexOf(front[1]) + m.index + m[0].indexOf(m[2]);
        splice(`front:${m[1]}`, m[1], m[2], start, start + m[2].length);
      }
  }
  if (
    ['txt', 'md', 'code', 'diff', 'yaml', 'toml', 'xml', 'shader', 'html', 'tsx', 'jsx'].includes(
      kind,
    )
  )
    out.push(control('source', 'Source', text, { mode: 'source' }, { type: 'textarea', depth: 2 }));
  return out.slice(0, 160);
}
export function applyNative(ctx, c, value) {
  const t = c.target;
  if (t.mode === 'source') return String(value);
  if (t.mode === 'cell') {
    // Find cell byte spans without normalizing any other row or quote.
    let row = 0,
      col = 0,
      start = 0,
      quote = false,
      end = ctx.text.length;
    for (let i = 0; i <= ctx.text.length; i++) {
      const ch = ctx.text[i];
      if (ch === '"') {
        if (quote && ctx.text[i + 1] === '"') {
          i++;
          continue;
        }
        quote = !quote;
      }
      if (!quote && (ch === t.delimiter || ch === '\n' || ch === '\r' || i === ctx.text.length)) {
        if (row === t.row && col === t.column) {
          end = i;
          break;
        }
        if (ch === t.delimiter) col++;
        else {
          row++;
          col = 0;
          if (ch === '\r' && ctx.text[i + 1] === '\n') i++;
        }
        start = i + 1;
      }
    }
    const s = String(value),
      v = s.includes(t.delimiter) || /["\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
    return ctx.text.slice(0, start) + v + ctx.text.slice(end);
  }
  const encoded =
    t.mode === 'json'
      ? JSON.stringify(value)
      : t.mode === 'attribute'
        ? String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&apos;')
            .replaceAll('<', '&lt;')
        : String(value);
  return ctx.text.slice(0, t.start) + encoded + ctx.text.slice(t.end);
}
export function recipeControls(ctx) {
  const family = ctx.definition.family,
    defaults = {};
  if (family === 'image') Object.assign(defaults, { exposure: 0, contrast: 1, fit: 'contain' });
  else if (family === 'video')
    Object.assign(defaults, { posterTime: 0, playbackRate: 1, muted: true });
  else if (family === 'audio') Object.assign(defaults, { gain: 1, playbackRate: 1 });
  else if (family === 'font')
    Object.assign(defaults, {
      size: 56,
      specimen: 'Sphinx of black quartz, judge my vow.',
      weight: 400,
    });
  else if (family === 'model')
    Object.assign(defaults, { rotation: 0, spin: true, wireframe: false });
  else if (['table', 'parquet', 'sqlite', 'arrow'].includes(family))
    Object.assign(defaults, { rowOffset: 0, pageSize: 80 });
  else if (family === 'binary') Object.assign(defaults, { offset: 0, columns: 16 });
  else if (family === 'pdf') Object.assign(defaults, { page: 1, zoom: 100 });
  else if (family === 'animation') Object.assign(defaults, { speed: 1, paused: false });
  else if (family === 'zip') Object.assign(defaults, { filter: '' });
  else if (family === 'graph') Object.assign(defaults, { scale: 1 });
  else if (family === 'chart') Object.assign(defaults, { color: '#157b6a' });
  else if (family === 'component') Object.assign(defaults, { zoom: 100 });
  else Object.assign(defaults, { fontSize: 14, wrap: true });
  return Object.entries(defaults).map(([key, v]) =>
    control(
      `view:${key}`,
      {
        posterTime: 'Poster time',
        playbackRate: 'Playback speed',
        rowOffset: 'First row',
        pageSize: 'Rows per page',
        fontSize: 'Type size',
      }[key] || key[0].toUpperCase() + key.slice(1),
      ctx.recipe[key] ?? v,
      { mode: 'recipe', key },
      {
        ...{
          exposure: { min: -4, max: 4, step: 0.1, unit: 'EV' },
          contrast: { min: 0, max: 3, step: 0.05 },
          gain: { min: 0, max: 1, step: 0.01 },
          playbackRate: { min: 0.25, max: 4, step: 0.25 },
          posterTime: { min: 0, max: 86400, step: 0.1, unit: 's' },
          size: { min: 8, max: 200, unit: 'px' },
          weight: { min: 100, max: 900, step: 100 },
          rotation: { min: 0, max: 360, unit: '°' },
          rowOffset: { min: 0, max: 1000000000, step: 1 },
          pageSize: { min: 1, max: 120, step: 1 },
          offset: { min: 0, max: Math.max(0, ctx.bytes - 1), step: 16 },
          columns: { min: 8, max: 32, step: 8 },
          page: { min: 1, max: 100000, step: 1 },
          zoom: { min: 25, max: 400, unit: '%' },
          speed: { min: 0.1, max: 4, step: 0.1 },
          scale: { min: 0.25, max: 3, step: 0.1 },
          fontSize: { min: 8, max: 48, unit: 'px' },
        }[key],
        ...(key === 'fit' ? { type: 'select', options: ['contain', 'cover'] } : {}),
        storage: 'recipe',
      },
    ),
  );
}
export function sections(ctx) {
  const native = ctx.bytes <= 1024 * 1024 ? nativeControls(ctx) : [];
  return [
    ...(native.length ? [{ id: 'source', label: 'File values', controls: native }] : []),
    { id: 'view', label: 'Viewer', controls: recipeControls(ctx) },
  ];
}
export function validate(c, value) {
  if (c.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
    throw new Error('Send a finite number');
  if (c.type === 'boolean' && typeof value !== 'boolean') throw new Error('Send true or false');
  if (['text', 'color', 'textarea', 'select'].includes(c.type) && typeof value !== 'string')
    throw new Error('Send text');
  if (typeof value === 'string' && Buffer.byteLength(value) > 1024 * 1024)
    throw new Error('Value exceeds 1 MiB');
  if ((c.min !== undefined && value < c.min) || (c.max !== undefined && value > c.max))
    throw new Error('Value is outside the control range');
  if (c.options && !c.options.includes(value)) throw new Error('Choose one of the listed options');
}
