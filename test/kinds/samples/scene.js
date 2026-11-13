// A glTF scene that a one-mesh reader gets wrong: one cube mesh placed twice under a rotated parent,
// a green ground plane with its own material, a camera, and a spinning animation on one instance.
export function sceneGltf() {
  const cube = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]];
  const plane = [[-6, -1, -6], [6, -1, -6], [6, -1, 6], [-6, -1, 6]];
  const parts = [];
  const f32 = (arr) => {
    const b = Buffer.alloc(arr.length * 4);
    arr.forEach((v, i) => b.writeFloatLE(v, i * 4));
    return b;
  };
  const u16 = (arr) => {
    const b = Buffer.alloc(Math.ceil((arr.length * 2) / 4) * 4);
    arr.forEach((v, i) => b.writeUInt16LE(v, i * 2));
    return b;
  };
  const times = [0, 1, 2],
    quats = [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068, 0, 1, 0, 0];
  const chunks = [f32(cube.flat()), u16(faces.flat()), f32(plane.flat()), u16([0, 2, 1, 0, 3, 2]), f32(times), f32(quats)];
  let offset = 0;
  const views = chunks.map((c) => {
    const v = { buffer: 0, byteOffset: offset, byteLength: c.length };
    offset += c.length;
    return v;
  });
  const bin = Buffer.concat(chunks);
  return {
    asset: { version: '2.0', generator: 'napkin test scene' },
    scene: 0,
    scenes: [{ nodes: [0, 4, 5] }],
    nodes: [
      { name: 'Pair', children: [1, 2], rotation: [0, 0.3826834, 0, 0.9238795] },
      { name: 'Red cube left', mesh: 0, translation: [-2.5, 0, 0] },
      { name: 'Red cube right', mesh: 0, translation: [2.5, 0, 0], scale: [0.8, 1.4, 0.8] },
      { name: 'unused', children: [] },
      { name: 'Ground', mesh: 1 },
      { name: 'Eye', camera: 0, translation: [0, 4, 12], rotation: [-0.1950903, 0, 0, 0.9807853] },
    ],
    cameras: [{ name: 'Front', type: 'perspective', perspective: { yfov: 0.7, znear: 0.1, zfar: 100 } }],
    meshes: [
      { name: 'Cube', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
      { name: 'Plane', primitives: [{ attributes: { POSITION: 2 }, indices: 3, material: 1 }] },
    ],
    materials: [
      { name: 'Red', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.1, 0.1, 1] } },
      { name: 'Green', pbrMetallicRoughness: { baseColorFactor: [0.15, 0.6, 0.2, 1] } },
    ],
    animations: [
      {
        name: 'Spin',
        samplers: [{ input: 4, output: 5, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC3', min: [-6, -1, -6], max: [6, -1, 6] },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 5, componentType: 5126, count: 3, type: 'VEC4' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
  };
}
