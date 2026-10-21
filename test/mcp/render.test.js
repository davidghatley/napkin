// AGT-02: render_component returns a PNG of any variant cell; fast; matches the canvas cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempRepo, startServer, startMcp } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { evidence, percentile } from '../helpers/agents.js';

const png = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ok: buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' });
const getPng = async (url, id, variant) => {
  const r = await fetch(new URL(`api/components/${id}/render?variant=${encodeURIComponent(JSON.stringify(variant))}`, url));
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ms: Number(r.headers.get('x-napkin-render-ms')) };
};

test('render_component over MCP returns an image content block for a variant, and errors for bad input', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    const r = await mcp.request('tools/call', { name: 'render_component', arguments: { component: 'Button', variant: { size: 'lg', state: 'hover' } } });
    const img = r.result.content.find((c) => c.type === 'image');
    assert.equal(img.mimeType, 'image/png');
    const buf = Buffer.from(img.data, 'base64');
    const dim = png(buf);
    assert.ok(dim.ok && dim.w > 40 && dim.h > 20, JSON.stringify(dim));
    const sm = png(Buffer.from((await mcp.request('tools/call', { name: 'render_component', arguments: { component: 'Button', variant: { size: 'sm' } } })).result.content[0].data, 'base64'));
    assert.ok(sm.w < dim.w, 'the sm cell is narrower than the lg cell');
    const base = await mcp.request('tools/call', { name: 'render_component', arguments: { component: 'Card' } });
    assert.ok(base.result.content.some((c) => c.type === 'image'), 'no variant renders the base cell');
    const bad = await mcp.call('render_component', { component: 'Button', variant: { size: 'huge' } });
    assert.equal(bad.isError, true); assert.match(bad.text, /no value "huge"/);
    assert.equal((await mcp.call('render_component', { component: 'Button', variant: { colour: 'x' } })).isError, true);
    assert.equal((await mcp.call('render_component', { component: 'Nope' })).isError, true);
  } finally { mcp.stop(); await server.stop(); }
});

