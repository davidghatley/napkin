import { decodePng } from "../p0-lib.js";
import { assert, key, sleep } from "./runtime.mjs";
// A compositor frame, cropped to the item preview, not the changing number in the panel.
export async function scrubPixel(
  b,
  keyName = "ArrowRight",
  modifiers = 0,
  selector = null,
  skipQuiet = false,
) {
  const rect = await b.eval(
    `(()=>{const es=[...document.querySelectorAll('iframe,video,canvas,svg,img')];const selector=${JSON.stringify(selector)};const e=selector?document.querySelector(selector):es.find(e=>e.closest('[data-item-id]')&&!e.closest('[data-controls-for]'));if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.max(0,Math.ceil(r.x)),y:Math.max(0,Math.ceil(r.y)),w:Math.floor(Math.min(r.right,innerWidth)-Math.max(0,r.x)),h:Math.floor(Math.min(r.bottom,innerHeight)-Math.max(0,r.y))}})()`,
  );
  assert(
    rect?.w > 8 && rect.h > 8,
    "visible item preview required for scrub-to-pixel measurement",
  );
  const initial = decodePng(await b.screenshot());
  if (!skipQuiet) {
    await sleep(200);
    assert(
      regionDiff(initial, decodePng(await b.screenshot()), rect) <=
        Math.max(8, rect.w * rect.h * 0.0005),
      "preview changes by itself; cannot attribute pixel changes to the key",
    );
  }
  let started = false,
    start,
    resolve,
    reject,
    timer;
  const done = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  void done.catch(() => {});
  const queued = [];
  let handle;
  handle = (m) => {
    if (m.method !== "Page.screencastFrame") return;
    void b.send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
    if (!started) return;
    if (start === undefined) {
      queued.push(m);
      return;
    }
    try {
      const next = decodePng(Buffer.from(m.params.data, "base64"));
      assert(
        next.width === initial.width && next.height === initial.height,
        "screencast scale differs",
      );
      let different = 0;
      for (let y = rect.y; y < rect.y + rect.h; y += 2)
        for (let x = rect.x; x < rect.x + rect.w; x += 2) {
          const i = (y * next.width + x) * 4;
          const d = Math.max(
            ...[0, 1, 2].map((c) =>
              Math.abs(next.data[i + c] - initial.data[i + c]),
            ),
          );
          if (d > 8) different++;
        }
      if (different > Math.max(8, rect.w * rect.h * 0.0005)) {
        const elapsed = m.params.metadata.timestamp * 1000 - start;
        if (elapsed >= 0) resolve(elapsed);
      }
    } catch (e) {
      reject(e);
    }
  };
  const off = b.onEvent(handle);
  try {
    await b.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await sleep(20);
    await b.eval(
      `void(window.__scrubStart=new Promise(resolve=>document.addEventListener('keydown',()=>resolve(performance.timeOrigin+performance.now()),{once:true,capture:true})))`,
    );
    started = true;
    timer = setTimeout(
      () => reject(Error("No item pixels changed within 1000 ms of scrub key")),
      1000,
    );
    // Keep every key event physical. The page listener records when the browser receives it.
    const press = key(b, keyName, modifiers);
    start = await b.eval("window.__scrubStart");
    for (const m of queued) handle(m);
    await press;
    return await done;
  } finally {
    clearTimeout(timer);
    off();
    await b.send("Page.stopScreencast");
  }
}
async function previewRect(b, selector) {
  return b.eval(
    `(()=>{const es=[...document.querySelectorAll('iframe,video,canvas,svg,img')];const selector=${JSON.stringify(selector)};const e=selector?document.querySelector(selector):es.find(e=>e.closest('[data-item-id]')&&!e.closest('[data-controls-for]'));if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.max(0,Math.ceil(r.x)),y:Math.max(0,Math.ceil(r.y)),w:Math.floor(Math.min(r.right,innerWidth)-Math.max(0,r.x)),h:Math.floor(Math.min(r.bottom,innerHeight)-Math.max(0,r.y))}})()`,
  );
}
function regionDiff(a, z, rect) {
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 2)
    for (let x = rect.x; x < rect.x + rect.w; x += 2) {
      const i = (y * a.width + x) * 4;
      if (
        Math.max(
          Math.abs(a.data[i] - z.data[i]),
          Math.abs(a.data[i + 1] - z.data[i + 1]),
          Math.abs(a.data[i + 2] - z.data[i + 2]),
        ) > 8
      )
        n++;
    }
  return n;
}
// Causal scrub timing. A random walk of key presses over positions 0..2 (relative to a warm-up
// step). Every step must change the preview, the preview must be still when no key is pressed,
// and revisiting a position must show the same frame. An animation that ignores the keys cannot
// satisfy all three; neither can a preview that changes for any key.
export async function scrubWalk(
  b,
  { selector = null, steps = 30, up = "ArrowRight", down = "ArrowLeft" } = {},
) {
  const rect = await previewRect(b, selector);
  assert(
    rect?.w > 8 && rect.h > 8,
    "visible item preview required for scrub measurement",
  );
  await key(b, up);
  await sleep(350);
  const idle1 = decodePng(await b.screenshot());
  await sleep(250);
  const idle2 = decodePng(await b.screenshot());
  const tolerance = Math.max(8, rect.w * rect.h * 0.0005);
  assert(
    regionDiff(idle1, idle2, rect) <= tolerance,
    "preview changes by itself while no key is pressed; scrub timing cannot be attributed to the key",
  );
  // A key that is not the scrub key must not move the preview, not even briefly: a preview that
  // animates for a moment after ANY keydown is a timing cheat, not a scrub.
  for (const noop of ["Shift", "Shift"]) {
    await key(b, noop);
    const soon = decodePng(await b.screenshot());
    assert(
      regionDiff(idle2, soon, rect) <= tolerance,
      "preview reacts to a key that is not the scrub key; scrub timing is not causal",
    );
    await sleep(120);
    const later = decodePng(await b.screenshot());
    assert(
      regionDiff(idle2, later, rect) <= tolerance,
      "preview changes shortly after an unrelated key",
    );
  }
  const frames = new Map([[1, idle2]]),
    times = [];
  let pos = 1;
  for (let n = 0; n < steps; n++) {
    const dir = pos === 1 ? 1 : pos === 3 ? -1 : Math.random() < 0.5 ? 1 : -1;
    const ms = await scrubPixel(b, dir > 0 ? up : down, 0, selector, true);
    pos += dir;
    times.push(ms);
    await sleep(180);
    const frame = decodePng(await b.screenshot());
    if (frames.has(pos))
      assert(
        regionDiff(frames.get(pos), frame, rect) <= tolerance * 3,
        `frame at position ${pos} differs between visits: the preview is not a function of the scrub position`,
      );
    else frames.set(pos, frame);
  }
  return times;
}
export async function selectionTime(b, commit, expectedItem) {
  await b.eval(
    `void(window.__panelTime=new Promise(resolve=>{let t;const wanted=${JSON.stringify(expectedItem)};const ready=()=>{const e=document.querySelector('[data-controls-for="'+CSS.escape(wanted)+'"]');if(e&&e.getBoundingClientRect().width>0&&e.querySelector('[data-control-id]')){observer.disconnect();resolve(performance.now()-t)}};const observer=new MutationObserver(ready);document.addEventListener('keydown',()=>{t=performance.now();observer.observe(document.body,{attributes:true,childList:true,subtree:true});queueMicrotask(ready);},{once:true,capture:true});setTimeout(()=>{observer.disconnect();resolve(Infinity)},1000)}))`,
  );
  await commit();
  return b.eval("window.__panelTime");
}
