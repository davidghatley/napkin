// Puts a captured fixture back on screen. Each fixture is rendered in its own iframe (srcdoc) that loads the app's REAL
// stylesheets from public/canvas, so nothing here restyles the interface. The theme comes from the toolbar.
//   fixture(key, ctx)        a story render for a captured fixture (see storybook/fixtures/manifest.json)
//   mountHtml(html, meta, theme, opts)   lower level: also used by hand-written variation stories (see VARIATIONS.md)
import manifest from '../fixtures/manifest.json';

const loaders = import.meta.glob('../fixtures/*.html', { query: '?raw', import: 'default' });
const SHEETS = ['canvas', 'inspector', 'components', 'history', 'tokens', 'agents', 'polish', 'doc', 'time', 'stage', 'inspector-doc'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const attrStr = (a = {}, skip = []) => Object.entries(a).filter(([k]) => !skip.includes(k)).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
const NEUTRAL = 'position:static;inset:auto;transform:none;width:auto;height:auto;min-height:0;max-height:none;overflow:visible;margin:0;grid-area:auto;display:block;';

export function findMeta(key) {
  for (const it of Object.values(manifest.items)) for (const s of it.states) if (s.key === key) return s;
  throw new Error(`no fixture ${key}`);
}
export function modeOf(meta) { return meta.headStyles ? 'whole' : meta.pos === 'fixed' ? 'overlay' : meta.chain?.length ? 'inline' : 'panel'; }

// The document the fixture lives in: the app's own head (real CSS) + the captured DOM in its ancestors.
export function docFor(html, meta, theme, { css = '' } = {}) {
  const mode = modeOf(meta);
  let body = html, bodyStyle = '', extraCss = '';
  if (mode === 'whole') bodyStyle = '';
  else if (mode === 'panel') { bodyStyle = 'display:grid;grid-template-columns:100%;grid-template-rows:100%;grid-template-areas:none;height:100vh;'; extraCss = 'body>*{grid-area:auto!important}'; }
  else if (mode === 'overlay') { bodyStyle = ''; }
  else {
    bodyStyle = 'display:block;height:auto;overflow:visible;padding:12px;width:max-content;min-width:100%;box-sizing:border-box;';
    extraCss = '.sb-target{position:static!important;inset:auto!important;transform:none!important}';
    const t = document.createElement('template'); t.innerHTML = html; t.content.firstElementChild?.classList.add('sb-target'); body = t.innerHTML;
    meta.chain.forEach((c, i) => {
      const last = i === meta.chain.length - 1;
      const lay = last && c.layout ? `display:${c.layout.display};flex-direction:${c.layout.flexDirection};flex-wrap:${c.layout.flexWrap};gap:${c.layout.gap};align-items:${c.layout.alignItems};justify-content:${c.layout.justifyContent};${c.layout.gridTemplateColumns ? `grid-template-columns:${c.layout.gridTemplateColumns};` : ''}width:${c.w}px;box-sizing:border-box;` : '';
      const pad = last ? '' : 'padding:0;border:0;';
      body = `<${c.tag}${attrStr(c.attrs, ['style'])} style="${NEUTRAL}${pad}${lay}">${body}`;
    });
    body += meta.chain.map((c) => `</${c.tag}>`).reverse().join('');
  }
  const bodyAttrs = { ...(meta.body || {}) }; delete bodyAttrs.style;
  const htmlAttrs = { ...(meta.htmlAttrs || {}), 'data-theme': theme };
  return '<!doctype html><html' + attrStr(htmlAttrs) + '><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">'
    + SHEETS.map((s) => `<link rel="stylesheet" href="/canvas/${s}.css">`).join('')
    + (meta.headStyles || []).map((c) => `<style>${c}</style>`).join('')
    + `<style>html{scrollbar-width:none}${extraCss}</style>` + (css ? `<style data-variation>${css}</style>` : '') + `</head><body${attrStr(bodyAttrs, ['style'])} style="${bodyStyle}">${body}</body></html>`;
}

export function mountHtml(html, meta, theme = 'light', { name = 'fixture', css = '' } = {}) {
  const mode = modeOf(meta);
  const wrap = document.createElement('div');
  wrap.className = 'sb-fixture'; wrap.dataset.ready = '0'; wrap.dataset.mode = mode;
  wrap.style.cssText = 'width:100%;overflow:hidden;position:relative;';
  const fr = document.createElement('iframe');
  fr.title = name; fr.style.cssText = 'border:0;display:block;transform-origin:0 0;background:transparent;';
  const full = mode === 'whole' || mode === 'overlay' || mode === 'panel';
  const W = mode === 'overlay' ? (meta.vw || 1440) : meta.w, H = mode === 'overlay' ? (meta.vh || 900) : meta.h;
  const fit = () => {
    if (!full) return;
    const k = Math.min(1, wrap.clientWidth / W); fr.style.transform = `scale(${k})`; wrap.style.height = `${Math.round(H * k)}px`;
  };
  if (full) { fr.style.width = `${W}px`; fr.style.height = `${H}px`; new ResizeObserver(fit).observe(wrap); }
  else { fr.style.width = `${Math.max(meta.chain?.at(-1)?.w || 0, meta.w) + 24}px`; fr.style.height = '40px'; }
  fr.addEventListener('load', () => {
    if (!full) { const d = fr.contentDocument; fr.style.height = `${d.documentElement.scrollHeight}px`; fr.style.width = `${Math.max(d.body.scrollWidth, parseInt(fr.style.width))}px`; wrap.style.height = fr.style.height; }
    fit(); wrap.dataset.ready = '1';
  });
  fr.srcdoc = docFor(html, meta, theme, { css });
  wrap.append(fr);
  return wrap;
}

// A story's render: loads the fixture's HTML lazily and mounts it in the toolbar's theme.
export async function fixtureHtml(key) { return loaders[`../fixtures/${key}.html`](); }
export const keyOf = (item, state = 1) => `${item}--${String(state).padStart(2, '0')}`;

export function fixture(key, ctx) {
  const meta = findMeta(key);
  const holder = document.createElement('div');
  holder.dataset.fixture = key;
  loaders[`../fixtures/${key}.html`]().then((html) => holder.append(mountHtml(html, meta, ctx?.globals?.theme || 'light', { name: key })));
  return holder;
}
