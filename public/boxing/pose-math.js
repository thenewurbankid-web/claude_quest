// Boxing Manager AI: small vector helpers and two-bone IK for the 3D view. Plain objects {x, y, z}; no WebGL, so tests
// can run it in Node.

export const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, s) => v(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.sqrt(dot(a, a));
export const norm = (a) => { const l = len(a) || 1; return v(a.x / l, a.y / l, a.z / l); };
export const lerp = (a, b, t) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const bez = (a, b, c, t) => lerp(lerp(a, b, t), lerp(b, c, t), t);
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const smooth = (t) => t * t * (3 - 2 * t);
export const UP = v(0, 1, 0);

/** Rotates p around the axis through `pivot` along unit `axis` by `ang` (Rodrigues). */
export function rotateAbout(p, pivot, axis, ang) {
  const q = sub(p, pivot), c = Math.cos(ang), s = Math.sin(ang);
  const cr = v(axis.y * q.z - axis.z * q.y, axis.z * q.x - axis.x * q.z, axis.x * q.y - axis.y * q.x);
  const out = add(add(mul(q, c), mul(cr, s)), mul(axis, dot(axis, q) * (1 - c)));
  return add(out, pivot);
}

/** Two-bone IK: the middle joint for a chain root → mid → end with lengths a, b, bending toward `pole`. */
export function solveTwoBone(root, target, a, b, pole) {
  const toT = sub(target, root);
  const d = clamp(len(toT), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = norm(toT);
  const end = add(root, mul(dir, d));
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  let n = sub(pole, mul(dir, dot(pole, dir)));
  n = len(n) < 1e-4 ? v(0, -1, 0) : norm(n);
  const mid = add(add(root, mul(dir, a * cosA)), mul(n, a * Math.sqrt(1 - cosA * cosA)));
  return { mid, end };
}

