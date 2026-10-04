// BOX-17: the fixed medium camera shared by the plate screenshot (dev-plate.html), the Blender fighter render
// (scripts/render-fighters.py reads it through scripts/render-plate.mjs's camera.json) and the 2D compositor.
// Babylon world, metres; red and blue stand on the x axis either side of the origin, facing each other.
export const FRAME = { w: 540, h: 960 };        // logical portrait frame (px); plates and sprites are rendered at RENDER_SCALE x this
export const RENDER_SCALE = 1.5;
export const CAMERA = { pos: [0, 1.5, -3.6], target: [0, 0.8, 0], hfov: 0.56 };   // hfov: horizontal field of view (rad)
export const GAP_REF = 1.1;                      // fighter spacing (m) the sprites were rendered at

/** Pixels per metre on the fighters' plane (z = 0) in the logical frame. */
export function pxPerMetre() {
  const dist = Math.hypot(CAMERA.pos[2], CAMERA.pos[1] - CAMERA.target[1]);
  return FRAME.w / (2 * dist * Math.tan(CAMERA.hfov / 2));
}