test('50 renders: p95 < 500 ms, and the pixels match the canvas cell', { timeout: 120000 }, async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1400, height: 900 });
  try {
    const variants = [{ size: 'md', state: 'default' }, { size: 'sm', state: 'hover' }, { size: 'lg', state: 'default' }, { size: 'lg', state: 'hover' }];
    const first = await getPng(server.url, 'Button', variants[0]); // cold: includes starting Chromium
    assert.equal(first.status, 200);
    const times = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const r = await getPng(server.url, 'Button', variants[i % variants.length]);
      times.push(performance.now() - t0);
      assert.equal(r.status, 200); assert.ok(png(r.buf).ok);
    }
    // 8 at a time, 6 rounds (48 renders), mixed components: the page pool keeps the tail short
    const conc = [];
    for (let round = 0; round < 6; round++) {
      await Promise.all(Array.from({ length: 8 }, async (_, i) => {
        const t0 = performance.now();
        const r = await getPng(server.url, i % 4 === 3 ? 'Card' : 'Button', i % 4 === 3 ? {} : variants[i % variants.length]);
        conc.push(performance.now() - t0); assert.equal(r.status, 200); assert.ok(png(r.buf).ok);
      }));
    }
    const c50 = percentile(conc, 0.5), c95 = percentile(conc, 0.95), cmax = Math.max(...conc);
    assert.ok(c95 < 500, `8 concurrent: p95 ${c95.toFixed(0)} ms`);
    const p50 = percentile(times, 0.5), p95 = percentile(times, 0.95), max = Math.max(...times);
    assert.ok(p95 < 500, `p95 ${p95.toFixed(0)} ms`);

    // Pixel compare: canvas screenshot of the same cell vs the render, ignoring pixels the render leaves transparent (rounded corners).
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"', 15000);
    const lines = [];
    // (the canvas resets the font on .frame, so components render as in an app; no neutralising style is needed)
    let worst = 0;
    for (const [name, v] of [...variants.map((x) => ['Button', x]), ['Card', {}]]) {
      const sel = `section[data-name="${name}"] figure.cell[data-variant='${JSON.stringify(v)}'] .mount > *`;
      // Line the cell up with the pixel grid (a fractional grid column would blur its edges differently from the render), then clip it.
      const rect = await browser.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); napkin.view.set({x:0,y:0,z:1}); const b0=napkin.view.stageBox(), q0=e.getBoundingClientRect(); napkin.view.set({x:Math.round(300-(q0.left-b0.left)),y:Math.round(300-(q0.top-b0.top)),z:1}); /* 100% zoom, cell near the top-left of the stage */ const sec=e.closest('section'); sec.style.marginLeft='0px'; let r=e.getBoundingClientRect(); sec.style.marginLeft=(-(r.left-Math.floor(r.left)))+'px'; sec.style.marginTop=(-(r.top-Math.floor(r.top)))+'px'; r=e.getBoundingClientRect(); return {x:r.left,y:r.top,width:Math.ceil(r.width),height:Math.ceil(r.height),scale:1}})()`);
      const shot = (await browser.send('Page.captureScreenshot', { format: 'png', clip: rect })).data;
      const mine = (await getPng(server.url, name, v)).buf.toString('base64');
      const cmp = await browser.eval(`(async()=>{
        const load = (b64)=>new Promise((res)=>{const i=new Image(); i.onload=()=>res(i); i.src='data:image/png;base64,'+b64});
        const [a,b]=await Promise.all([load(${JSON.stringify(shot)}),load(${JSON.stringify(mine)})]);
        if(a.width!==b.width||a.height!==b.height) return {size:[a.width,a.height,b.width,b.height]};
        const px=(i)=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return x.getImageData(0,0,i.width,i.height).data};
        const A=px(a),B=px(b); let n=0,bad=0,max=0;
        for(let k=0;k<A.length;k+=4){ if(B[k+3]<255) continue; n++; const d=Math.max(Math.abs(A[k]-B[k]),Math.abs(A[k+1]-B[k+1]),Math.abs(A[k+2]-B[k+2])); if(d>max)max=d; if(d>3) bad++; }
        return {w:a.width,h:a.height,n,bad,max};
      })()`);
      assert.ok(!cmp.size, `same size, got ${cmp.size}`);
      assert.ok(cmp.bad / cmp.n <= 0.005, `${name} ${JSON.stringify(v)}: ${cmp.bad}/${cmp.n} pixels differ by more than 3/255`);
      worst = Math.max(worst, cmp.bad / cmp.n);
      lines.push(`  ${name} ${JSON.stringify(v)}  ${cmp.w}x${cmp.h}px  opaque pixels ${cmp.n}  differing(>3/255) ${cmp.bad}  max channel diff ${cmp.max}`);
    }
    evidence('AGT-02', [
      'AGT-02 render_component timing and pixel match (generated by: EVIDENCE=1 node --test test/mcp/render.test.js)',
      `component Button, 4 variants cycled, 50 sequential warm renders over HTTP (GET /api/components/Button/render), Chromium CPU (swiftshader)`,
      `cold first render (starts Chromium): ${first.ms.toFixed(0)} ms server-side`,
      `warm: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${max.toFixed(0)} ms  (bar: p95 < 500 ms)`,
      `8 concurrent renders x 6 rounds (Button + Card, page pool of ${process.env.NAPKIN_RENDER_PAGES || 4}): p50 ${c50.toFixed(0)} ms, p95 ${c95.toFixed(0)} ms, max ${cmax.toFixed(0)} ms  (bar: p95 < 500 ms)`,
      'pixel compare vs a Page.captureScreenshot of the canvas cell (same component root element, 1x scale).',
      'tolerance: per-channel difference <= 3/255 on pixels the render paints opaque (rounded-corner pixels are transparent in the render and skipped); at most 0.5% of pixels may differ.',
      ...lines, `worst fraction differing: ${(worst * 100).toFixed(3)}%`,
    ].join('\n'));
  } finally { await browser.close(); await server.stop(); }
});
