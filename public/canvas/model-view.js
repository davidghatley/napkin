// Executes a glTF/OBJ scene description: node transforms, instanced meshes, material colors, the
// scene's own cameras and its animations. Software painter's algorithm on a 2D canvas, no GPU.
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function trs(t, q, s) {
  const [x, y, z, w] = q,
    xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function invert(m) {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  return det ? inv.map((v) => v / det) : I4();
}
function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let k0 = 1 - t, k1 = t * sign;
  if (dot < 0.9995) {
    const th = Math.acos(dot), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = (Math.sin(t * th) / s) * sign;
  }
  const o = a.map((v, i) => v * k0 + b[i] * k1),
    n = Math.hypot(...o) || 1;
  return o.map((v) => v / n);
}
function sample(ch, time) {
  const { times, values, path, interp } = ch,
    w = path === 'rotation' ? 4 : 3,
    cubic = interp === 'CUBICSPLINE',
    at = (i) => values.slice(cubic ? (i * 3 + 1) * w : i * w, (cubic ? (i * 3 + 1) * w : i * w) + w);
  if (!times.length) return null;
  if (time <= times[0]) return at(0);
  if (time >= times.at(-1)) return at(times.length - 1);
  let i = 0;
  while (times[i + 1] < time) i++;
  const a = at(i), b = at(i + 1), t = (time - times[i]) / (times[i + 1] - times[i] || 1);
  if (interp === 'STEP') return a;
  return path === 'rotation' ? slerp(a, b, t) : a.map((v, k) => v + (b[k] - v) * t);
}
const srgb = (v) => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));
export function modelView({ root, scene, recipe: r, label, bar, note, fmt, isReduced, esc }) {
  const stats = scene.stats || {};
  const hasAnim = scene.animations.length > 0,
    cams = scene.nodes.map((n, i) => (n.camera !== null ? { node: i, camera: n.camera } : null)).filter(Boolean);
  root.innerHTML =
    bar(label, `${fmt(stats.vertices || 0)} vertices · ${fmt(stats.triangles || 0)} triangles${scene.nodes.length > 1 ? ` · ${scene.nodes.length} nodes` : ''}${scene.materials.length ? ` · ${scene.materials.length} materials` : ''}`) +
    `<div class="toolbar model-bar"><button type="button" id="spin" aria-pressed="false">Turn</button>${hasAnim ? `<button type="button" id="play" aria-pressed="false">Play</button><label class="meta">Time <input id="time" type="range" min="0" max="1" step="0.001" value="0" aria-label="Animation time"></label><select id="clip" aria-label="Animation">${scene.animations.map((a, i) => `<option value="${i}">${esc(a.name)} · ${a.duration.toFixed(1)} s</option>`).join('')}</select>` : ''}${cams.length ? `<select id="camera" aria-label="Camera"><option value="">Orbit view</option>${cams.map((c, i) => `<option value="${i}">${esc(scene.cameras[c.camera]?.name || 'Camera ' + (i + 1))}</option>`).join('')}</select>` : ''}<button type="button" id="reset">Reset view</button><span class="meta">Arrows turn · + and − zoom · Space turns or plays · W wireframe</span></div>` +
    `<canvas class="model" width="900" height="600" tabindex="0" role="img" aria-label="3D model, ${esc(label)}. Arrow keys turn it, plus and minus zoom, space starts and stops motion."></canvas>` +
    (scene.notes.length ? note('Not applied: ' + scene.notes.join('. ') + '.') : '');
  const canvas = root.querySelector('canvas'),
    g = canvas.getContext('2d'),
    spinBtn = root.querySelector('#spin'),
    playBtn = root.querySelector('#play'),
    timeInput = root.querySelector('#time'),
    clipSel = root.querySelector('#clip'),
    camSel = root.querySelector('#camera');
  const totalTris = scene.meshes.reduce((n, m) => n + m.prims.reduce((k, p) => k + p.idx.length / 3, 0), 0);
  if (!totalTris) {
    root.insertAdjacentHTML('beforeend', note('No triangle positions were found'));
    return;
  }
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
  const world = new Array(scene.nodes.length);
  function pose(t) {
    const anim = scene.animations[S.clip],
      over = new Map();
    if (anim)
      for (const ch of anim.channels) {
        const v = sample(ch, t);
        if (v) (over.get(ch.node) || over.set(ch.node, {}).get(ch.node))[ch.path] = v;
      }
    const walk = (i, parent) => {
      const n = scene.nodes[i],
        o = over.get(i) || {},
        local = n.matrix && !o.translation && !o.rotation && !o.scale ? n.matrix : trs(o.translation || n.t, o.rotation || n.r, o.scale || n.s);
      world[i] = mul(parent, local);
      for (const c of n.children) if (scene.nodes[c]) walk(c, world[i]);
    };
    for (const i of scene.roots) if (scene.nodes[i]) walk(i, I4());
  }
  // Bounds of the first pose frame the orbit view.
  pose(0);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const eachVertex = (fn) => {
    scene.nodes.forEach((n, i) => {
      if (n.mesh === null || !world[i] || !scene.meshes[n.mesh]) return;
      const m = world[i];
      for (const p of scene.meshes[n.mesh].prims) fn(p, m);
    });
  };
  eachVertex((p, m) => {
    for (let i = 0; i < p.pos.length; i += 3) {
      const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2];
      const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
    }
  });
  const center = lo.map((v, i) => (v + hi[i]) / 2),
    radius = Math.max(0.001, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
  const W = canvas.width, H = canvas.height;
  const FOV = 0.7, F = H / 2 / Math.tan(FOV / 2);
  const STRIDE = Math.max(1, Math.ceil(totalTris / 14000));
  const light = [-0.4, 0.55, 0.73];
  function frame() {
    pose(S.time);
    let view, focal = F, ortho = null;
    const cam = S.cam !== null ? cams[S.cam] : null;
    if (cam) {
      const c = scene.cameras[cam.camera] || {};
      view = invert(world[cam.node]);
      if (c.type === 'orthographic') ortho = { x: c.xmag || 1, y: c.ymag || 1 };
      else focal = H / 2 / Math.tan((c.yfov || FOV) / 2);
    } else {
      const d = (radius / Math.sin(FOV / 2)) * 1.05 / S.zoom,
        cy = Math.cos(S.pitch), cx = Math.sin(S.yaw) * cy, cz = Math.cos(S.yaw) * cy, sy = Math.sin(S.pitch);
      const ez = [cx, sy, cz], up = [0, 1, 0];
      const xa = [up[1] * ez[2] - up[2] * ez[1], up[2] * ez[0] - up[0] * ez[2], up[0] * ez[1] - up[1] * ez[0]],
        xl = Math.hypot(...xa) || 1,
        xv = xa.map((v) => v / xl),
        yv = [ez[1] * xv[2] - ez[2] * xv[1], ez[2] * xv[0] - ez[0] * xv[2], ez[0] * xv[1] - ez[1] * xv[0]];
      const eye = center.map((v, i) => v + ez[i] * d);
      view = [xv[0], yv[0], ez[0], 0, xv[1], yv[1], ez[1], 0, xv[2], yv[2], ez[2], 0, -(xv[0] * eye[0] + xv[1] * eye[1] + xv[2] * eye[2]), -(yv[0] * eye[0] + yv[1] * eye[1] + yv[2] * eye[2]), -(ez[0] * eye[0] + ez[1] * eye[1] + ez[2] * eye[2]), 1];
    }
    const tris = [];
    scene.nodes.forEach((n, i) => {
      if (n.mesh === null || !world[i] || !scene.meshes[n.mesh]) return;
      const m = mul(view, world[i]);
      for (const p of scene.meshes[n.mesh].prims) {
        const mat = scene.materials[p.material],
          base = mat ? mat.color : [0.55, 0.64, 0.6, 1],
          emit = mat ? mat.emissive : [0, 0, 0],
          alpha = base[3] ?? 1;
        const v = new Float32Array((p.pos.length / 3) * 3);
        for (let k = 0, j = 0; k < p.pos.length; k += 3, j += 3) {
          const x = p.pos[k], y = p.pos[k + 1], z = p.pos[k + 2];
          v[j] = m[0] * x + m[4] * y + m[8] * z + m[12];
          v[j + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          v[j + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        for (let k = 0; k < p.idx.length; k += 3 * STRIDE) {
          const a = p.idx[k] * 3, b = p.idx[k + 1] * 3, c = p.idx[k + 2] * 3;
          if (v[a + 2] > -0.01 || v[b + 2] > -0.01 || v[c + 2] > -0.01) continue;
          const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2],
            wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
          let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          // Faces turned away from the viewer are lit from behind for double-sided materials and skipped otherwise.
          const facing = nx * v[a] + ny * v[a + 1] + nz * v[a + 2] > 0;
          if (facing) { nx = -nx; ny = -ny; nz = -nz; }
          const lit = 0.3 + 0.7 * Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
          tris.push({
            z: (v[a + 2] + v[b + 2] + v[c + 2]) / 3,
            pts: [a, b, c].map((o) => (ortho ? [W / 2 + (v[o] / ortho.x) * (W / 2), H / 2 - (v[o + 1] / ortho.y) * (H / 2)] : [W / 2 + (v[o] / -v[o + 2]) * focal, H / 2 - (v[o + 1] / -v[o + 2]) * focal])),
            color: `rgb(${srgb(base[0] * lit + emit[0])},${srgb(base[1] * lit + emit[1])},${srgb(base[2] * lit + emit[2])})`,
            alpha,
          });
        }
      }
    });
    tris.sort((p, q) => p.z - q.z);
    g.clearRect(0, 0, W, H);
    g.lineJoin = 'round';
    for (const t of tris) {
      g.beginPath();
      g.moveTo(t.pts[0][0], t.pts[0][1]);
      g.lineTo(t.pts[1][0], t.pts[1][1]);
      g.lineTo(t.pts[2][0], t.pts[2][1]);
      g.closePath();
      g.globalAlpha = t.alpha;
      if (!S.wire) {
        g.fillStyle = t.color;
        g.fill();
        g.lineWidth = 0.6;
        g.strokeStyle = t.color;
      } else {
        g.lineWidth = 1;
        g.strokeStyle = '#2e6d5b';
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    canvas.dataset.triangles = String(tris.length);
    canvas.dataset.yaw = S.yaw.toFixed(3);
    canvas.dataset.pitch = S.pitch.toFixed(3);
    canvas.dataset.time = S.time.toFixed(3);
    canvas.dataset.camera = S.cam === null ? 'orbit' : String(S.cam);
  }
  const duration = () => scene.animations[S.clip]?.duration || 1;
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
  let last = performance.now(),
    active = true;
  document.addEventListener('visibilitychange', () => (active = !document.hidden));
  const loop = (now) => {
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
  root.querySelector('#reset').onclick = () => { S.yaw = 0; S.pitch = 0.38; S.zoom = 1; S.cam = null; if (camSel) camSel.value = ''; sync(); };
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
    const step = (e.shiftKey ? 15 : 5) * (Math.PI / 180);
    const k = e.key;
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
  // Test and automation hook: the same state the controls move.
  canvas.napkinModel = S;
}
