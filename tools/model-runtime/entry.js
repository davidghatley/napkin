// The 3D runtime napkin ships for glTF, GLB and OBJ: three.js (MIT) with its GLTFLoader (materials, textures, cameras, skins,
// morph targets, animations, KHR extensions), OBJLoader and the Meshopt decoder. Built into public/canvas/model-runtime.js by
// tools/build-runtimes.mjs; the viewer imports it only when a 3D file is opened.
import {
  AnimationMixer, Box3, Color, DirectionalLight, DoubleSide, HemisphereLight, LoadingManager,
  Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export async function loadModel({ buffer, kind, resolve }) {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => (/^(data:|blob:|https?:)/.test(url) ? url : resolve(url)));
  const notes = [];
  let root, animations = [];
  if (kind === 'obj') {
    root = new OBJLoader(manager).parse(new TextDecoder().decode(buffer));
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = new MeshStandardMaterial({ color: 0x8fa89c, roughness: 0.7, metalness: 0.05, side: DoubleSide, flatShading: !o.geometry.attributes.normal });
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      }
    });
  } else {
    const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    const gltf = await new Promise((ok, no) => loader.parse(buffer, '', ok, (e) => no(new Error(e?.message || String(e)))));
    root = gltf.scene || gltf.scenes?.[0];
    animations = gltf.animations || [];
    const used = gltf.parser?.json?.extensionsUsed || [];
    if (used.includes('KHR_draco_mesh_compression')) notes.push('Draco-compressed meshes are not decoded');
  }
  return { root, animations, notes };
}

export function createView(canvas, loaded, { width, height }) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.add(new HemisphereLight(0xffffff, 0x8899aa, 0.35));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-0.4, 0.8, 0.9);
  scene.add(sun);
  scene.add(loaded.root);
  loaded.root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(loaded.root),
    center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3()),
    radius = Math.max(0.001, box.isEmpty() ? 1 : box.getSize(new Vector3()).length() / 2);
  const mixer = new AnimationMixer(loaded.root);
  const cameras = [];
  loaded.root.traverse((o) => o.isCamera && cameras.push(o));
  const orbit = new PerspectiveCamera(40, width / height, radius / 100, radius * 100);
  const FOV = 0.7;
  orbit.fov = (FOV * 180) / Math.PI;
  let stats = { triangles: 0, vertices: 0, meshes: 0, textures: 0 };
  const textures = new Set();
  loaded.root.traverse((o) => {
    if (!o.isMesh) return;
    stats.meshes++;
    const g = o.geometry;
    stats.vertices += g.attributes.position?.count || 0;
    stats.triangles += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
    for (const m of [].concat(o.material)) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
  });
  stats.textures = textures.size;
  const meshes = [];
  loaded.root.traverse((o) => o.isMesh && meshes.push(o));
  return {
    stats,
    cameras: cameras.map((c, i) => c.name || 'Camera ' + (i + 1)),
    clips: loaded.animations.map((a) => ({ name: a.name || 'Animation', duration: a.duration })),
    draw(S, aspect = width / height) {
      for (const m of meshes) for (const mat of [].concat(m.material)) if (mat.wireframe !== !!S.wire) (mat.wireframe = !!S.wire), (mat.needsUpdate = true);
      const clip = loaded.animations[S.clip];
      mixer.stopAllAction();
      if (clip) {
        mixer.clipAction(clip).play();
        mixer.setTime(S.time || 0);
      }
      loaded.root.updateMatrixWorld(true);
      let cam = orbit;
      if (S.cam !== null && cameras[S.cam]) {
        cam = cameras[S.cam];
        if (cam.isPerspectiveCamera) cam.aspect = aspect;
        else if (cam.isOrthographicCamera) {
          const h = (cam.top - cam.bottom) / 2;
          cam.left = -h * aspect; cam.right = h * aspect;
        }
        cam.updateProjectionMatrix();
      } else {
        const d = ((radius / Math.sin(FOV / 2)) * 1.05) / S.zoom,
          cy = Math.cos(S.pitch);
        orbit.aspect = aspect;
        orbit.updateProjectionMatrix();
        orbit.position.set(center.x + Math.sin(S.yaw) * cy * d, center.y + Math.sin(S.pitch) * d, center.z + Math.cos(S.yaw) * cy * d);
        orbit.lookAt(center);
      }
      renderer.render(scene, cam);
    },
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
