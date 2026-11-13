import { decodePng } from "../p0-lib.js";
import { fromHex } from "./media.mjs";
import { sleep } from "./runtime.mjs";
export const shot = async (b) => decodePng(await b.screenshot());
// Share of pixels within `tol` (per channel) of a colour.
export function colorShare(p, hex, tol = 40) {
  const [r, g, bl] = fromHex(hex);
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4)
    if (
      Math.abs(p.data[i] - r) <= tol &&
      Math.abs(p.data[i + 1] - g) <= tol &&
      Math.abs(p.data[i + 2] - bl) <= tol
    )
      n++;
  return n / (p.width * p.height);
}
export function differing(a, b, rect = null, tol = 12) {
  let n = 0;
  const x0 = rect?.x ?? 0,
    y0 = rect?.y ?? 0,
    x1 = rect ? rect.x + rect.w : a.width,
    y1 = rect ? rect.y + rect.h : a.height;
  for (let y = Math.max(0, y0); y < Math.min(a.height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(a.width, x1); x++) {
      const i = (y * a.width + x) * 4;
      if (
        Math.max(
          Math.abs(a.data[i] - b.data[i]),
          Math.abs(a.data[i + 1] - b.data[i + 1]),
          Math.abs(a.data[i + 2] - b.data[i + 2]),
        ) > tol
      )
        n++;
    }
  return n;
}
export async function rectOf(b, selector) {
  return b.eval(
    `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>{const r=e.getBoundingClientRect();return r.width>8&&r.height>8});if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.max(0,Math.round(r.x)),y:Math.max(0,Math.round(r.y)),w:Math.round(Math.min(r.right,innerWidth)-Math.max(0,r.x)),h:Math.round(Math.min(r.bottom,innerHeight)-Math.max(0,r.y))}})()`,
  );
}
// Vertical extent of non-background ink in a thin column of a rect.
export function inkExtent(p, rect, frac, halfWidth = null) {
  // Background = the most common colour on the rect's outer rim, never the shape inside it.
  const bins = new Map();
  const tally = (x, y) => {
    const i = (y * p.width + x) * 4,
      k = `${p.data[i] >> 4},${p.data[i + 1] >> 4},${p.data[i + 2] >> 4}`;
    bins.set(k, (bins.get(k) || 0) + 1);
  };
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    tally(x, rect.y);
    tally(x, rect.y + rect.h - 1);
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    tally(rect.x, y);
    tally(rect.x + rect.w - 1, y);
  }
  const bg = [...bins]
    .sort((a, b) => b[1] - a[1])[0][0]
    .split(",")
    .map(Number);
  const cx = Math.round(rect.x + rect.w * frac),
    half = halfWidth ?? Math.max(2, Math.round(rect.w * 0.03));
  let lo = Infinity,
    hi = -Infinity;
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = cx - half; x <= cx + half; x++) {
      const i = (y * p.width + x) * 4;
      if (
        Math.abs((p.data[i] >> 4) - bg[0]) > 1 ||
        Math.abs((p.data[i + 1] >> 4) - bg[1]) > 1 ||
        Math.abs((p.data[i + 2] >> 4) - bg[2]) > 1
      ) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
  return hi >= lo ? hi - lo + 1 : 0;
}
export async function scrollEverything(b, frac) {
  await b.eval(
    `(()=>{for(const e of [document.scrollingElement,...document.querySelectorAll('*')]){if(!e)continue;const s=getComputedStyle(e);if(e.scrollHeight>e.clientHeight+4&&(e===document.scrollingElement||/auto|scroll/.test(s.overflowY)))e.scrollTop=${frac}*(e.scrollHeight-e.clientHeight)}})()`,
  );
  await sleep(180);
}
export const visibleText = (b) => b.eval("document.body.innerText");
// The up-to-n most common colours of a picture (3-bit bins, each reported as its mean colour),
// ignoring bins under `min` of the picture. `rect` limits the area.
export function dominantColours(p, rect = null, n = 3, min = 0.04) {
  const x0 = Math.max(0, rect?.x ?? 0),
    y0 = Math.max(0, rect?.y ?? 0),
    x1 = Math.min(p.width, rect ? rect.x + rect.w : p.width),
    y1 = Math.min(p.height, rect ? rect.y + rect.h : p.height);
  const bins = new Map();
  let total = 0;
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      const i = (y * p.width + x) * 4,
        k = (p.data[i] >> 5) * 64 + (p.data[i + 1] >> 5) * 8 + (p.data[i + 2] >> 5);
      const b = bins.get(k) || [0, 0, 0, 0];
      b[0]++, (b[1] += p.data[i]), (b[2] += p.data[i + 1]), (b[3] += p.data[i + 2]);
      bins.set(k, b);
      total++;
    }
  return [...bins.values()]
    .filter((b) => b[0] / total >= min)
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map((b) => [b[1] / b[0], b[2] / b[0], b[3] / b[0]].map(Math.round));
}
// Share of a rect's pixels within `tol` of an [r,g,b] colour.
export function shareOf(p, rect, rgb, tol = 48) {
  let hit = 0,
    all = 0;
  const x1 = Math.min(p.width, rect.x + rect.w),
    y1 = Math.min(p.height, rect.y + rect.h);
  for (let y = Math.max(0, rect.y); y < y1; y += 2)
    for (let x = Math.max(0, rect.x); x < x1; x += 2) {
      const i = (y * p.width + x) * 4;
      all++;
      if (
        Math.abs(p.data[i] - rgb[0]) <= tol &&
        Math.abs(p.data[i + 1] - rgb[1]) <= tol &&
        Math.abs(p.data[i + 2] - rgb[2]) <= tol
      )
        hit++;
    }
  return all ? hit / all : 0;
}
