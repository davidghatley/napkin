// 3D viewer for glTF, GLB and OBJ on the real runtime (model-runtime.js, three.js): materials, textures, the file's own
// cameras and animation clips. Same state object, DOM hooks and keys as the software viewer in model-view.js, which takes over
// when WebGL is not available or the context is lost.
export async function modelThree({ root, buffer, kind, recipe: r, label, bar, note, fmt, isReduced, esc, itemId, fallback }) {
  const rt = await import('/canvas/model-runtime.js');
  const dir = itemId.includes('/') ? itemId.slice(0, itemId.lastIndexOf('/') + 1) : '';
  const resolve = (url) => {
    const parts = (dir + decodeURIComponent(url.split('?')[0])).split('/'),
      out = [];
    for (const p of parts) p === '..' ? out.pop() : p !== '.' && p !== '' && out.push(p);
    return '/file/' + encodeURIComponent(out.join('/'));
  };
  const loaded = await rt.loadModel({ buffer, kind, resolve });
  const canvas = Object.assign(document.createElement('canvas'), { className: 'model', width: 900, height: 600, tabIndex: 0 });
  canvas.setAttribute('role', 'img');
  let view;
  try {
    view = rt.createView(canvas, loaded, { width: 900, height: 600 });
  } catch (e) {
    throw new Error('WebGL is not available: ' + e.message);
  }
  const { stats, cameras, clips } = view,
    hasAnim = clips.length > 0;
  root.innerHTML =
    bar(label, `${fmt(stats.vertices)} vertices · ${fmt(Math.round(stats.triangles))} triangles · ${stats.meshes} meshes${stats.textures ? ` · ${stats.textures} textures` : ''}`) +
    `<div class="toolbar model-bar"><button type="button" id="spin" aria-pressed="false">Turn</button>${hasAnim ? `<button type="button" id="play" aria-pressed="false">Play</button><label class="meta">Time <input id="time" type="range" min="0" max="1" step="0.001" value="0" aria-label="Animation time"></label><select id="clip" aria-label="Animation">${clips.map((a, i) => `<option value="${i}">${esc(a.name)} · ${a.duration.toFixed(1)} s</option>`).join('')}</select>` : ''}${cameras.length ? `<select id="camera" aria-label="Camera"><option value="">Orbit view</option>${cameras.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join('')}</select>` : ''}<button type="button" id="reset">Reset view</button><span class="meta">Drag turns · wheel or + and − zoom · arrows turn · Space turns or plays · W wireframe</span></div>`;
  root.append(canvas);
  canvas.setAttribute('aria-label', `3D model, ${label}. Arrow keys turn it, plus and minus zoom, space starts and stops motion.`);
  if (loaded.notes.length) root.insertAdjacentHTML('beforeend', note('Not applied: ' + loaded.notes.join('. ') + '.'));
  const S = {
    yaw: ((Number(r.rotation) || 0) * Math.PI) / 180,
    pitch: 0.38,
    zoom: 1,
    spin: r.spin !== false && !isReduced,
    wire: !!r.wireframe,
    playing: hasAnim && !isReduced,
    time: 0,
    clip: 0,
    cam: null,
    dirty: true,
  };
  const $ = (s) => root.querySelector(s),
    spinBtn = $('#spin'), playBtn = $('#play'), timeInput = $('#time'), clipSel = $('#clip'), camSel = $('#camera');
  const duration = () => clips[S.clip]?.duration || 1;
  const sync = () => {
    spinBtn.setAttribute('aria-pressed', String(S.spin));
    spinBtn.textContent = S.spin ? 'Stop turning' : 'Turn';
    if (playBtn) {
      playBtn.setAttribute('aria-pressed', String(S.playing));
      playBtn.textContent = S.playing ? 'Pause' : 'Play';
    }
    if (timeInput) timeInput.value = String(S.time / duration());
    S.dirty = true;
  };
  sync();
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    // Browsers keep only a handful of live GL contexts; the oldest card gives its up and is redrawn by the software viewer.
    fallback?.();
  });
  let last = performance.now(), active = true;
  document.addEventListener('visibilitychange', () => (active = !document.hidden));
  const frame = () => {
    view.draw(S);
    canvas.dataset.triangles = String(Math.round(stats.triangles));
    canvas.dataset.yaw = S.yaw.toFixed(3);
    canvas.dataset.pitch = S.pitch.toFixed(3);
    canvas.dataset.time = S.time.toFixed(3);
    canvas.dataset.camera = S.cam === null ? 'orbit' : String(S.cam);
    canvas.dataset.renderer = 'webgl';
  };
  const loop = (now) => {
    if (lost) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (active) {
      if (S.spin && S.cam === null) { S.yaw += 0.35 * dt * 60 * (Math.PI / 180); S.dirty = true; }
      if (S.playing) {
        S.time = (S.time + dt) % (duration() || 1);
        if (timeInput) timeInput.value = String(S.time / duration());
        S.dirty = true;
      }
      if (S.dirty) { S.dirty = false; frame(); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  spinBtn.onclick = () => { S.spin = !S.spin; sync(); };
  if (playBtn) playBtn.onclick = () => { S.playing = !S.playing; sync(); };
  if (timeInput) timeInput.oninput = () => { S.playing = false; S.time = Number(timeInput.value) * duration(); sync(); };
  if (clipSel) clipSel.onchange = () => { S.clip = Number(clipSel.value); S.time = 0; sync(); };
  if (camSel) camSel.onchange = () => { S.cam = camSel.value === '' ? null : Number(camSel.value); sync(); };
  $('#reset').onclick = () => { S.yaw = 0; S.pitch = 0.38; S.zoom = 1; S.cam = null; if (camSel) camSel.value = ''; sync(); };
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) { S.yaw -= e.movementX * 0.01; S.pitch = Math.max(-1.4, Math.min(1.4, S.pitch + e.movementY * 0.01)); S.dirty = true; }
  });
  canvas.addEventListener('wheel', (e) => {
    if (document.activeElement !== canvas) return;
    e.preventDefault();
    S.zoom = Math.max(0.2, Math.min(8, S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    S.dirty = true;
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 15 : 5) * (Math.PI / 180), k = e.key;
    let used = true;
    if (k === 'ArrowLeft') S.yaw -= step;
    else if (k === 'ArrowRight') S.yaw += step;
    else if (k === 'ArrowUp') S.pitch = Math.min(1.4, S.pitch + step);
    else if (k === 'ArrowDown') S.pitch = Math.max(-1.4, S.pitch - step);
    else if (k === '+' || k === '=') S.zoom = Math.min(8, S.zoom * 1.15);
    else if (k === '-' || k === '_') S.zoom = Math.max(0.2, S.zoom / 1.15);
    else if (k === ' ') { if (hasAnim) S.playing = !S.playing; else S.spin = !S.spin; }
    else if (k === 'w' || k === 'W') S.wire = !S.wire;
    else if (k === 'Home') { S.yaw = 0; S.pitch = 0.38; S.zoom = 1; }
    else used = false;
    if (used) { e.preventDefault(); sync(); }
  });
  canvas.napkinModel = S;
}
