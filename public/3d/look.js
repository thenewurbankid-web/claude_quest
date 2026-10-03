// Tuned look for the 3D view, from the Ember Hollow Sprite Lab (user's settings, 2026-10-02 night). Light and lens values
// are multipliers on the day/night formulas in scene.js; camera values are world units. light.moon (added after the lab)
// lifts the night so people stay readable; 0 restores the old, much darker night.
export const LOOK = {
  camera: { height: 9.2, back: 17, fov: 32, follow: 10 },
  light: { sun: 1.5, sunAz: -6, sky: 0.45, fire: 0.55, fireReach: 4, exposure: 0.85, shadowSoft: 2.25, moon: 1.8 },
  lens: { bloom: 1.05, tilt: 0.8, focus: 0.65, vignette: 0.17, warmth: 0.055, saturation: 0.92, contrast: 1.06 },
  move: { walk: 4.6, npcPace: 0.6 },
  // '3d' = KayKit Adventurers (CC0, rigged, turn to face any way); 'pixel' = Sunnyside sprites. ?chars=pixel overrides.
  // Models and height live in assets/3d/manifest.json. idleAfter: seconds standing still before idle (breathing) starts.
  characters: '3d',
  people: { keepers: 3, animSpeed: 1.75, turn: 14, blend: 0.55, idleAfter: 2.75 },
  // Pixel sprites (pixel people and the animals). "face" turns sprites fully toward the camera.
  sprite: { height: 1.35, facing: 'face', fps: 4, selfLight: 1, shadow: 'sun', blob: 0, receiveShadows: true },
  animals: { count: 3, kinds: ['Chicken', 'Duck'], scale: 0.85, pace: 0.3, fps: 3 },
  // contact: the tree's own ground shadow, kept separate from sprite.blob so trees never float.
  trees: { kind: 'mixed', scale: 1.2, density: 0.27, ring: 4, inside: 4, fadeTo: 0.55, contact: 0.45 },
  // Off: the crowns have no trunks, and near the ground (the lab's 0.5) they read as floating trees.
  canopy: { on: false, height: 0.5, scale: 1.15, density: 0.33, gap: 0, brightness: 0.9 },
  // Sunnyside's small houses, folded: scale 1 = 2 cells wide; roofTilt is the roof's lean back from upright, in degrees.
  houses: { scale: 0.85, lodge: 1.4, roofTilt: 58 },
  // The Ember Well: Sunnyside's stone well, folded the same way (tilt: how far its rim leans back toward flat).
  well: { scale: 1.15, tilt: 72 },
  clouds: { wispHeight: 9.4 },
  // flowers / tufts: share of plain grass cells that get a stray flower or grass tuft painted on.
  ground: { brightness: 0.56, flowers: 0.07, tufts: 0.1 },
  water: { opacity: 1, flow: 0.67 },
};
