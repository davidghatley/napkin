// glTF 2.0 and GLB into a scene description the viewer can execute: node hierarchy with transforms,
// meshes, flat materials, cameras and animation channels. Anything not applied is listed in `notes`.
import { window, LIMIT } from './readers.js';
const BUFFER_CAP = 32 * LIMIT,
  VERTEX_CAP = 90000;
const COMPONENT = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const hint = ' Next: open the model in its own application, or request a smaller entry.';
const fail = (m) => {
  throw new Error(m + hint);
};
const round = (v) => Number(v.toPrecision(6));
export function parseGltf(ctx, jsonOf) {
  let gltf, bin;
  if (ctx.kind === 'glb') {
    const b = window(ctx.file, 0, BUFFER_CAP);
    if (b.length < 20 || b.toString('ascii', 0, 4) !== 'glTF') fail('This is not a complete GLB file.');
    for (let at = 12; at + 8 <= b.length; ) {
      const n = b.readUInt32LE(at),
        type = b.readUInt32LE(at + 4);
      if (type === 0x4e4f534a) gltf = JSON.parse(b.toString('utf8', at + 8, at + 8 + n).trim());
      else if (type === 0x004e4942 && !bin) bin = b.subarray(at + 8, at + 8 + n);
      at += 8 + n + ((4 - (n % 4)) % 4);
    }
    if (!gltf) fail('The GLB has no scene description.');
  } else gltf = jsonOf();
  const notes = new Set();
  const buffers = (gltf.buffers || []).map((b, i) => {
    if (i === 0 && bin) return bin;
    if (b.uri?.startsWith('data:')) return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
    if (!b.uri || /^(?:https?:|\/)/.test(b.uri)) fail('A model buffer must be a file in the opened folder.');
    if (b.byteLength > BUFFER_CAP) fail('A model buffer exceeds the 32 MiB preview limit.');
    try {
      return window(ctx.resolveRelative(decodeURIComponent(b.uri)), 0, BUFFER_CAP);
    } catch {
      notes.add(`Buffer ${b.uri} is not in the folder`);
      return Buffer.alloc(0);
    }
  });
  function read(index, { flat = true } = {}) {
    const a = gltf.accessors?.[index];
    if (!a) fail('A model accessor is missing.');
    const [width, getter] = COMPONENT[a.componentType] || fail('Unsupported model accessor type.');
    const dim = WIDTH[a.type] || fail('Unsupported model accessor shape.');
    if (a.sparse) notes.add('Sparse accessors are not applied');
    const out = new Array(a.count * dim).fill(0);
    if (a.bufferView === undefined) return out;
    const v = gltf.bufferViews[a.bufferView],
      buf = buffers[v.buffer];
    if (!buf) return out;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength),
      stride = v.byteStride || dim * width,
      base = (v.byteOffset || 0) + (a.byteOffset || 0),
      norm = a.normalized && a.componentType !== 5126,
      max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 }[a.componentType];
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < dim; j++) {
        const at = base + i * stride + j * width;
        if (at + width > buf.byteLength) return out;
        let x = view[getter](at, true);
        if (norm) x = Math.max(-1, x / max);
        out[i * dim + j] = x;
      }
    return out;
  }
  const meshes = [];
  let vertices = 0,
    triangles = 0;
  for (const mesh of gltf.meshes || []) {
    const prims = [];
    for (const p of mesh.primitives || []) {
      if (p.extensions?.KHR_draco_mesh_compression) {
        notes.add('Draco-compressed meshes are not decoded');
        continue;
      }
      if (p.attributes?.POSITION === undefined) continue;
      const mode = p.mode ?? 4;
      if (![4, 5, 6].includes(mode)) {
        notes.add('Points and lines in a mesh are not drawn');
        continue;
      }
      const pos = read(p.attributes.POSITION);
      if (vertices + pos.length / 3 > VERTEX_CAP) {
        notes.add(`Large model: only the first ${VERTEX_CAP.toLocaleString()} vertices are shown`);
        continue;
      }
      let idx = p.indices === undefined ? Array.from({ length: pos.length / 3 }, (_, i) => i) : read(p.indices);
      if (mode === 5) idx = idx.slice(2).flatMap((_, i) => (i % 2 ? [idx[i + 1], idx[i], idx[i + 2]] : [idx[i], idx[i + 1], idx[i + 2]]));
      if (mode === 6) idx = idx.slice(2).flatMap((_, i) => [idx[0], idx[i + 1], idx[i + 2]]);
      idx = idx.slice(0, idx.length - (idx.length % 3));
      if (p.targets) notes.add('Morph targets are not applied');
      if (p.attributes.COLOR_0 !== undefined) notes.add('Vertex colors are not drawn; the material color is used');
      vertices += pos.length / 3;
      triangles += idx.length / 3;
      prims.push({ pos: pos.map(round), idx, material: p.material ?? -1 });
    }
    meshes.push({ name: mesh.name || null, prims });
  }
  const materials = (gltf.materials || []).map((m) => {
    const pbr = m.pbrMetallicRoughness || {},
      ext = m.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (pbr.baseColorTexture || m.emissiveTexture || m.normalTexture) notes.add('Textures are not drawn; flat material colors are used');
    return {
      name: m.name || null,
      color: pbr.baseColorFactor || ext?.diffuseFactor || [1, 1, 1, 1],
      emissive: m.emissiveFactor || [0, 0, 0],
      metallic: pbr.metallicFactor ?? 1,
      doubleSided: !!m.doubleSided,
      alpha: m.alphaMode === 'BLEND' || m.alphaMode === 'MASK' ? m.alphaMode : 'OPAQUE',
    };
  });
  const nodes = (gltf.nodes || []).map((n) => {
    if (n.skin !== undefined) notes.add('Skins are not applied; the bind pose is drawn');
    return {
      name: n.name || null,
      mesh: n.mesh ?? null,
      camera: n.camera ?? null,
      children: n.children || [],
      matrix: n.matrix || null,
      t: n.translation || [0, 0, 0],
      r: n.rotation || [0, 0, 0, 1],
      s: n.scale || [1, 1, 1],
    };
  });
  const children = new Set(nodes.flatMap((n) => n.children));
  const sceneIndex = gltf.scene ?? 0,
    scene = gltf.scenes?.[sceneIndex];
  const roots = scene?.nodes || nodes.map((_, i) => i).filter((i) => !children.has(i));
  const cameras = (gltf.cameras || []).map((c) => ({
    name: c.name || null,
    type: c.type,
    yfov: c.perspective?.yfov ?? 0.8,
    znear: c.perspective?.znear ?? c.orthographic?.znear ?? 0.1,
    zfar: c.perspective?.zfar ?? c.orthographic?.zfar ?? 1000,
    xmag: c.orthographic?.xmag,
    ymag: c.orthographic?.ymag,
  }));
  const animations = (gltf.animations || []).map((an, k) => {
    const channels = [];
    let duration = 0;
    for (const c of an.channels || []) {
      const s = an.samplers?.[c.sampler],
        path = c.target?.path;
      if (!s || c.target?.node === undefined || !['translation', 'rotation', 'scale'].includes(path)) {
        if (path === 'weights') notes.add('Morph weight animation is not applied');
        continue;
      }
      const times = read(s.input),
        values = read(s.output);
      duration = Math.max(duration, times.at(-1) || 0);
      channels.push({ node: c.target.node, path, interp: s.interpolation || 'LINEAR', times: times.map(round), values: values.map(round) });
    }
    return { name: an.name || `Animation ${k + 1}`, duration, channels };
  });
  return {
    format: ctx.kind,
    generator: gltf.asset?.generator || null,
    meshes,
    nodes,
    roots,
    materials,
    cameras,
    animations,
    stats: { vertices, triangles, nodes: nodes.length, materials: materials.length },
    notes: [...notes],
  };
}
// A Wavefront OBJ is a scene with one node; groups and "usemtl" names are kept as parts.
export function parseObj(text, limited) {
  const verts = [],
    prims = [],
    notes = [];
  let cur = null;
  const open = () => (cur ??= { pos: [], idx: [], material: -1, map: new Map() });
  const flush = () => {
    if (cur?.idx.length) prims.push({ pos: cur.pos, idx: cur.idx, material: cur.material });
    cur = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') verts.push(parts.slice(1, 4).map(Number));
    else if (parts[0] === 'f') {
      const c = open(),
        ids = parts.slice(1).map((v) => {
          const n = Number(v.split('/')[0]),
            vi = n < 0 ? verts.length + n : n - 1;
          if (!c.map.has(vi)) {
            c.map.set(vi, c.pos.length / 3);
            c.pos.push(...(verts[vi] || [0, 0, 0]).map(round));
          }
          return c.map.get(vi);
        });
      for (let i = 1; i + 1 < ids.length; i++) c.idx.push(ids[0], ids[i], ids[i + 1]);
      if (c.pos.length > VERTEX_CAP * 3) break;
    } else if (parts[0] === 'g' || parts[0] === 'o' || parts[0] === 'usemtl') {
      // A new part starts only when something has been drawn into the current one.
      if (cur?.idx.length) flush();
    }
  }
  flush();
  if (limited) notes.push('Only the first part of a large OBJ file is shown');
  return {
    format: 'obj',
    meshes: [{ name: null, prims }],
    nodes: [{ name: null, mesh: 0, camera: null, children: [], matrix: null, t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }],
    roots: [0],
    materials: [],
    cameras: [],
    animations: [],
    stats: { vertices: verts.length, triangles: prims.reduce((n, p) => n + p.idx.length / 3, 0), nodes: 1, materials: 0 },
    notes,
  };
}
