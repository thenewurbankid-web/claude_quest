"""
Boxing Manager AI (BOX-17): renders the red fighter's 2D action clips with Cycles.

  node scripts/dump-poses.mjs                      # poses the real ModelBoxer in Chromium -> assets-src/build/poses.json
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/render-fighters.py -- \
      [--clips idle_guard,atk_jab] [--samples 64] [--only 3] [--out assets-src/build/frames]
  node scripts/pack-sprites.mjs                    # crop, WebP, manifest -> public/boxing/sprites2d/

Replays the per-frame bone matrices from poses.json on public/boxing/models/person.glb (the same MPFB person, straightening
and IK the 3D view uses), lit by the CC0 overcast HDRI the court was baked with, with soft film-transparent edges and a
shadow-catcher floor (the contact shadow lands in the alpha). Camera: public/boxing/camera2d.js (stored in poses.json).

Coordinates: Babylon's world is left-handed with the glTF root mirroring x. A glTF node's matrix N inside the model, placed
by the holder H, is (F H F) N in a right-handed Y-up space (F = flip x), and Blender's world is C of that (C: y-up -> z-up).
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Matrix, Vector, Quaternion

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'public', 'boxing', 'models')
HDRI = os.path.join(ROOT, 'assets-src', 'polyhaven', 'bethnal_green_entrance_1k.hdr')
BUILD = os.path.join(ROOT, 'assets-src', 'build')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
SAMPLES = arg('--samples', 64)
CLIPS = arg('--clips', '').split(',') if arg('--clips', '') else None
ONLY = arg('--only', -1)
OUT = arg('--out', os.path.join(BUILD, 'frames'))
PROBE = '--probe' in argv

poses = json.load(open(os.path.join(BUILD, 'poses.json')))
CAM = poses['camera']; FRAME = poses['frame']; SCALE = poses['scale']

F = Matrix.Diagonal((-1, 1, 1, 1))
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
Ci = C.inverted()

def col(m16):                      # Babylon row-major array (row vectors) -> column-convention Matrix
    return Matrix([m16[0:4], m16[4:8], m16[8:12], m16[12:16]]).transposed()

def lerp_m(a, b, t):               # decomposed lerp of two matrices
    la, qa, sa = a.decompose(); lb, qb, sb = b.decompose()
    return Matrix.LocRotScale(la.lerp(lb, t), qa.slerp(qb, t), sa.lerp(sb, t))

# ─── Scene ──────────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
cy = scene.cycles
cy.samples = SAMPLES; cy.use_denoising = True
cy.max_bounces = 6; cy.diffuse_bounces = 3; cy.glossy_bounces = 3; cy.transmission_bounces = 2
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    cy.device = 'CPU' if '--cpu' in argv else 'GPU'
except Exception as e:
    print('GPU unavailable, CPU:', e)
scene.render.film_transparent = True
scene.render.resolution_x = round(FRAME['w'] * SCALE); scene.render.resolution_y = round(FRAME['h'] * SCALE)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'; scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
# Only the left (red) fighter's part of the frame is rendered, and the output is cropped to it.
BORDER = dict(x0=0.0, x1=0.84, y0=0.14, y1=0.88)       # fractions of the frame; y from the bottom
scene.render.use_border = True; scene.render.use_crop_to_border = True
scene.render.border_min_x = BORDER['x0']; scene.render.border_max_x = BORDER['x1']
scene.render.border_min_y = BORDER['y0']; scene.render.border_max_y = BORDER['y1']

# Light: the court's overcast HDRI plus a soft, weak key from the Babylon day key's direction (0.25, -1, 0.35).
world = bpy.data.worlds.new('sky'); scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI)
bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 0.6
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
sun = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 2.2; sun.data.angle = math.radians(12); sun.data.color = (1, 0.97, 0.93)
travel = C @ Vector((-0.25, -1.0, 0.35))                # Babylon (0.25,-1,0.35) -> W (x flipped) -> Blender
sun.rotation_euler = travel.to_track_quat('-Z', 'Y').to_euler()

floor = bpy.data.objects.new('floor', bpy.data.meshes.new('floor')); scene.collection.objects.link(floor)
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=12); bm.to_mesh(floor.data); bm.free()
floor.is_shadow_catcher = True
if '--nofloor' in argv: bpy.data.objects.remove(floor, do_unlink=True)
if '--dbg' in argv: print('DBG world', scene.world, [n.type for n in scene.world.node_tree.nodes], [ (l.from_node.type,l.to_node.type) for l in scene.world.node_tree.links])

cam_data = bpy.data.cameras.new('cam'); cam_data.sensor_fit = 'HORIZONTAL'; cam_data.angle = CAM['hfov']; cam_data.clip_start = 0.05
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
def bl(p):                                              # Babylon world point -> Blender world
    return C @ Vector((-p[0], p[1], p[2]))
cp, ct = bl(CAM['pos']), bl(CAM['target'])
cam.location = cp; cam.rotation_euler = (ct - cp).to_track_quat('-Z', 'Y').to_euler()

# ─── Fighter ────────────────────────────────────────────────────────────────────
bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, 'person.glb'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
SHOWN = {'skin', 'eyes', 'brows', 'lashes', 'pants_jeans', 'shoes_timbs', 'top_tee', 'top_tee_sleeve'}
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name not in SHOWN:
        bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.visible_shadow = True

def srgb_lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

GREY_LIN = 0.8 ** 2.2                                    # the grey garment textures average 0.8 (sRGB), as in boxer-model.js
OUTFIT = {'top': '#ecebe6', 'jeans': '#8fa8c4', 'wraps': '#c9343a', 'cap': '#1c2540'}
if arg('--outfit', 'red') == 'blue': OUTFIT = {'top': '#2a3a5c', 'jeans': '#3b3f48', 'wraps': '#2f5fb8', 'cap': '#d8d4c8'}
def style(mat, tint=None, rough=0.7, sss=0.0, spec=0.35, image=None):
    nt = mat.node_tree
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Roughness'].default_value = rough
    if 'Specular IOR Level' in p.inputs: p.inputs['Specular IOR Level'].default_value = spec
    if sss > 0:
        p.inputs['Subsurface Weight'].default_value = sss
        p.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
        p.inputs['Subsurface Scale'].default_value = 0.03
    tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE'), None)
    if tex and image:
        tex.image = bpy.data.images.load(image); tex.image.colorspace_settings.name = 'sRGB'
    if tex and tint:
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[7].default_value = [c / GREY_LIN for c in srgb_lin(tint)] + [1]
        link = next(l for l in nt.links if l.to_node == p and l.to_socket.name == 'Base Color')
        nt.links.new(link.from_socket, mix.inputs[6]); nt.links.new(mix.outputs[2], p.inputs['Base Color'])
    return mat
for m in bpy.data.materials:
    if m.name == 'skin': style(m, rough=0.5, sss=0.12, spec=0.4, image=os.path.join(MODELS, 'person_skin_light.webp'))
    elif m.name == 'pants_jeans': style(m, tint=OUTFIT['jeans'], rough=0.88, spec=0.2)
    elif m.name == 'top_tank': style(m, tint=OUTFIT['top'], rough=0.9, spec=0.2)
    elif m.name == 'shoes_timbs': style(m, rough=0.55, spec=0.45)
    elif m.name in ('eyes',): style(m, rough=0.12, spec=0.8)

def solid(name, hexcol, rough=0.7, metal=0.0, spec=0.4):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = srgb_lin(hexcol) + [1]
    p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
    if 'Specular IOR Level' in p.inputs: p.inputs['Specular IOR Level'].default_value = spec
    return m

# Extras (taped fists, cuffs, cap, chain) mirror the Babylon meshes of boxer-model.js; built in Babylon-local axes (y up).
def mesh_obj(name, bm, mat):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o); o.data.materials.append(mat)
    for poly in me.polygons: poly.use_smooth = True
    return o
def uv_sphere(d, keep_y_above=None):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=d / 2)
    if keep_y_above is not None:      # the sphere's poles are on z here; rotate to y first
        pass
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    if keep_y_above is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < keep_y_above], context='VERTS')
    return bm
def y_cylinder(h, d):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=d / 2, radius2=d / 2, depth=h)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    return bm
def y_torus(d, thick):
    bm = bmesh.new(); R, r = d / 2, thick / 2
    ring = []
    for i in range(48):
        a = 2 * math.pi * i / 48
        row = []
        for j in range(10):
            b = 2 * math.pi * j / 10
            row.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a))))
        ring.append(row)
    for i in range(48):
        for j in range(10):
            bm.faces.new((ring[i][j], ring[(i + 1) % 48][j], ring[(i + 1) % 48][(j + 1) % 10], ring[i][(j + 1) % 10]))
    return bm
def y_box(w, h, d):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co.x *= w; v.co.y *= h; v.co.z *= d
    return bm
wrap_mat = solid('wraps', OUTFIT['wraps'], rough=0.75); cuff_mat = solid('cuffs', '#3a2a1e', rough=0.8)
cap_mat = solid('cap', OUTFIT['cap'], rough=0.85); gold = solid('chain', '#d4a63a', rough=0.18, metal=1.0)
extras = {
    'gloveL': mesh_obj('gloveL', uv_sphere(1.0), wrap_mat), 'gloveR': mesh_obj('gloveR', uv_sphere(1.0), wrap_mat),
    'cuffL': mesh_obj('cuffL', y_cylinder(0.08, 0.1), wrap_mat), 'cuffR': mesh_obj('cuffR', y_cylinder(0.08, 0.1), wrap_mat),
    'capDome': mesh_obj('capDome', uv_sphere(0.215, keep_y_above=-0.1 * 0.215 / 2), cap_mat),
    'capBrim': mesh_obj('capBrim', y_box(0.18, 0.012, 0.12), cap_mat),
    'chain': mesh_obj('chain', y_torus(0.2, 0.012), gold),
}
sol = extras['capDome'].modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 0.004
for o in extras.values():
    o.modifiers.new('sub', 'SUBSURF').levels = 1 if o.name in ('gloveL', 'gloveR') else 0

if '--white' in argv:
    wm = solid('white', '#ffffff', rough=0.9)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name != 'floor':
            o.data.materials.clear(); o.data.materials.append(wm)
# ─── Posing ─────────────────────────────────────────────────────────────────────
rest = {k: col(v) for k, v in poses['restBones'].items()}
bones = [b for b in arm.data.bones]
order = []                                              # parents first
def visit(b):
    order.append(b)
    for c in b.children: visit(c)
for b in bones:
    if b.parent is None: visit(b)
rest_world = {b.name: arm.matrix_world @ b.matrix_local for b in bones}
rest_off = {b.name: (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local.copy() for b in bones}

def frame_matrices(fr):
    """Per-bone and per-extra matrices for one dumped frame (dict of column-convention matrices)."""
    H = col(fr['holder'])
    FHF = F @ H @ F
    bone_m = {k: FHF @ col(v) for k, v in fr['bones'].items()}
    extra_m = {k: F @ col(v) @ F for k, v in fr['extras'].items()}
    return bone_m, extra_m

def apply(bone_m, extra_m):
    desired = {}
    for b in order:
        if b.name not in bone_m or b.name not in rest: continue
        D = C @ (bone_m[b.name] @ rest[b.name].inverted()) @ Ci          # world-space change from the rest pose, in Blender
        desired[b.name] = arm.matrix_world.inverted() @ (D @ rest_world[b.name])
    for b in order:
        pb = arm.pose.bones[b.name]
        if b.name not in desired: continue
        parent_pose = desired.get(b.parent.name, b.parent.matrix_local) if b.parent else Matrix.Identity(4)
        pb.matrix_basis = rest_off[b.name].inverted() @ parent_pose.inverted() @ desired[b.name]
    for k, o in extras.items():
        if k in extra_m: o.matrix_world = C @ extra_m[k]; o.hide_render = False
        else: o.hide_render = True
    bpy.context.view_layer.update()

if PROBE:
    # How well does the Blender rest pose line up with C @ N_rest? (should be ~0)
    errs = [(b.name, (rest_world[b.name].translation - (C @ rest[b.name]).translation).length) for b in bones if b.name in rest]
    print('REST-ALIGN worst', max(errs, key=lambda e: e[1]))

# ─── Render ─────────────────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
meta = {'border': BORDER, 'size': [scene.render.resolution_x, scene.render.resolution_y], 'clips': {}}
for name, clip in poses['actions'].items():
    if CLIPS and name not in CLIPS: continue
    n = clip['frames']; data = clip['data']
    # idle_guard is dumped over 2N frames; frame i is lerp(A[i+N], A[i], i/N), so that frame N equals frame 0.
    seq = []
    if clip['loop'] and len(data) == 2 * n:
        for i in range(n):
            a, b = frame_matrices(data[i + n]), frame_matrices(data[i]); t = i / n
            seq.append(({k: lerp_m(a[0][k], b[0][k], t) for k in a[0]}, {k: lerp_m(a[1][k], b[1][k], t) for k in a[1] if k in b[1]}))
    else:
        seq = [frame_matrices(fr) for fr in data]
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    for i, (bm_, em_) in enumerate(seq):
        if ONLY >= 0 and i != ONLY: continue
        scene.render.filepath = os.path.join(d, '%03d.png' % i)
        if os.path.exists(scene.render.filepath) and '--force' not in argv: continue   # resume after a Metal crash
        if '--norest' not in argv: apply(bm_, em_)
        bpy.ops.render.render(write_still=True)
    meta['clips'][name] = {'frames': n, 'fps': clip['fps'], 'impact': clip['impact'], 'loop': clip['loop']}
    print('CLIP', name, n)
with open(os.path.join(OUT, 'meta.json'), 'w') as f: json.dump(meta, f)
