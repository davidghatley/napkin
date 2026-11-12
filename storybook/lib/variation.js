// How a variation story is made (full guide: storybook/VARIATIONS.md).
//   export const V01 = { name: 'Variation 01 · Quiet origin chips', render: variation({ item: 'C23', state: 1, css: `...` }) };
// It renders the CURRENT fixture of that item/state on the left and the variation on the right, in the same document,
// the same real stylesheets, the same theme (toolbar). The variation may add CSS (use the --nk-* tokens), may rewrite
// the captured HTML, or both. Nothing here touches the product.
import { fixtureHtml, findMeta, keyOf, mountHtml } from './mount.js';

const LABEL = 'font:600 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;opacity:.65;margin:0 0 8px;';
export function variation({ item, state = 1, css = '', html }) {
  const key = keyOf(item, state);
  // the story's name must be written out in the story file (Storybook reads it without running the code)
  return (args, ctx) => {
      const name = ctx?.name || 'Variation';
      const theme = ctx?.globals?.theme || 'light';
      const meta = findMeta(key);
      const root = document.createElement('div');
      root.dataset.variation = key;
      root.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:20px;padding:16px;align-items:start;';
      const col = (title) => { const c = document.createElement('section'); const l = document.createElement('p'); l.style.cssText = LABEL + `color:${theme === 'dark' ? '#b4bac7' : '#4f5663'};opacity:1;`; l.textContent = title; c.append(l); root.append(c); return c; };
      const left = col('Current'), right = col(name);
      fixtureHtml(key).then((cur) => {
        left.append(mountHtml(cur, meta, theme, { name: `${key} current` }));
        const next = typeof html === 'function' ? html(cur) : html ?? cur;
        right.append(mountHtml(next, meta, theme, { name: `${key} variation`, css }));
      });
      return root;
  };
}
