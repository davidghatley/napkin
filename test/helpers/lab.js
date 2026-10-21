// A small lab for the layout lane's browser tests: a temp components folder with hand-written fixtures, a server, a 1440x900 Chromium.
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer, sleep } from './harness.js';
import { launchChromium } from './cdp.js';
import { input } from './input.js';

// tsx fixture: nodes = [{ id, tag, style, text?, kids? }] in JSX order; props none.
export function tsx(name, root) {
  const nodes = [];
  const walk = (n) => { nodes.push(n); (n.kids || []).forEach(walk); };
  walk(root);
  const lit = (v) => (typeof v === 'number' ? String(v) : `'${v}'`);
  const base = nodes.map((n) => `  ${n.id}: {\n${Object.entries(n.style || {}).map(([k, v]) => `    ${k}: ${lit(v)},`).join('\n')}\n  },`).join('\n');
  const jsx = (n, pad) => {
    const open = `<${n.tag} data-n="${n.id}" style={s('${n.id}', v)}`;
    if (n.kids?.length) return `${pad}${open}>\n${n.kids.map((k) => jsx(k, pad + '  ')).join('\n')}\n${pad}</${n.tag}>`;
    if (n.text !== undefined) return `${pad}${open}>${n.text}</${n.tag}>`;
    return `${pad}${open} />`;
  };
  return `import type { CSSProperties } from 'react';

export interface ${name}Props {
}

const base: Record<string, CSSProperties> = {
${base}
};

const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function ${name}({}: ${name}Props) {
  const v = {};
  return (
${jsx(root, '    ')}
  );
}
`;
}

export async function lab(files, { width = 1440, height = 900, theme } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-lab-'));
  const compDir = join(dir, 'components');
  mkdirSync(compDir);
  for (const [name, src] of Object.entries(files)) writeFileSync(join(compDir, `${name}.tsx`), src);
  const server = await startServer(compDir);
  const browser = await launchChromium({ width, height });
  const io = input(browser);
  await browser.goto(server.url);
  await browser.waitFor('document.body.dataset.ready === "1"');
  if (theme) await browser.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
  const q = (e) => browser.eval(e);
  const api = {
    dir, compDir, server, browser, io, q,
    id: (name) => q(`napkin.find(${JSON.stringify(name)}).component`),
    rev: (name) => q(`napkin.find(${JSON.stringify(name)}).revision`),
    doc: (name) => q(`JSON.stringify(napkin.find(${JSON.stringify(name)}).doc)`).then(JSON.parse),
    select: async (name, node, variant = {}) => { await q(`napkin.select({ component: napkin.find(${JSON.stringify(name)}).component, node: ${JSON.stringify(node)}, variant: ${JSON.stringify(variant)} })`); await sleep(120); },
    // send edits through the page (identity "you"), and wait until the canvas has drawn that revision
    edit: async (name, edits) => {
      const r = JSON.parse(await q(`napkin.sendEdits(napkin.find(${JSON.stringify(name)}).component, ${JSON.stringify(edits)}).then(JSON.stringify)`));
      if (!r.ok) throw new Error(r.error);
      await browser.waitFor(`document.querySelector('section[data-name=${JSON.stringify(name)}]').dataset.revision === ${JSON.stringify(String(r.revision))}`);
      await sleep(80);
      return r;
    },
    // the layout size of a node in the first cell (component px)
    size: (name, node) => q(`(() => { const e = document.querySelector('section[data-name=${JSON.stringify(name)}] .cell .mount [data-n=${JSON.stringify(node)}]'); return JSON.stringify({ w: e.offsetWidth, h: e.offsetHeight }); })()`).then(JSON.parse),
    click: async (sel) => { await q(`document.querySelector(${JSON.stringify(sel)}).click()`); },
    close: async () => { await browser.close(); await server.stop(); },
  };
  return api;
}
