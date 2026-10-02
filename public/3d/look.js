// Tuned look for the 3D view, from the Ember Hollow Sprite Lab (2026-10-02). Light and lens values are multipliers on
// the day/night formulas in scene.js; camera values are world units. `sprite` is used once sprites replace placeholders.
export const LOOK = {
  camera: { height: 10.8, back: 12.8, fov: 32, follow: 10 },
  light: { sun: 1.85, sky: 0.45, fire: 1.3, fireReach: 4, exposure: 0.75 },
  lens: { bloom: 0.45, tilt: 1, focus: 0.59, vignette: 0.32, warmth: 0.015 },
  move: { walk: 4.6, npcPace: 0.6 },
  // Sprite lab: "face" turns sprites fully toward the camera (lean is ignored in that mode). Shadow "sun" uses a hidden
  // copy turned toward the sun so the cast shadow keeps its width; blob is the contact shadow's opacity.
  sprite: { height: 1.35, facing: 'face', lean: 30, fps: 4, selfLight: 0.6, shadow: 'sun', blob: 0.4, receiveShadows: false, breathe: true },
};
