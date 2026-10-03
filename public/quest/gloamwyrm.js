// The Gloamwyrm's placeholder art (R2; CC0 art comes later, PLAN-engine.md "Missing art"): a serpent of Haze in its own
// small Three.js stage, drawn into a host element by the battle box. Plain shapes only: a tube body that sways, a head
// with horns and two lamp eyes, and a cloud of Haze motes. Its size follows the weighted score (boss.js, bossSize).
import * as THREE from 'three';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SEGMENTS = 14;

/**
 * @param {HTMLElement} host  the stage fills it and follows its size
 * @param {{ size?: number }} opts
 * @returns {{ setSize: (s: number) => void, hit: (power?: number) => void, windup: () => void, fall: () => void,
 *   dispose: () => void }}
 */
export function mountGloamwyrm(host, { size = 1 } = {}) {
  const calm = reducedMotion();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a1530, 0.06);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 2.4, 9);
  camera.lookAt(0, 1.6, 0);
  scene.add(new THREE.HemisphereLight(0x8a7fd0, 0x1b1426, 1.1));
  const rim = new THREE.DirectionalLight(0xffd59a, 1.4);
  rim.position.set(-3, 5, -4);
  scene.add(rim);
  const front = new THREE.DirectionalLight(0x9fb6ff, 0.6);
  front.position.set(2, 3, 6);
  scene.add(front);

  // The ground: a dark disc with a faint ring where the Haze pools.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: 0x221c33, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const wyrm = new THREE.Group();
  scene.add(wyrm);
  const skin = new THREE.MeshStandardMaterial({ color: 0x4b3a78, roughness: 0.55, metalness: 0.1, flatShading: true,
    emissive: 0x1a0f33, emissiveIntensity: 0.6 });
  const belly = new THREE.MeshStandardMaterial({ color: 0x8c7bb8, roughness: 0.7, flatShading: true });

  // Body: a tube along a curve rebuilt each frame as it sways.
  const spine = Array.from({ length: SEGMENTS }, () => new THREE.Vector3());
  const placeSpine = t => {
    for (let i = 0; i < SEGMENTS; i++) {
      const u = i / (SEGMENTS - 1);
      const sway = calm ? 0 : Math.sin(t * 1.3 - u * 4) * 0.35 * (1 - u * 0.4);
      spine[i].set(Math.sin(u * 5.2) * 1.6 * (1 - u) + sway, 0.35 + u * 2.6 + Math.sin(u * Math.PI) * 0.4, -u * 1.2 + Math.cos(u * 4) * 0.6);
    }
  };
  placeSpine(0);
  let body = null;
  const buildBody = () => {
    const curve = new THREE.CatmullRomCurve3(spine);
    const geo = new THREE.TubeGeometry(curve, 48, 0.42, 7, false);
    // Taper towards the tail (the start of the curve).
    const pos = geo.attributes.position, c = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / 8), u = ring / 48;
      curve.getPointAt(Math.min(1, u), c);
      p.fromBufferAttribute(pos, i).sub(c).multiplyScalar(0.25 + 0.75 * Math.sqrt(u)).add(c);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    geo.computeVertexNormals();
    if (body) { body.geometry.dispose(); body.geometry = geo; } else { body = new THREE.Mesh(geo, skin); wyrm.add(body); }
  };
  buildBody();

  // Head, horns, jaw and eyes.
  const head = new THREE.Group();
  wyrm.add(head);
  const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), skin);
  skull.scale.set(1, 0.8, 1.25);
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 6), belly);
  jaw.rotation.x = Math.PI / 2;
  jaw.position.set(0, -0.22, 0.55);
  head.add(jaw);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0xd8cfae, flatShading: true }));
    horn.position.set(0.32 * s, 0.45, -0.25);
    horn.rotation.set(-0.7, 0, -0.45 * s);
    head.add(horn);
  }
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc35a });
  const eyes = [-1, 1].map(s => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeMat);
    e.position.set(0.26 * s, 0.12, 0.58);
    head.add(e);
    return e;
  });
  const eyeLight = new THREE.PointLight(0xffb347, 2.5, 4);
  eyeLight.position.set(0, 0.1, 0.9);
  head.add(eyeLight);

  // Haze motes drifting around it.
  const MOTES = 220;
  const motePos = new Float32Array(MOTES * 3), seeds = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 3.8;
    motePos.set([Math.cos(a) * r, Math.random() * 4.5, Math.sin(a) * r - 0.5], i * 3);
    seeds[i] = Math.random() * 10;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xb9a8ff, size: 0.09, transparent: true,
    opacity: 0.55, depthWrite: false }));
  scene.add(motes);

  // ---------- motion ----------
  let target = size, shown = size, flash = 0, recoil = 0, coil = 0, falling = 0, raf = 0, last = performance.now(), t = 0;
  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep it whole on narrow screens: pull back when the stage is tall.
    camera.position.z = 9 * Math.max(1, 0.9 / camera.aspect);
    camera.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  resize();

  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    shown += (target - shown) * Math.min(1, dt * 3);
    flash = Math.max(0, flash - dt * 2.5);
    recoil = Math.max(0, recoil - dt * 2);
    coil = Math.max(0, coil - dt * 0.8);
    placeSpine(t);
    buildBody();
    const tip = spine[SEGMENTS - 1], before = spine[SEGMENTS - 2];
    head.position.copy(tip);
    head.lookAt(new THREE.Vector3(0, tip.y - 0.4, 9));
    head.position.addScaledVector(tip.clone().sub(before).normalize(), 0.3);
    head.position.z -= recoil * 0.8;
    head.position.y += coil * 0.5;
    jaw.rotation.x = Math.PI / 2 + (calm ? 0 : Math.max(0, Math.sin(t * 2)) * 0.15) + coil * 0.4;
    const s = shown * (1 - Math.min(1, falling) * 0.15);
    wyrm.scale.setScalar(s);
    wyrm.rotation.z = calm ? 0 : Math.sin(t * 0.7) * 0.03;
    if (falling) {
      falling = Math.min(1.6, falling + dt * 0.8);
      wyrm.position.y = -Math.min(1, falling) * 2.2 * s;
      wyrm.rotation.x = Math.min(1, falling) * 0.5;
    }
    if (!calm && recoil) wyrm.position.x = Math.sin(t * 60) * recoil * 0.08;
    skin.emissive.setRGB(0.1 + flash * 0.9, 0.06 + flash * 0.8, 0.2 + flash * 0.6);
    const lit = falling ? Math.max(0, 1 - falling) : 1;
    eyeMat.color.setRGB(1 * lit, (0.76 + coil * 0.2) * lit, 0.35 * lit);
    eyeLight.intensity = 2.5 * lit + coil * 3;
    const p = moteGeo.attributes.position;
    for (let i = 0; i < MOTES; i++) {
      let y = p.getY(i) + dt * (0.15 + (seeds[i] % 1) * 0.2) * (calm ? 0.3 : 1);
      if (y > 4.6) y = 0;
      p.setY(i, y);
    }
    p.needsUpdate = true;
    motes.material.opacity = 0.55 * (falling ? Math.max(0, 1 - falling / 1.6) : 1);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    setSize(v) { target = v; },
    hit(power = 1) { flash = Math.min(1, 0.6 + power * 0.4); recoil = calm ? 0 : 1; },
    windup() { coil = 1; },
    fall() { falling = falling || 0.01; },
    dispose() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
