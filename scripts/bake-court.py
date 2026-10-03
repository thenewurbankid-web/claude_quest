"""
Boxing Manager AI: the day court, rebuilt in Blender and lit by a baked overcast sky.

Run headless (Blender 5.2):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/bake-court.py -- [--quick] [--samples N]
then `node scripts/build-court.mjs` to compress the result into public/boxing/models/court.glb.

What it does:
- Rebuilds the static court of `buildStreet()` / `buildNewYork()` in public/boxing/arena-babylon.js at the same layout and
  dimensions (all positions below are written in Babylon's coordinates and converted with `C()`), with real window
  recesses, beveled props and photo textures (Poly Haven, CC0; see public/boxing/textures/CREDITS.md).
- Lights it with a CC0 overcast HDRI (bethnal_green_entrance) and bakes Cycles diffuse light (direct + indirect) times a
  little AO. Large surfaces get lightmap atlases on a second UV set ('lm' groups); small parts get the light baked into
  per-corner vertex colours ('vc' groups); the fence is drawn flat.
- Writes assets-src/build/court_raw.glb (plus the lightmaps and sky.png). Materials carry their meaning in extras
  (`tint`, `kind`, `ground`, `alpha`), and the empty `court_info` carries `lmLevel` and the sky colours; the Babylon side
  (`loadBakedCourt` in arena-babylon.js) builds StandardMaterials from those.

Encoding: a lightmap texel stores t = clamp(((E·L) / S)^(1/2.2)), where L is the baked light, S the headroom, and E the
exposure that brings the middle of the court to `--court` (1.35: the procedural day scene's hemi + key gave the court
about 1.35 × its albedo in gamma space). StandardMaterial works in gamma space, so albedo × t × S^(1/2.2) is the lit
colour; `lmLevel` = S^(1/2.2). Vertex colours store the same t, and the Babylon side multiplies them by `lmLevel` with a
1×1 white lightmap.
"""
import bpy, bmesh, math, os, sys, random, json
import numpy as np
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'public', 'boxing', 'textures')
SRC = os.path.join(ROOT, 'assets-src', 'polyhaven')
OUT = os.path.join(ROOT, 'assets-src', 'build')
os.makedirs(OUT, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
QUICK = '--quick' in argv
SAMPLES = arg('--samples', 24 if QUICK else 384)
LM_SIZE = {'ground': 2048, 'walls': 2048, 'props': 1024}
if QUICK: LM_SIZE = {k: v // 4 for k, v in LM_SIZE.items()}
EXPOSURE = 1.0                          # the sky dome: the open sky's mean comes out at this
COURT = arg('--court', 1.35)            # the middle of the court comes out at this × albedo (gamma space)
HEADROOM = 4.0                          # S above
HDRI = os.path.join(SRC, 'bethnal_green_entrance_1k.hdr')

# The layout, from arena-babylon.js.
YARD, WALL_H, FLOORS = 13.0, 17.0, 5      # LOOK.yardM, LOOK.wallH, LOOK.floors
FENCE, BASELINE = 9.6, 9.0                # COURT.half, COURT.baselineZ
CURB_IN, CURB_H = YARD - 2.2, 0.15        # the sidewalk runs from the curb to the walls
COLS = [-YARD + 2 + 3.1 * k for k in range(8)]
def floor_y(f): return 4.4 + f * 2.6

rand = random.Random(21)

# ─── Coordinates ──────────────────────────────────────────────────────────────
# Babylon is left-handed, y up. The glTF exporter maps Blender (x, y, z) to glTF (x, z, −y), and Babylon's glTF loader
# maps glTF (x, y, z) to (−x, y, z) (its __root__ flips handedness). So Babylon (X, Y, Z) is Blender (−X, −Z, Y).
def C(p): return Vector((-p[0], -p[2], p[1]))
def B(p): return Vector((-p[0], p[2], -p[1]))       # the inverse
def V(x, y, z): return Vector((x, y, z))
UP = V(0, 1, 0)

def wall_frame(side):
    """A wall's axes, as in buildStreet: `fwd` points from the centre to the wall, `right` along it."""
    yaw = side * math.pi / 2
    fwd = V(round(math.sin(yaw), 6), 0, round(math.cos(yaw), 6))
    return fwd, V(fwd.z, 0, -fwd.x)

def on_wall(side, along, up, out=0.0):
    fwd, right = wall_frame(side)
    return fwd * (YARD - out) + right * along + V(0, up, 0)

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex3(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]

# ─── Materials ────────────────────────────────────────────────────────────────
# name: (tint, texture or None, tile metres). Tints and textures are the ones the procedural court uses.
MATS = {
    'asphalt':  ('#8f8f8f', 'asphalt', 4.0),
    'court':    ('#c4c6c6', 'asphalt', 3.0),
    'sidewalk': ('#b9b6b0', 'sidewalk', 2.0),
    'curb':     ('#a9a7a2', 'concrete', 1.5),
    'brick':    ('#d9c2b4', 'brick_red', 2.4),
    'reveal':   ('#c9b4a6', 'brick_red', 2.4),
    'glass':    ('#2a3036', None, 1),
    'frame':    ('#e8e2d6', None, 1),
    'stone':    ('#b9ab95', 'concrete', 1.5),
    'cornice':  ('#4a4038', 'concrete', 2.0),
    'roof':     ('#2a2a2e', 'concrete', 3.0),
    'ac':       ('#cfd0cc', None, 1),
    'bars':     ('#16171a', None, 1),
    'pipe':     ('#3b3f45', None, 1),
    'door':     ('#5a5e63', None, 1),
    'iron':     ('#121316', None, 1),
    'post':     ('#1d1f22', None, 1),
    'fence':    ('#5a5c60', 'chainlink', 0.222),
    'steel':    ('#2a2d31', None, 1),
    'board':    ('#e4e4e0', None, 1),
    'square':   ('#c94a2a', None, 1),
    'rim':      ('#d9531e', None, 1),
    'net':      ('#b8bcc0', None, 1),
    'bark':     ('#8a7a6a', 'bark', 1.0),
    'leafA':    ('#8c9a3e', None, 1), 'leafB': ('#b5a542', None, 1), 'leafC': ('#6f7a35', None, 1),
    'lamppole': ('#2c3a33', None, 1),
    'lamphead': ('#c9c4b8', None, 1),
    'carRed':   ('#7a1018', None, 1),
    'carTaxi':  ('#f2b90f', None, 1),
    'carGlass': ('#1a1f26', None, 1),
    'tyre':     ('#0d0d0f', None, 1),
    'checker':  ('#111111', None, 1),
    'headlight': ('#d9dde2', None, 1),
    'taillight': ('#7a1a1a', None, 1),
    'taxiSign': ('#f4efe0', None, 1),
    'dumpster': ('#6f8a74', 'rust', 1.5),
    'pallet':   ('#6b5034', None, 1),
    'manhole':  ('#2a2b2e', None, 1),
    'wood':     ('#5b4330', None, 1),
    'awning':   ('#1f4d36', None, 1),
    'shopdoor': ('#2a1f18', None, 1),
    'hydrant':  ('#b81d1d', None, 1),
    'hydrantCap': ('#e8c21a', None, 1),
    'bag':      ('#101114', None, 1),
    'stackO':   ('#ff6a13', None, 1), 'stackW': ('#f4f4f0', None, 1),
    'globe':    ('#3dd66b', None, 1),
}
TEXFILES = {
    'asphalt': (os.path.join(TEX, 'asphalt_diff.webp'), os.path.join(TEX, 'asphalt_nor.webp')),
    'sidewalk': (os.path.join(TEX, 'sidewalk_diff.webp'), os.path.join(TEX, 'sidewalk_nor.webp')),
    'brick_red': (os.path.join(TEX, 'brick_red_diff.webp'), os.path.join(TEX, 'brick_red_nor.webp')),
    'rust': (os.path.join(TEX, 'rust_diff.webp'), os.path.join(TEX, 'rust_nor.webp')),
    'concrete': (os.path.join(SRC, 'concrete_wall_008_diff_1k.jpg'), os.path.join(SRC, 'concrete_wall_008_nor_gl_1k.jpg')),
    'bark': (os.path.join(SRC, 'bark_brown_02_diff_1k.jpg'), os.path.join(SRC, 'bark_brown_02_nor_gl_1k.jpg')),
    'chainlink': (os.path.join(OUT, 'chainlink.png'), None),
}
GROUND_MATS = {'asphalt', 'court', 'sidewalk', 'curb', 'manhole'}

def make_chainlink():
    """The chain-link diamond (same drawing as chainLinkTexture in the JS), RGBA."""
    S = 128
    y, x = np.mgrid[0:S, 0:S]
    d = np.minimum(np.abs(x - y), S - np.abs(x - y))
    e = np.minimum(np.abs(x + y - S + 1), S - np.abs(x + y - S + 1))
    a = np.clip(2.2 - np.minimum(d, e), 0, 1)
    img = bpy.data.images.new('chainlink', S, S, alpha=True)
    img.alpha_mode = 'STRAIGHT'
    px = np.zeros((S, S, 4), np.float32); px[..., 0] = 190 / 255; px[..., 1] = 195 / 255; px[..., 2] = 200 / 255; px[..., 3] = a
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = TEXFILES['chainlink'][0]; img.file_format = 'PNG'; img.save()
    return img

_images = {}
def load_image(path, non_color=False):
    if path not in _images:
        img = bpy.data.images.load(path, check_existing=True)
        if non_color: img.colorspace_settings.name = 'Non-Color'
        _images[path] = img
    return _images[path]

_mats = {}
def material(name, group):
    """One Blender material per (name, group): each group bakes into its own lightmap."""
    key = f'{name}@{group.name}'
    if key in _mats: return _mats[key]
    tint, tex, tile = MATS[name]
    m = bpy.data.materials.new(key)
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.92
    bsdf.inputs['Specular IOR Level'].default_value = 0.25
    lin = [srgb_to_linear(c) for c in hex3(tint)] + [1]
    uv0 = N.new('ShaderNodeUVMap'); uv0.uv_map = 'UV0'
    if tex:
        diff, nor = TEXFILES[tex]
        img = N.new('ShaderNodeTexImage'); img.image = load_image(diff); img.name = 'albedo'
        L.new(uv0.outputs['UV'], img.inputs['Vector'])
        mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.name = 'tint'
        mix.inputs['Factor'].default_value = 1.0; mix.inputs['B'].default_value = lin
        L.new(img.outputs['Color'], mix.inputs['A']); L.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        if tex == 'chainlink':
            L.new(img.outputs['Alpha'], bsdf.inputs['Alpha'])
        if nor:
            nimg = N.new('ShaderNodeTexImage'); nimg.image = load_image(nor, True); nimg.name = 'normalTex'
            L.new(uv0.outputs['UV'], nimg.inputs['Vector'])
            nm = N.new('ShaderNodeNormalMap'); nm.uv_map = 'UV0'; nm.inputs['Strength'].default_value = 0.8
            L.new(nimg.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    else:
        bsdf.inputs['Base Color'].default_value = lin
    if name.startswith('leaf'):
        m.use_backface_culling = False
    else:
        m.use_backface_culling = True
    m['tint'] = hex3(tint)
    m['kind'] = group.kind
    m['ground'] = name in GROUND_MATS
    m['alpha'] = tex == 'chainlink'
    _mats[key] = m
    return m

# ─── Geometry ─────────────────────────────────────────────────────────────────

class Group:
    """One output mesh. kind: 'lm' (lightmap on UV1), 'vc' (baked vertex colours) or 'flat' (unlit)."""
    def __init__(self, name, kind):
        self.name, self.kind = name, kind
        self.bm = bmesh.new()
        self.uv0 = self.bm.loops.layers.uv.new('UV0')
        self.mats = []
        self.cache = {}

    def mat_index(self, name):
        m = material(name, self)
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)

    def vert(self, p, share):
        if not share: return self.bm.verts.new(C(p))
        k = (round(p.x, 4), round(p.y, 4), round(p.z, 4))
        v = self.cache.get(k)
        if v is None: v = self.cache[k] = self.bm.verts.new(C(p))
        return v

    def face(self, pts, n, mat, share=True, uv=None):
        """A polygon from Babylon points, turned to face Babylon normal `n`. UV0 is planar in metres / the tile size."""
        vs = []
        for p in pts:
            v = self.vert(p, share)
            if v not in vs: vs.append(v)
        if len(vs) < 3: return None
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.normal_update()
        if f.normal.dot(C(n)) < 0: f.normal_flip()
        f.material_index = self.mat_index(mat)
        f.smooth = False
        tile = MATS[mat][2]
        n = Vector(n).normalized()
        if uv is None:
            if abs(n.y) > 0.7: u, w = V(1, 0, 0), V(0, 0, 1)
            else:
                u = V(n.z, 0, -n.x)
                u = u.normalized() if u.length > 1e-6 else V(1, 0, 0)
                w = UP
        else:
            u, w = uv
        for loop in f.loops:
            p = B(loop.vert.co)
            loop[self.uv0].uv = (p.dot(u) / tile, p.dot(w) / tile)
        return f

    def quad(self, c, a, b, mat, n=None, share=True):
        """A rectangle centred on c with half-extent vectors a and b; normal a × b unless given."""
        n = n if n is not None else a.cross(b)
        # Babylon is left-handed, so a × b in its coordinates points the other way; `face` sorts the winding out anyway.
        return self.face([c - a - b, c + a - b, c + a + b, c - a + b], n, mat, share, uv=(a.normalized(), b.normalized()))

    def box(self, c, size, mat, axes=(V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)), skip=()):
        r, u, f = axes
        hw, hh, hd = size[0] / 2, size[1] / 2, size[2] / 2
        for n, a, b, d in ((r, u, f, hw), (-r, u, f, hw), (u, r, f, hh), (-u, r, f, hh), (f, r, u, hd), (-f, r, u, hd)):
            if any((n - s).length < 1e-6 for s in skip): continue
            ea = a * (size[0] / 2 if a is r else size[1] / 2 if a is u else size[2] / 2)
            eb = b * (size[0] / 2 if b is r else size[1] / 2 if b is u else size[2] / 2)
            self.face([c + n * d - ea - eb, c + n * d + ea - eb, c + n * d + ea + eb, c + n * d - ea + eb], n, mat, share=False,
                      uv=(a, b) if abs(n.y) <= 0.7 else None)

    def cylinder(self, base, axis, r0, r1, h, mat, seg=12, caps=True):
        axis = axis.normalized()
        a = axis.cross(V(0, 0, 1) if abs(axis.z) < 0.9 else V(1, 0, 0)).normalized()
        b = axis.cross(a).normalized()
        ring = lambda r, y: [base + axis * y + (a * math.cos(t) + b * math.sin(t)) * r for t in (2 * math.pi * i / seg for i in range(seg))]
        lo, hi = ring(r0, 0), ring(r1, h)
        circ = 2 * math.pi * max(r0, r1)
        for i in range(seg):
            j = (i + 1) % seg
            mid = (lo[i] + lo[j] + hi[i] + hi[j]) / 4
            n = (mid - (base + axis * (h / 2)))
            n = n - axis * n.dot(axis)
            f = self.face([lo[i], lo[j], hi[j], hi[i]], n, mat, share=False)
            if f:   # wrap UV0 round the cylinder so bark runs up the trunk
                tile = MATS[mat][2]
                for loop in f.loops:
                    p = B(loop.vert.co) - base
                    ang = math.atan2(p.dot(b), p.dot(a)) % (2 * math.pi)
                    if j == 0 and ang < math.pi / seg: ang += 2 * math.pi
                    loop[self.uv0].uv = (ang / (2 * math.pi) * circ / tile, p.dot(axis) / tile)
        if caps:
            if r0 > 1e-4: self.face(lo, -axis, mat, share=False)
            if r1 > 1e-4: self.face(hi, axis, mat, share=False)

    def ellipsoid(self, c, radii, mat, seg=10, rings=6, yaw=0.0, top_only=False):
        cy, sy = math.cos(yaw), math.sin(yaw)
        def pt(th, ph):
            x, y, z = math.sin(th) * math.cos(ph) * radii[0], math.cos(th) * radii[1], math.sin(th) * math.sin(ph) * radii[2]
            return c + V(x * cy + z * sy, y, -x * sy + z * cy)
        last = rings // 2 if top_only else rings
        for i in range(last):
            t0, t1 = math.pi * i / rings, math.pi * (i + 1) / rings
            for k in range(seg):
                p0, p1 = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
                pts = [pt(t0, p0), pt(t0, p1), pt(t1, p1), pt(t1, p0)]
                mid = sum(pts, V(0, 0, 0)) / 4
                self.face(pts, mid - c, mat, share=False)

    def torus(self, c, axis, R, r, mat, seg=24, side=8):
        axis = axis.normalized()
        a = axis.cross(V(0, 0, 1) if abs(axis.z) < 0.9 else V(1, 0, 0)).normalized()
        b = axis.cross(a).normalized()
        def pt(i, k):
            t, s = 2 * math.pi * i / seg, 2 * math.pi * k / side
            rad = a * math.cos(t) + b * math.sin(t)
            return c + rad * (R + r * math.cos(s)) + axis * (r * math.sin(s)), c + rad * R
        for i in range(seg):
            for k in range(side):
                (p00, c0), (p10, c1), (p11, _), (p01, _) = pt(i, k), pt(i + 1, k), pt(i + 1, k + 1), pt(i, k + 1)
                self.face([p00, p10, p11, p01], (p00 + p11) / 2 - (c0 + c1) / 2, mat, share=False)

    def to_object(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me); self.bm.free()
        for m in self.mats: me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob['kind'] = self.kind
        return ob

ground = Group('court_ground', 'lm')
walls = Group('court_walls', 'lm')
props = Group('court_props', 'lm')
details = Group('court_details', 'vc')
leaves = Group('court_leaves', 'vc')
fence = Group('court_fence', 'flat')

def build_ground():
    F, K, Y = FENCE, CURB_IN, YARD
    ground.quad(V(0, 0, 0), V(F, 0, 0), V(0, 0, F), 'court', n=UP)
    # The street between the fence and the curb, and the sidewalk from the curb to the walls (four trapezoids each).
    for side in range(4):
        fwd, right = wall_frame(side)
        for (r0, r1, y, m) in ((F, K, 0.0, 'asphalt'), (K, Y + 0.3, CURB_H, 'sidewalk')):
            pts = [fwd * r0 - right * r0, fwd * r0 + right * r0, fwd * r1 + right * r1, fwd * r1 - right * r1]
            ground.face([p + V(0, y, 0) for p in pts], UP, m)
        # The curb's face.
        ground.face([fwd * K - right * K, fwd * K + right * K, fwd * K + right * K + V(0, CURB_H, 0), fwd * K - right * K + V(0, CURB_H, 0)], -fwd, 'curb')
    ground.cylinder(V(-10.2, 0, 3.5), UP, 0.4, 0.4, 0.01, 'manhole', seg=20)

def build_walls():
    Y, H = YARD, WALL_H
    hw, hh, depth = 0.625, 0.875, 0.15             # window opening half-sizes; recess depth
    for side in range(4):
        fwd, right = wall_frame(side)
        P = lambda a, y, d=0.0: fwd * (Y + d) + right * a + V(0, y, 0)
        holes = []
        for f in range(FLOORS):
            for a in COLS:
                if side == 0 and f == 0 and a < -2: continue      # above the shop
                holes.append((a, floor_y(f)))
        xs = sorted({-Y - 0.3, Y + 0.3} | {round(a + s * hw, 4) for a, _ in holes for s in (-1, 1)})
        ys = sorted({0.0, H} | {round(y + s * hh, 4) for _, y in holes for s in (-1, 1)})
        hole_set = set(holes)
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                if any(abs(cx - a) < hw and abs(cy - y) < hh for a, y in hole_set): continue
                walls.face([P(xs[i], ys[j]), P(xs[i + 1], ys[j]), P(xs[i + 1], ys[j + 1]), P(xs[i], ys[j + 1])], -fwd, 'brick',
                           uv=(right, UP))
        for a, y in holes:
            x0, x1, y0, y1 = a - hw, a + hw, y - hh, y + hh
            walls.face([P(x0, y1), P(x1, y1), P(x1, y1, depth), P(x0, y1, depth)], -UP, 'reveal')          # head
            walls.face([P(x0, y0), P(x1, y0), P(x1, y0, depth), P(x0, y0, depth)], UP, 'reveal')           # sill
            walls.face([P(x0, y0), P(x0, y1), P(x0, y1, depth), P(x0, y0, depth)], right, 'reveal', uv=(fwd, UP))
            walls.face([P(x1, y0), P(x1, y1), P(x1, y1, depth), P(x1, y0, depth)], -right, 'reveal', uv=(fwd, UP))
            # The window: a painted frame round dark glass, and the sash's meeting rail across the middle.
            fw = 0.1
            for (ax0, ax1, ay0, ay1) in ((x0, x1, y1 - fw, y1), (x0, x1, y0, y0 + fw), (x0, x0 + fw, y0 + fw, y1 - fw), (x1 - fw, x1, y0 + fw, y1 - fw)):
                walls.face([P(ax0, ay0, depth), P(ax1, ay0, depth), P(ax1, ay1, depth), P(ax0, ay1, depth)], -fwd, 'frame')
            walls.face([P(x0 + fw, y0 + fw, depth + 0.02), P(x1 - fw, y0 + fw, depth + 0.02), P(x1 - fw, y1 - fw, depth + 0.02), P(x0 + fw, y1 - fw, depth + 0.02)], -fwd, 'glass')
            walls.box(P(a, y + 0.05, depth - 0.02), (2 * (hw - fw), 0.06, 0.06), 'frame', axes=(right, UP, fwd))
        # Cornice along the roofline, and the dark roofs beyond so the rooftop camera sees an edge.
        walls.box(P(0, H - 0.2, -0.25), (2 * Y + 0.6, 0.45, 0.5), 'cornice', axes=(right, UP, fwd))
        walls.box(P(0, H + 0.05, -0.375 + 0.05), (2 * Y + 0.6, 0.12, 0.75), 'cornice', axes=(right, UP, fwd))
        walls.quad(P(0, H, 3), right * (Y + 6), fwd * 3, 'roof', n=UP)
        # Roller doors on the other three walls.
        if side != 0:
            d = -5 + side * 2.5
            walls.quad(P(d, 1.4, -0.03), right * 1.6, UP * 1.4, 'door', n=-fwd)
            for k in range(14):
                walls.box(P(d, 0.1 + k * 0.2, -0.04), (3.2, 0.03, 0.02), 'door', axes=(right, UP, fwd))

def build_wall_details():
    Y, H = YARD, WALL_H
    for side in range(4):
        fwd, right = wall_frame(side)
        ax = (right, UP, fwd)
        P = lambda a, y, out: fwd * (Y - out) + right * a + V(0, y, 0)
        for f in range(FLOORS):
            for a in COLS:
                if side == 0 and f == 0 and a < -2: continue
                up = floor_y(f)
                details.box(P(a, up + 0.98, 0.04), (1.5, 0.2, 0.08), 'stone', axes=ax)
                details.box(P(a, up - 0.9, 0.07), (1.35, 0.08, 0.14), 'stone', axes=ax)
                if rand.random() < 0.3:
                    details.box(P(a + 0.1, up - 0.6, 0.3), (0.66, 0.42, 0.55), 'ac', axes=ax)
                if f == 0:
                    for k in range(7):
                        details.box(P(a - 0.45 + k * 0.15, up, 0.12), (0.025, 1.55, 0.025), 'bars', axes=ax)
        details.cylinder(P(7.5 - side, 0, 0.1), UP, 0.06, 0.06, H, 'pipe', seg=8)
    # Fire escapes (the columns are indexed as in buildNewYork).
    for side, k in ((1, 2), (1, 6), (3, 3), (3, 7), (0, 5), (0, 7), (2, 1), (2, 5)):
        fwd, right = wall_frame(side)
        ax = (right, UP, fwd)
        a = -Y + 2 + 3.1 * k
        P = lambda al, y, out: fwd * (Y - out) + right * al + V(0, y, 0)
        for f in range(FLOORS):
            y = floor_y(f) - 0.95
            # A slatted deck rather than a slab, so light falls through as it does through the real grating.
            for s in range(9):
                details.box(P(a, y, 0.06 + s * 0.095), (2.2, 0.03, 0.05), 'iron', axes=ax)
            details.box(P(a, y + 0.9, 0.86), (2.2, 0.04, 0.04), 'iron', axes=ax)
            details.box(P(a, y + 0.45, 0.86), (2.2, 0.03, 0.03), 'iron', axes=ax)
            for dx in (-1.08, -0.72, -0.36, 0, 0.36, 0.72, 1.08):
                details.box(P(a + dx, y + 0.45, 0.86), (0.025, 0.9, 0.025), 'iron', axes=ax)
            for dx in (-1.1, 1.1):
                details.box(P(a + dx, y + 0.9, 0.45), (0.04, 0.04, 0.85), 'iron', axes=ax)
                details.box(P(a + dx, y + 0.45, 0.45), (0.025, 0.9, 0.025), 'iron', axes=ax)
            if f < FLOORS - 1:
                # The stair between decks, slanting in the wall's plane: two stringers and treads.
                t = 0.5
                dirv = (right * math.sin(t) + UP * math.cos(t)).normalized()
                ortho = (right * math.cos(t) - UP * math.sin(t)).normalized()
                c = P(a + 0.55, y + 1.3, 0.7)
                for s in (-0.22, 0.22):
                    details.box(c + ortho * s, (0.04, 2.9, 0.05), 'iron', axes=(ortho, dirv, fwd))
                for s in range(10):
                    details.box(c + dirv * (-1.3 + s * 0.29), (0.44, 0.02, 0.12), 'iron', axes=(ortho, dirv, fwd))
        drop = P(a - 0.6, floor_y(0) - 0.95 - 0.8, 0.8)
        for s in (-0.2, 0.2): details.box(drop + right * s, (0.03, 1.6, 0.03), 'iron', axes=ax)
        for s in range(6): details.box(drop + V(0, -0.7 + s * 0.28, 0), (0.42, 0.02, 0.02), 'iron', axes=ax)

def build_fence():
    F = FENCE
    for side in range(4):
        fwd, right = wall_frame(side)
        fence.quad(fwd * F + V(0, 2.1, 0), right * F, UP * 2.1, 'fence', n=-fwd)
        details.cylinder(fwd * F - right * F + V(0, 4.2, 0), right, 0.025, 0.025, 2 * F, 'post', seg=6, caps=False)
        details.cylinder(fwd * F - right * F + V(0, 0.05, 0), right, 0.02, 0.02, 2 * F, 'post', seg=6, caps=False)
        a = -F
        while a < F:
            details.cylinder(fwd * F + right * a, UP, 0.035, 0.035, 4.3, 'post', seg=8)
            a += 3.2

def build_hoop():
    hz = BASELINE
    details.cylinder(V(0, 0, hz + 0.25), UP, 0.08, 0.08, 3.4, 'steel', seg=12)
    pts = [V(0, 3.35, hz + 0.25), V(0, 3.75, hz + 0.05), V(0, 3.85, hz - 0.35)]
    for p, q in zip(pts, pts[1:]):
        details.cylinder(p, q - p, 0.07, 0.07, (q - p).length, 'steel', seg=10)
    details.box(V(0, 3.55, hz - 0.4), (1.8, 1.05, 0.04), 'board')
    details.box(V(0, 3.55, hz - 0.37), (1.86, 1.11, 0.03), 'steel')
    for (w, h, m, dz) in ((0.59, 0.45, 'square', 0.425), (0.53, 0.39, 'board', 0.426)):
        details.quad(V(0, 3.3, hz - dz), V(w / 2, 0, 0), V(0, h / 2, 0), m, n=V(0, 0, -1), share=False)
    details.torus(V(0, 3.05, hz - 0.65), UP, 0.23, 0.011, 'rim')
    details.box(V(0, 3.05, hz - 0.45), (0.12, 0.02, 0.15), 'rim')
    # The chain net: twelve strands from the rim down to a narrower ring.
    for i in range(12):
        t = 2 * math.pi * i / 12
        top = V(math.cos(t) * 0.22, 3.04, hz - 0.65 + math.sin(t) * 0.22)
        bot = V(math.cos(t + 0.3) * 0.14, 2.62, hz - 0.65 + math.sin(t + 0.3) * 0.14)
        details.cylinder(top, bot - top, 0.005, 0.005, (bot - top).length, 'net', seg=4, caps=False)
    details.torus(V(0, 2.62, hz - 0.65), UP, 0.14, 0.005, 'net', seg=16, side=4)

def build_trees():
    leaf_mats = ('leafA', 'leafB', 'leafC')
    for (x, z) in ((-6, 11.4), (4.5, 11.4), (-11.4, -3), (11.4, 2.5), (-11.4, 7.5), (9, -11.4), (-4, -11.4)):
        h = 5.5 + rand.random() * 2
        base = V(x, CURB_H, z)
        details.cylinder(base, UP, 0.11, 0.05, h, 'bark', seg=10)
        details.cylinder(base + V(0, -0.005, 0), UP, 0.65, 0.65, 0.01, 'manhole', seg=4)       # the tree pit
        for i in range(7):
            a, tilt = rand.random() * math.tau, 0.45 + rand.random() * 0.55
            ln, y0 = 1.3 + rand.random() * 1.5, h * (0.5 + rand.random() * 0.4)
            d = V(math.cos(a) * math.sin(tilt), math.cos(tilt), math.sin(a) * math.sin(tilt))
            root = base + V(0, y0, 0)
            details.cylinder(root, d, 0.045, 0.012, ln, 'bark', seg=6, caps=False)
            # Sparse autumn leaves: small double-sided cards scattered round the outer half of the branch.
            for k in range(70):
                f = 0.35 + rand.random() * 0.75
                c = root + d * (ln * f) + V((rand.random() - 0.5) * 0.9, (rand.random() - 0.3) * 0.6, (rand.random() - 0.5) * 0.9)
                n = V(rand.random() - 0.5, rand.random() * 0.8 + 0.2, rand.random() - 0.5).normalized()
                ta = n.cross(V(0.3, 0.1, 0.9)).normalized(); tb = n.cross(ta).normalized()
                s = 0.06 + rand.random() * 0.05
                leaves.quad(c, ta * s, tb * s * 0.7, leaf_mats[rand.randrange(3)], n=n, share=False)

def build_street_furniture():
    Y, H = YARD, WALL_H
    # The lamppost at the near-left corner (its sodium head is off by day).
    details.cylinder(V(-11, CURB_H, 11), UP, 0.09, 0.07, 7, 'lamppole', seg=10)
    details.cylinder(V(-11, CURB_H, 11), UP, 0.16, 0.12, 0.6, 'lamppole', seg=10)
    details.box(V(-11, 6.95, 10.2), (0.1, 0.1, 1.8), 'lamppole')
    details.box(V(-11, 6.85, 9.4), (0.32, 0.12, 0.7), 'lamphead')
    # Cars at two corners, noses toward the court.
    for (x, z, paint, taxi) in ((11.3, 11.3, 'carRed', False), (-11.3, -11.3, 'carTaxi', True)):
        yaw = math.atan2(-x, -z)
        fw = V(math.sin(yaw), 0, math.cos(yaw)); rt = V(fw.z, 0, -fw.x)
        ax = (rt, UP, fw)
        o = V(x, CURB_H, z)
        at = lambda px, py, pz: o + rt * px + UP * py + fw * pz
        props.box(at(0, 0.62, 0), (1.85, 0.6, 4.4), paint, axes=ax)
        props.box(at(0, 1.18, -0.25), (1.6, 0.55, 2.2), 'carGlass', axes=ax)
        props.box(at(0, 1.47, -0.3), (1.62, 0.06, 1.9), paint, axes=ax)
        for (wx, wz) in ((-0.88, 1.35), (0.88, 1.35), (-0.88, -1.35), (0.88, -1.35)):
            details.cylinder(at(wx - 0.12, 0.33, wz), rt, 0.33, 0.33, 0.24, 'tyre', seg=16)
        for s in (-0.62, 0.62):
            details.quad(at(s, 0.68, 2.205), rt * 0.18, UP * 0.08, 'headlight', n=fw, share=False)
            details.quad(at(s, 0.72, -2.205), rt * 0.2, UP * 0.06, 'taillight', n=-fw, share=False)
        if taxi:
            details.box(at(0, 1.6, -0.2), (0.7, 0.18, 0.22), 'taxiSign', axes=ax)
            for sx in (-0.93, 0.93): details.box(at(sx, 0.62, 0), (0.02, 0.08, 3.6), 'checker', axes=ax)
    # The dumpster by the far wall, and pallets.
    props.box(V(7.5, CURB_H + 0.62, Y - 1.1), (2.2, 1.24, 1.2), 'dumpster')
    props.box(V(7.5, CURB_H + 1.27, Y - 1.1), (2.3, 0.06, 1.3), 'dumpster')
    for (x, z, h) in ((-Y + 1, -3, 0.6), (-Y + 1.2, -1.6, 0.3), (Y - 1, -8, 0.45)):
        yaw = rand.random(); rt = V(math.cos(yaw), 0, -math.sin(yaw)); fw = V(math.sin(yaw), 0, math.cos(yaw))
        for k in range(max(1, round(h / 0.15))):
            details.box(V(x, CURB_H + 0.075 + k * 0.15, z), (1.2, 0.13, 1.0), 'pallet', axes=(rt, UP, fw))
    # The corner store's awning and door on the far wall.
    fwd, right = wall_frame(0)
    t = 0.35
    slope = (fwd * -math.cos(t) - UP * math.sin(t)).normalized()
    props.box(on_wall(0, -5.4, 3.2, 0.7) + V(0, -0.1, 0), (6.2, 0.06, 1.5), 'awning', axes=(right, slope.cross(right).normalized() * -1, slope))
    details.box(on_wall(0, -3.6, 1.2, 0.03), (1.1, 2.4, 0.06), 'shopdoor', axes=(right, UP, fwd))
    # A water tower on the far roof.
    props.cylinder(V(-5, H + 1.4, Y + 2.2), UP, 1.4, 1.4, 3.0, 'wood', seg=20)
    props.cylinder(V(-5, H + 4.4, Y + 2.2), UP, 1.55, 0.05, 1.2, 'iron', seg=20)
    for (dx, dz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        details.box(V(-5 + dx, H + 0.7, Y + 2.2 + dz), (0.12, 1.4, 0.12), 'iron')
    # A hydrant on the curb.
    hx, hz = 11.3, -4
    details.cylinder(V(hx, CURB_H, hz), UP, 0.14, 0.13, 0.62, 'hydrant', seg=14)
    details.ellipsoid(V(hx, CURB_H + 0.62, hz), (0.14, 0.12, 0.14), 'hydrantCap', seg=12, rings=6, top_only=True)
    details.cylinder(V(hx - 0.2, CURB_H + 0.42, hz), V(1, 0, 0), 0.05, 0.05, 0.4, 'hydrant', seg=8)
    # Black trash bags piled by the walls.
    for (cx, cz, n) in ((6, Y - 0.8, 7), (-Y + 0.9, 5.5, 6), (-2, -Y + 0.8, 5), (Y - 0.8, -3.5, 4)):
        for i in range(n):
            rr = (0.32 * (0.9 + rand.random() * 0.4), 0.3 * (0.7 + rand.random() * 0.3), 0.32 * (0.85 + rand.random() * 0.3))
            c = V(cx + (rand.random() - 0.5) * 1.6, CURB_H + rr[1] * 0.85 + (0.3 if i > n * 0.6 else 0), cz + (rand.random() - 0.5) * 1.2)
            details.ellipsoid(c, rr, 'bag', seg=9, rings=6, yaw=rand.random() * 3)
    # The Con Ed steam stack over the manhole: orange and white bands.
    for k in range(6):
        r0, r1 = 0.22 - k * 0.04 / 6, 0.22 - (k + 1) * 0.04 / 6
        details.cylinder(V(-10.2, k * 1.7 / 6, 3.5), UP, r0, r1, 1.7 / 6, 'stackO' if k % 2 == 0 else 'stackW', seg=16, caps=(k == 5))
    # Subway entrance: two globe lamps on posts and a rail, on the left sidewalk.
    for z in (-9.4, -6.6):
        details.cylinder(V(-Y + 1.6, CURB_H, z), UP, 0.04, 0.04, 2.3, 'iron', seg=8)
        details.ellipsoid(V(-Y + 1.6, CURB_H + 2.35, z), (0.17, 0.17, 0.17), 'globe', seg=12, rings=8)
    details.box(V(-Y + 1.6, CURB_H + 0.9, -8), (0.05, 0.05, 2.8), 'iron')
    details.box(V(-Y + 1.6, CURB_H + 1.9, -8), (0.04, 0.46, 1.95), 'iron')     # the sign's backing (the sign is drawn in Babylon)

# ─── Scene, light and bake ────────────────────────────────────────────────────

def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU unavailable, baking on the CPU:', e)
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 4
    world = bpy.data.worlds.new('overcast'); sc.world = world
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI)
    nt.links.new(env.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    world.light_settings.distance = 1.2          # AO reach
    return env.image

def sky_stats(img):
    """Cosine-weighted mean radiance of the upper hemisphere (= irradiance / π on a sky-facing surface), and a tone-mapped sky."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3]                      # rows bottom (−90°) to top (+90°)
    lat = (np.arange(h) + 0.5) / h * math.pi - math.pi / 2
    wgt = (np.cos(lat) * np.clip(np.sin(lat), 0, None))[:, None]
    up = (px * wgt[..., None]).sum((0, 1)) / (wgt.sum() * w)
    lum = float(up @ np.array([0.2126, 0.7152, 0.0722]))
    E = EXPOSURE / lum
    sky = np.clip((px * E) ** (1 / 2.2), 0, 1)
    out = bpy.data.images.new('sky', w, h, alpha=False)
    out.colorspace_settings.name = 'Non-Color'          # before the pixels: changing it afterwards clears them
    out.pixels.foreach_set(np.concatenate([sky, np.ones((h, w, 1), np.float32)], 2).ravel())
    out.filepath_raw = os.path.join(OUT, 'sky.png'); out.file_format = 'PNG'; out.save()
    return E, (up * E).tolist()

def select_only(ob):
    for o in bpy.context.scene.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob

def lightmap_uvs(ob):
    me = ob.data
    uv1 = me.uv_layers.new(name='UV1'); me.uv_layers.active = uv1
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    # Repack with concave shapes so the court fills the hole in the sidewalk ring.
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin=0.004, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UV0']

def bake_images(ob, size):
    """Bakes diffuse light (no colour) and AO into float images on UV1; returns them as numpy arrays (h, w, 3)."""
    out = {}
    for kind in ('DIFFUSE', 'AO'):
        img = bpy.data.images.new(f'{ob.name}_{kind}', size, size, float_buffer=True, alpha=False)
        for m in ob.data.materials:
            node = m.node_tree.nodes.get('bake') or m.node_tree.nodes.new('ShaderNodeTexImage')
            node.name = 'bake'; node.image = img
            m.node_tree.nodes.active = node
        select_only(ob)
        t0 = __import__('time').time()
        if kind == 'DIFFUSE':
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, uv_layer='UV1', margin=8, use_clear=True, target='IMAGE_TEXTURES')
        else:
            bpy.ops.object.bake(type='AO', uv_layer='UV1', margin=8, use_clear=True, target='IMAGE_TEXTURES')
        print(f'baked {ob.name} {kind} {size}px in {__import__("time").time() - t0:.0f}s', flush=True)
        px = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(px)
        out[kind] = px.reshape(size, size, 4)[..., :3].copy()
    return out

def bake_lightmap(ob, size):
    maps = bake_images(ob, size)
    return maps['DIFFUSE'] * (0.55 + 0.45 * maps['AO'])

def court_centre_light(ob, light):
    """The baked light in the middle of the court (the court is one quad of the ground mesh), median over a small window."""
    me, size = ob.data, light.shape[0]
    uv1 = me.uv_layers['UV1'].data
    for poly in me.polygons:
        if me.materials[poly.material_index].name.startswith('court@'):
            u = sum(uv1[i].uv.x for i in poly.loop_indices) / poly.loop_total
            v = sum(uv1[i].uv.y for i in poly.loop_indices) / poly.loop_total
            x, y = int(u * size), int(v * size)           # bpy pixel rows run bottom-up, like UV v
            win = light[max(0, y - 6):y + 7, max(0, x - 6):x + 7]
            return float(np.median(win @ np.array([0.2126, 0.7152, 0.0722], np.float32)))
    raise RuntimeError('no court quad in the ground mesh')

def encode_lightmap(ob, light, E):
    size = light.shape[0]
    t = np.clip((light * E / HEADROOM) ** (1 / 2.2), 0, 1)
    img = bpy.data.images.new(f'{ob.name}_lm', size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.concatenate([t, np.ones((size, size, 1), np.float32)], 2).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(OUT, f'{ob.name}_lm.png'); img.file_format = 'PNG'; img.save()
    return img

def bake_vertex_colours(ob):
    me = ob.data
    res = {}
    for kind in ('AO', 'DIFFUSE'):
        attr = me.color_attributes.new(kind.lower(), 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = attr
        select_only(ob)
        t0 = __import__('time').time()
        if kind == 'DIFFUSE':
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, target='VERTEX_COLORS', use_clear=True)
        else:
            bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
        print(f'baked {ob.name} {kind} (vertex colours) in {__import__("time").time() - t0:.0f}s', flush=True)
        arr = np.empty(len(attr.data) * 4, np.float32); attr.data.foreach_get('color', arr)
        res[kind] = arr.reshape(-1, 4)[:, :3]
    for name in ('ao', 'diffuse'): me.color_attributes.remove(me.color_attributes[name])
    return res['DIFFUSE'] * (0.55 + 0.45 * res['AO'])

def encode_vertex_colours(ob, light, E):
    me = ob.data
    t = np.clip((light * E / HEADROOM) ** (1 / 2.2), 0, 1)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    col.data.foreach_set('color', np.concatenate([t, np.ones((len(t), 1), np.float32)], 1).astype(np.float32).ravel())
    me.color_attributes.active_color = me.color_attributes['Col']
    me.color_attributes.render_color_index = 0

def prepare_for_export(ob, lm_img):
    """glTF wants plain wiring: albedo straight into Base Color (Babylon applies `tint` itself), no normal maps, and the
    lightmap as the emissive texture on UV1."""
    for m in ob.data.materials:
        nt = m.node_tree; N = nt.nodes; L = nt.links
        bsdf = N['Principled BSDF']
        for name in ('bake', 'normalTex'):
            if name in N: N.remove(N[name])
        for link in list(bsdf.inputs['Normal'].links): L.remove(link)
        if 'albedo' in N:
            L.new(N['albedo'].outputs['Color'], bsdf.inputs['Base Color'])
            if 'tint' in N: N.remove(N['tint'])
        if lm_img is not None:
            uv1 = N.new('ShaderNodeUVMap'); uv1.uv_map = 'UV1'
            lm = N.new('ShaderNodeTexImage'); lm.image = lm_img
            L.new(uv1.outputs['UV'], lm.inputs['Vector'])
            L.new(lm.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 1.0
        if ob['kind'] == 'vc':
            # So the exporter keeps COLOR_0: it exports colour attributes a material reads.
            ca = N.new('ShaderNodeVertexColor'); ca.layer_name = 'Col'
            mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 0.0
            src = N['albedo'].outputs['Color'] if 'albedo' in N else None
            if src is None:
                rgb = N.new('ShaderNodeRGB'); rgb.outputs[0].default_value = tuple(bsdf.inputs['Base Color'].default_value); src = rgb.outputs[0]
            L.new(src, mix.inputs['A']); L.new(ca.outputs['Color'], mix.inputs['B'])

def main():
    import time
    t0 = time.time()
    hdri = setup_scene()
    E_sky, sky_up = sky_stats(hdri)
    make_chainlink()
    build_ground(); build_walls(); build_wall_details(); build_fence(); build_hoop(); build_trees(); build_street_furniture()
    obs = {g.name: (g, g.to_object()) for g in (ground, walls, props, details, leaves, fence)}
    for g, ob in obs.values():
        print(f'{ob.name}: {len(ob.data.polygons)} faces, {len(ob.data.materials)} materials', flush=True)
    lms = {}
    for g, ob in obs.values():
        if g.kind == 'lm': lightmap_uvs(ob)
    raw = {}
    for g, ob in obs.values():
        if g.kind == 'lm': raw[ob.name] = bake_lightmap(ob, LM_SIZE[g.name.split('_')[1]])
        elif g.kind == 'vc': raw[ob.name] = bake_vertex_colours(ob)
    centre = court_centre_light(obs['court_ground'][1], raw['court_ground'])
    E = COURT ** 2.2 / centre
    print(f'court centre light {centre:.3f} → exposure E = {E:.3f}; sky {sky_up}', flush=True)
    for g, ob in obs.values():
        if g.kind == 'lm': lms[ob.name] = encode_lightmap(ob, raw[ob.name], E)
        elif g.kind == 'vc': encode_vertex_colours(ob, raw[ob.name], E)
    for g, ob in obs.values():
        prepare_for_export(ob, lms.get(ob.name))
    info = bpy.data.objects.new('court_info', None)
    bpy.context.scene.collection.objects.link(info)
    info['lmLevel'] = HEADROOM ** (1 / 2.2)
    info['skyUp'] = sky_up            # the open sky's cosine-weighted radiance × E, linear (its colour tints the fighters' fill)
    info['court'] = COURT
    info['exposure'] = E
    info['hdri'] = os.path.basename(HDRI)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'court.blend'))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, 'court_raw.glb'), export_format='GLB', export_extras=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_image_format='AUTO', export_yup=True, export_apply=True,
        export_cameras=False, export_lights=False, export_animations=False)
    print(f'done in {time.time() - t0:.0f}s', flush=True)

main()
