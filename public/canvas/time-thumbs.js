// Thumbnails for the film strip (moment 9). Lazy by construction: nothing is drawn until the strip is open; a tile draws only
// while it is (nearly) in view; at most two frames load at a time and each waits for an idle moment, so the canvas keeps its
// frame rate. A tile that scrolls away drops its frame again, so a long history never holds more than a screenful.
// Each thumbnail is a real /view of that version, scaled down; scripts stay off unless the file is React (it needs them).
//   thumbs(track, spec) -> { watch(crop), reset() }   spec(tile) -> { id, version, kind, crop }
// `crop` is { x, y, w, h, frameWidth } in the frame's pixels: the selected element, or the component's content. Every tile
// shows that same region scaled to fit, so tiles differ where the versions do (a padding change is visible, not 20% of a page).
const enc = encodeURIComponent;
export const THUMB_W = 140, THUMB_H = 72;
const W = THUMB_W, H = THUMB_H, MAX_LIVE = 2;
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 30));

export function thumbs(track, spec) {
  let io = null, queue = [], running = 0, gen = 0;
  const live = new Map();   // tile -> iframe
  function pump() {
    while (running < MAX_LIVE && queue.length) {
      const tile = queue.shift();
      if (!tile.isConnected || live.has(tile)) continue;
      running++;
      const my = gen;
      idle(() => {
        if (my !== gen) return;
        if (!tile.isConnected) { running--; pump(); return; }
        const s = spec(tile), box = tile.querySelector('.tm-thumb'), c = s.crop || { x: 0, y: 0, w: s.crop?.frameWidth || 640, h: 200, frameWidth: 640 };
        const f = document.createElement('iframe');
        const k = Math.min(W / c.w, H / c.h, 3), width = c.frameWidth;
        f.title = 'Thumbnail'; f.tabIndex = -1; f.setAttribute('aria-hidden', 'true'); f.setAttribute('loading', 'lazy');
        f.setAttribute('sandbox', s.kind === 'html' ? 'allow-same-origin' : 'allow-scripts allow-same-origin');
        f.style.cssText = `width:${width}px;height:${Math.ceil(c.y + c.h + 40)}px;transform:translate(${(W - c.w * k) / 2 - c.x * k}px,${(H - c.h * k) / 2 - c.y * k}px) scale(${k});`;
        let settled = false;
        const done = () => { if (settled || my !== gen) return; settled = true; running--; f.dataset.ready = '1'; pump(); };
        f.addEventListener('load', done, { once: true });
        setTimeout(done, 4000);
        f.src = `/view/${enc(s.id)}?${s.version ? `version=${enc(s.version)}&` : ''}width=${width}`;
        box.append(f); live.set(tile, f);
      });
    }
  }
  function enter(tile) { if (!live.has(tile) && !queue.includes(tile)) { queue.push(tile); pump(); } }
  function leave(tile) {
    queue = queue.filter((t) => t !== tile);
    const f = live.get(tile);
    if (f) { f.remove(); live.delete(tile); }
  }
  return {
    watch(c) {
      io = new IntersectionObserver((entries) => { for (const e of entries) (e.isIntersecting ? enter : leave)(e.target); }, { root: track, rootMargin: '0px 120px 0px 120px' });
      track.querySelectorAll('.tm-tile').forEach((t) => io.observe(t));
    },
    reset() { gen++; io?.disconnect(); io = null; queue = []; running = 0; for (const f of live.values()) f.remove(); live.clear(); },
  };
}
