// 3D model viewer: orbit, fit-to-view, a ground grid, and the model's animation clips. KayKit characters keep their
// clips in separate rig files (manifest.animations); when a model has a skeleton those shared clips are offered too,
// keeping only clips whose bones the model actually has.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createModelView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3328, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun, sun.target);
  const grid = new THREE.GridHelper(10, 20, 0x5a6390, 0x2c3350);
  scene.add(grid);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  const loader = new GLTFLoader();
  const clock = new THREE.Clock();
  let root = null, mixer = null, current = null, skeletonHelper = null, speed = 1;

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    mixer?.update(dt * speed);
    controls.update();
    renderer.render(scene, camera);
  });

  function frame(obj) {
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 0.1);
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y; // stand on the grid, centred
    grid.scale.setScalar(Math.max(0.2, r / 3)); floor.scale.setScalar(Math.max(0.2, r / 3));
    camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix();
    controls.target.set(0, size.y / 2, 0);
    camera.position.set(r * 1.2, size.y / 2 + r * 0.55, r * 1.9);
    sun.position.set(r * 2, r * 4, r * 2.5); sun.shadow.camera.left = sun.shadow.camera.bottom = -r * 2;
    sun.shadow.camera.right = sun.shadow.camera.top = r * 2; sun.shadow.camera.far = r * 12; sun.shadow.camera.updateProjectionMatrix();
    controls.update();
    return size;
  }

  let sharedClips = null;
  async function libraryClips(files) {
    if (!sharedClips) sharedClips = Promise.all(files.map(f => loader.loadAsync(f).then(g => g.animations.map(a => Object.assign(a, { source: f.split('/').pop() }))).catch(() => []))).then(a => a.flat());
    return sharedClips;
  }

  return {
    // Loads a model from a URL. Returns { clips, info }. rigFiles: URLs of shared animation files.
    async load(url, rigFiles = []) {
      if (root) { scene.remove(root); mixer?.stopAllAction(); mixer = null; current = null; }
      if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper = null; }
      const g = await loader.loadAsync(url);
      root = g.scene;
      let tris = 0, meshes = 0, bones = new Set();
      root.traverse(o => {
        if (o.isMesh) { meshes++; o.castShadow = true; const gm = o.geometry; tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; }
        if (o.isBone) bones.add(o.name);
      });
      scene.add(root);
      const size = frame(root);
      if (!meshes && bones.size) { skeletonHelper = new THREE.SkeletonHelper(root); scene.add(skeletonHelper); }
      const own = g.animations.map(a => Object.assign(a, { source: 'this file' }));
      let shared = [];
      if (bones.size && rigFiles.length) {
        const ownNames = new Set(own.map(a => a.name));
        shared = (await libraryClips(rigFiles)).filter(a => !ownNames.has(a.name) && a.tracks.some(t => bones.has(t.name.split('.')[0])));
      }
      mixer = new THREE.AnimationMixer(root);
      return { clips: [...own, ...shared], info: { meshes, tris: Math.round(tris), bones: bones.size, size } };
    },
    play(clip, loop = true) {
      if (!mixer) return;
      const next = mixer.clipAction(clip);
      next.reset(); next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); next.clampWhenFinished = true;
      if (current && current !== next) next.crossFadeFrom(current, 0.25, false);
      next.play(); current = next;
    },
    stop() { mixer?.stopAllAction(); current = null; },
    setSpeed(s) { speed = s; },
    toggleGrid(v) { grid.visible = v; },
    reframe() { if (root) { root.position.set(0, 0, 0); frame(root); } },
    clear() { if (root) scene.remove(root); root = null; mixer = null; },
  };
}
