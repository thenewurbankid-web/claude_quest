/**
 * Boxing Manager AI: the live preview for character creation. One ModelBoxer in a small scene of its own, standing in
 * guard and turning slowly. It never touches a simulation: the pose comes from a fixed, made-up snapshot.
 */
import { loadBabylon } from './arena-babylon.js';
import { loadBoxerAssets, ModelBoxer, PHOTO_OUTFITS, normalizeLook } from './boxer-model.js';

// What ModelBoxer.pose() reads from a snapshot: standing still, fresh, facing an opponent 1.6 m away.
const ME = { x: 0, y: 0, vx: 0, vy: 0, gasRatio: 1, health: 100, activePunch: null };
const OPP = { x: 0, y: 1.6, vx: 0, vy: 0, gasRatio: 1, health: 100, activePunch: null };

/** Mounts the preview in `parent`. Resolves with { setLook(look), destroy() }. */
export async function createLookPreview({ parent, look, corner = 'red' }) {
  const B = await loadBabylon();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:none';
  canvas.setAttribute('aria-label', 'Preview of your fighter');
  parent.appendChild(canvas);

  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: true }, true);
  const scene = new B.Scene(engine);
  // The day court's overcast light, so colours read as they will in the fight.
  scene.clearColor = new B.Color4(0.11, 0.14, 0.19, 1);
  scene.ambientColor = new B.Color3(0.35, 0.36, 0.38);
  const hemi = new B.HemisphericLight('fill', new B.Vector3(0, 1, 0), scene);
  hemi.intensity = 1.05; hemi.diffuse = new B.Color3(0.95, 0.97, 1); hemi.groundColor = new B.Color3(0.42, 0.42, 0.42);
  hemi.specular = new B.Color3(0.05, 0.05, 0.05);
  const key = new B.DirectionalLight('key', new B.Vector3(0.25, -1, 0.35), scene);
  key.position = new B.Vector3(-4, 20, -6); key.intensity = 0.35;
  const shadow = new B.ShadowGenerator(1024, key);
  shadow.useBlurExponentialShadowMap = true; shadow.blurKernel = 24; shadow.darkness = 0.25;
  const ground = B.MeshBuilder.CreateDisc('ground', { radius: 1.1, tessellation: 48 }, scene);
  ground.rotation.x = Math.PI / 2; ground.receiveShadows = true;
  ground.material = new B.StandardMaterial('groundM', scene);
  ground.material.diffuseColor = new B.Color3(0.32, 0.33, 0.35); ground.material.specularColor = new B.Color3(0, 0, 0);

  // Framed head to boots, a little off the face; drag to turn, it drifts round on its own when left alone.
  const camera = new B.ArcRotateCamera('cam', Math.PI / 2 - 0.5, 1.42, 2.5, new B.Vector3(0, 0.92, 0), scene);
  camera.lowerRadiusLimit = camera.upperRadiusLimit = 2.5;
  camera.lowerBetaLimit = 1.1; camera.upperBetaLimit = 1.6;
  camera.useAutoRotationBehavior = true;
  camera.autoRotationBehavior.idleRotationSpeed = 0.25;
  camera.attachControl(canvas, true);
  camera.inputs.removeByType('ArcRotateCameraMouseWheelInput');

  const assets = await loadBoxerAssets(B, scene);
  let boxer = null, owned = [];
  // ModelBoxer.dispose() also disposes textures, and the skin textures are shared through `assets`, so a rebuild
  // removes the meshes and only the materials and painted texture this boxer made.
  const teardown = () => {
    boxer.rig.holder.dispose(false, false);
    for (const m of Object.values(boxer.extras)) m.dispose(false, false);
    for (const r of owned) r.dispose(false, false);
    boxer.painted?.then((tex) => tex?.dispose());
  };
  const build = (l) => {
    if (boxer) teardown();
    const before = new Set(scene.materials);
    const outfit = normalizeLook(l, PHOTO_OUTFITS[corner]);
    boxer = new ModelBoxer(B, scene, assets, corner, shadow, { glove: outfit.wraps, trunks: '#9e1c24', wraps: true, outfit });
    // Instancing adds the container's shared PBR materials to the scene too; those must outlive every rebuild.
    owned = scene.materials.filter((m) => !before.has(m) && !assets.boxer.materials.includes(m));
  };
  build(look);

  let time = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    time += dt;
    boxer.pose(ME, OPP, 0, 0, dt, time);
  });
  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  const ro = new ResizeObserver(onResize);
  ro.observe(parent);

  // Clicking through swatches rebuilds the rig each time; a short wait keeps that to one rebuild per settle.
  let pending = null;
  return {
    setLook(l) { clearTimeout(pending); pending = setTimeout(() => build(l), 120); },
    destroy() { clearTimeout(pending); ro.disconnect(); engine.stopRenderLoop(); scene.dispose(); engine.dispose(); canvas.remove(); },
  };
}
