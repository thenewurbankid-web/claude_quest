"""
Boxing Manager AI: a realistic fighter built with MPFB (MakeHuman for Blender), headless.

Setup, once (no login needed; see public/boxing/models/CREDITS.md):
  mkdir -p assets-src/mpfb && cd assets-src/mpfb
  curl -LO <extensions.blender.org MPFB 2.0.17 zip> and the *_cc0.zip asset packs from files2.makehumancommunity.org
  Blender -b --factory-startup --command extension install-file -r user_default -e mpfb.zip
  Blender -b --factory-startup --python scripts/build-mpfb-boxer.py -- --install-packs assets-src/mpfb
Build:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/build-mpfb-boxer.py
then `node scripts/build-mpfb-models.mjs` to compress it into public/boxing/models/person.glb and the skin textures.

What it does:
- Builds a male human with MPFB's "game_engine" rig (UE-style bone names, like the Quaternius clips), one mesh per
  garment option (tops, jeans, shoes, hair), all CC0 assets from the MakeHuman asset packs.
- Poses the arms and legs into the Quaternius T-pose and bakes that in, then gives every bone the Quaternius rest
  orientation (read from public/boxing/models/boxer.glb) and its name ('root', 'Head'). The clips in anims.glb store each
  bone's rotation relative to its rest orientation, so they now play on this skeleton unchanged.
- Garment textures are turned grey (shading kept) so the game can tint them with the look's colours.
- Writes assets-src/build/mpfb/person_raw.glb, the garment textures, and the skin textures.
"""
import bpy, bmesh, os, sys, math, glob, importlib, json
import numpy as np
from mathutils import Matrix, Vector, Quaternion

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import _glbdump as gd
OUT = os.path.join(ROOT, 'assets-src', 'build', 'mpfb')
os.makedirs(OUT, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
P = 'bl_ext.user_default.mpfb'
def svc(mod, name): return getattr(importlib.import_module(f'{P}.services.{mod}'), name)
HS, LS, TS = svc('humanservice', 'HumanService'), svc('locationservice', 'LocationService'), svc('targetservice', 'TargetService')
AS = svc('assetservice', 'AssetService')
DATA = LS.get_user_data()

if '--install-packs' in argv:
    packs = argv[argv.index('--install-packs') + 1]
    for z in sorted(glob.glob(os.path.join(packs, '*_cc0.zip'))):
        err = AS.check_asset_pack_zip(z) or AS.fix_and_extract_asset_pack_zip(z, DATA)
        print('PACK', os.path.basename(z), err or 'ok')
    sys.exit(0)

# ─── What goes in the file ────────────────────────────────────────────────────────
# game name -> (asset folder, asset, kind, tintable). Names are what boxer-model.js looks up.
TOPS = {            # style -> clothes asset (the suits' shirts are cut out of the suit by loose part)
    'tee': 'elvs_crude_t-shirt_male',
    'tank': 'elvs_crude_t-shirt_male',          # the tee without its sleeves
    'varsity': 'male_casualsuit05',             # the jacket
    'hoodie': 'toigo_fisherman_sweater',        # long-sleeved knit
}
JEANS = 'male_casualsuit04'                      # the suit's jeans (its tee is dropped)
SHOES = {'timbs': 'toigo_ankle_boots_male', 'sneakers': 'shoes05'}
HAIR = {'short01': 'short01', 'short02': 'short02'}
SKINS = {'light': 'young_caucasian_male', 'medium': 'young_asian_male', 'deep': 'young_african_male'}
EYES, BROWS, LASHES = 'low-poly', 'eyebrow001', 'eyelashes01'
GREY_MEAN = 0.8          # tintable textures are normalised to this mean grey; the game scales by 1 / GREY_MEAN

def mhclo_path(kind, name): return os.path.join(DATA, kind, name, name + '.mhclo')

def parse_mh(path):
    """The key/value lines of an .mhclo or .mhmat, plus the licence/author comment lines."""
    kv, lic = {}, []
    for line in open(path, errors='ignore'):
        s = line.strip()
        if s.startswith('#'):
            if re_has(s, ('cc0', 'copyright', 'license', 'licence', 'author', 'creative commons')): lic.append(s.lstrip('# '))
            continue
        if ' ' in s and not s.startswith('//'):
            k, v = s.split(None, 1); kv.setdefault(k, v)
    return kv, lic
def re_has(s, words): return any(w in s.lower() for w in words)

LICENCES = {}
def check_licence(kind, name):
    """Every asset has to say CC0 in its own header (that is the whole point of using these)."""
    p = mhclo_path(kind, name)
    kv, lic = parse_mh(p)
    mat = os.path.join(os.path.dirname(p), kv['material']) if 'material' in kv else None
    mlic = parse_mh(mat)[1] if mat and os.path.exists(mat) else []
    text = ' '.join(lic + mlic).lower()
    ok = 'cc0' in text
    LICENCES[f'{kind}/{name}'] = {'cc0': ok, 'header': (lic + mlic)[:6]}
    if not ok: raise SystemExit(f'{kind}/{name}: no CC0 statement in its header, not using it: {lic + mlic}')
    return kv, mat

# ─── The Quaternius rest pose we have to match ─────────────────────────────────────
Q = gd.load(os.path.join(ROOT, 'public', 'boxing', 'models', 'boxer.glb'))
QW, _, _ = gd.world(Q)
CG = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_4x4()      # glTF (x, y, z) -> Blender (x, -z, y)
# The glTF exporter turns a Blender bone's orientation R into R·EXPORT_AXIS (a quarter turn about the bone's local X), so
# we feed it the inverse of that to land exactly on the Quaternius orientation (checked by scripts/_glbdump.py).
EXPORT_AXIS = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
def q_world(name):
    """The Quaternius bone's rest matrix in Blender axes (rotation only; positions come from our own joints)."""
    m = QW[{'Root': 'root', 'head': 'Head'}.get(name, name)]
    return CG @ (m.to_3x3() @ EXPORT_AXIS.inverted()).to_4x4() @ CG.inverted()
def q_pos(name):
    m = QW[{'Root': 'root', 'head': 'Head'}.get(name, name)]
    return CG @ m.translation

# ─── Build ────────────────────────────────────────────────────────────────────────
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
# Athletic fighter bodies (BOX-14): MPFB macro sliders plus MakeHuman detail targets (CC0 data shipped with MPFB). Detail
# values are 0..1; 'incr'/'decr' are separate targets. Three builds: lean (speed), balanced, heavy (power).
SIDES = ('l', 'r')
def both(name, v): return {f'{s}-{name}': v for s in SIDES}
ATHLETE = {                       # common to every variant: boxer shoulders, back, neck, jaw, trim waist
    'torso-vshape-incr': 1.0, 'torso-muscle-dorsi-incr': 1.0, 'torso-muscle-pectoral-incr': 0.9, 'torso-scale-horiz-incr': 0.25,
    'measure-neck-circ-incr': 0.8, 'neck-scale-horiz-incr': 0.4, 'chin-width-incr': 0.4, 'chin-prominent-incr': 0.4,
    'stomach-tone-incr': 0.8, 'head-square': 0.25,
    **both('upperarm-shoulder-muscle-incr', 1.0), **both('upperarm-muscle-incr', 1.0), **both('lowerarm-muscle-incr', 0.8),
    'measure-upperarm-circ-incr': 0.7, **both('upperarm-scale-horiz-incr', 0.3), **both('upperarm-scale-depth-incr', 0.3),
    **both('upperleg-muscle-incr', 0.5), **both('lowerleg-muscle-incr', 0.6),
}
VARIANTS = {
    'balanced': {'macro': dict(muscle=0.82, weight=0.42), 'detail': ATHLETE},
    'lean':     {'macro': dict(muscle=0.68, weight=0.28), 'detail': {**ATHLETE, 'torso-vshape-incr': 0.5, 'measure-waist-circ-decr': 0.4,
                 'torso-muscle-pectoral-incr': 0.5, 'torso-muscle-dorsi-incr': 0.6, 'measure-neck-circ-incr': 0.4,
                 **both('upperarm-shoulder-muscle-incr', 0.6), **both('upperarm-muscle-incr', 0.45), **both('upperleg-muscle-incr', 0.3)}},
    'heavy':    {'macro': dict(muscle=0.97, weight=0.62), 'detail': {**ATHLETE, 'torso-vshape-incr': 0.9, 'torso-muscle-pectoral-incr': 0.9,
                 'torso-muscle-dorsi-incr': 1.0, 'measure-neck-circ-incr': 0.9, 'neck-scale-horiz-incr': 0.5,
                 **both('upperarm-shoulder-muscle-incr', 1.0), **both('upperarm-muscle-incr', 0.85), **both('lowerarm-muscle-incr', 0.7),
                 **both('upperleg-muscle-incr', 0.6)}},
}
VARIANT = argv[argv.index('--variant') + 1] if '--variant' in argv else 'balanced'
mac = TS.get_default_macro_info_dict()
mac.update(gender=1.0, proportions=0.6, **VARIANTS[VARIANT]['macro'])
body = HS.create_human(macro_detail_dict=mac)
for tname, val in VARIANTS[VARIANT]['detail'].items():
    path = TS.target_full_path(tname)
    if not path: raise SystemExit(f'no MPFB target named {tname}')
    TS.load_target(body, path, weight=val, name=tname)
print('SHAPEKEYS', [(k.name, round(k.value, 2)) for k in body.data.shape_keys.key_blocks if k.value] if body.data.shape_keys else None)
TS.bake_targets(body)
rig = HS.add_builtin_rig(body, 'game_engine')
body.name = 'skin'
bpy.context.view_layer.update()

def add(kind, name, as_type):
    check_licence(kind, name)
    o = HS.add_mhclo_asset(mhclo_path(kind, name), body, asset_type=as_type, subdiv_levels=0, material_type='GAMEENGINE')
    return o

parts = {}      # game name -> object
for style in ('tee', 'varsity', 'hoodie'):
    parts[f'top_{style}'] = add('clothes', TOPS[style], 'Clothes')
parts['top_tank'] = None                         # made from top_tee below
parts['pants_jeans'] = add('clothes', JEANS, 'Clothes')
for k, n in SHOES.items(): parts[f'shoes_{k}'] = add('clothes', n, 'Clothes')
for k, n in HAIR.items(): parts[f'hair_{k}'] = add('hair', n, 'Hair')
parts['eyes'] = add('eyes', EYES, 'Eyes')
parts['brows'] = add('eyebrows', BROWS, 'Eyebrows')
parts['lashes'] = add('eyelashes', LASHES, 'Eyelashes')
parts['skin'] = body
parts = {k: v for k, v in parts.items() if v}
# The tee twice: one copy loses its sleeves later.
bpy.ops.object.select_all(action='DESELECT')
tank = parts['top_tee'].copy(); tank.data = parts['top_tee'].data.copy()
bpy.context.collection.objects.link(tank); tank.parent = parts['top_tee'].parent
parts['top_tank'] = tank

# ─── Mesh work: each object becomes a clean skinned mesh ────────────────────────────
def bm_of(o):
    bm = bmesh.new(); bm.from_mesh(o.data); return bm
def dominant_bone(o, v, names):
    best, bw = None, 0
    for g in o.data.vertices[v].groups:
        if g.weight > bw: best, bw = o.vertex_groups[g.group].name, g.weight
    return best
ARM_BONES = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb')
def is_arm(b): return b is not None and b.startswith(ARM_BONES)

def split_loose(o, keep):
    """Keeps only the loose parts for which keep(face_centre_z, part_index, parts) is true (suits are shirt + jeans shells)."""
    bm = bm_of(o); bm.faces.ensure_lookup_table()
    seen, shells = set(), []
    for f in bm.faces:
        if f.index in seen: continue
        stack, shell = [f], []
        seen.add(f.index)
        while stack:
            cur = stack.pop(); shell.append(cur)
            for e in cur.edges:
                for nf in e.link_faces:
                    if nf.index not in seen: seen.add(nf.index); stack.append(nf)
        shells.append(shell)
    infos = [(sum(f.calc_center_median().z for f in sh) / len(sh), len(sh)) for sh in shells]
    drop = [f for i, sh in enumerate(shells) if not keep(i, infos) for f in sh]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(o.data); bm.free()
    return infos

def drop_faces(o, pred):
    bm = bm_of(o); bm.faces.ensure_lookup_table()
    gl = bm.verts.layers.deform.verify()
    names = {g.index: g.name for g in o.vertex_groups}
    def dom(v):
        best, bw = None, 0
        for gi, w in v[gl].items():
            if w > bw: best, bw = names[gi], w
        return best
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if pred(sum(1 for v in f.verts if is_arm(dom(v))) >= 2)], context='FACES')
    bm.to_mesh(o.data); bm.free()

# Jeans: the suit's lower shell. Print the shells so a wrong cut shows up in the log.
infos = split_loose(parts['pants_jeans'], lambda i, inf: inf[i][0] < max(z for z, _ in inf) - 0.15 and inf[i][1] > 200 and inf[i][0] < 1.0)
print('JEANS SHELLS', infos)
# The varsity jacket is the other suit's shirt shell(s) without its trousers.
infos = split_loose(parts['top_varsity'], lambda i, inf: inf[i][0] > 0.9)
print('VARSITY SHELLS', infos)

# The athletic body's muscles push through clothes that were fitted with a thin offset (skin shows at the chest, shoulders,
# thighs and ankles), so every garment is inflated a few mm along its normals.
INFLATE = {'top': 0.006, 'pants': 0.006, 'shoes': 0.004}
for name, o in parts.items():
    for prefix, amt in INFLATE.items():
        if name.startswith(prefix):
            bm = bm_of(o); bm.verts.ensure_lookup_table(); bm.normal_update()
            for vtx in bm.verts: vtx.co += vtx.normal * amt
            bm.to_mesh(o.data); bm.free()
print('BODY HEIGHT', round(parts['skin'].dimensions.z, 3), 'SHOULDERS', round(parts['skin'].dimensions.x, 3))

# ─── T-pose ────────────────────────────────────────────────────────────────────────
meshes = [o for o in parts.values()]
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
pb = rig.pose.bones
def head_w(b): return rig.matrix_world @ pb[b].head
def align(bone, child, target_dir):
    """Rotates `bone` about its head so bone -> child points along target_dir (armature space)."""
    cur = (pb[child].head - pb[bone].head).normalized()
    rot = cur.rotation_difference(target_dir).to_matrix().to_4x4()
    m = pb[bone].matrix
    t = m.translation.copy()
    m3 = rot.to_3x3() @ m.to_3x3()
    pb[bone].matrix = Matrix.Translation(t) @ m3.to_4x4()
    bpy.context.view_layer.update()
CHAINS = [('clavicle', 'upperarm'), ('upperarm', 'lowerarm'), ('lowerarm', 'hand'), ('thigh', 'calf'), ('calf', 'foot')]
for side in ('l', 'r'):
    for a, b in CHAINS:
        ba, bb = f'{a}_{side}', f'{b}_{side}'
        d = (q_pos(bb) - q_pos(ba)).normalized()
        align(ba, bb, d)
bpy.ops.object.mode_set(mode='OBJECT')

# Bake the pose into the meshes, then make it the rig's rest pose.
for o in meshes:
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                bpy.ops.object.modifier_apply(modifier=m.name)
        else:
            o.modifiers.remove(m)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
for o in meshes:
    mod = o.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

# Cut the tank's sleeves, and split the sleeves off the other tops (so the varsity jacket can have contrast sleeves).
drop_faces(parts['top_tank'], lambda arm: arm)
for style in ('tee', 'varsity', 'hoodie'):
    o = parts[f'top_{style}']
    sl = o.copy(); sl.data = o.data.copy(); bpy.context.collection.objects.link(sl); sl.parent = o.parent
    sl.modifiers.clear(); m = sl.modifiers.new('Armature', 'ARMATURE'); m.object = rig
    drop_faces(o, lambda arm: arm)
    drop_faces(sl, lambda arm: not arm)
    parts[f'top_{style}_sleeve'] = sl
# The tank has no arm faces; the tee keeps shoulders.

# Helpers off the body (only the 'body' vertex group is skin).
bm = bm_of(body)
gl = bm.verts.layers.deform.verify(); gi = body.vertex_groups['body'].index
bmesh.ops.delete(bm, geom=[v for v in bm.verts if gi not in v[gl]], context='VERTS')
bm.to_mesh(body.data); bm.free()

# ─── Bones: Quaternius names and rest orientations ─────────────────────────────────
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for eb in rig.data.edit_bones:
    eb.use_connect = False
# MPFB's spine joints sit low (spine_03 at 1.14 m, a 0.34 m neck bone), and the clips bend the spine at the Quaternius
# joints, so the head would swing 15 cm too far. Move the spine pivots to the Quaternius heights (scaled to this body).
# Skin weights are unchanged; the pivots just sit a few cm higher.
ebs = rig.data.edit_bones
pel, neck = ebs['pelvis'].head.copy(), ebs['neck_01'].head.copy()
rise = lambda n: q_pos(n).z - q_pos('pelvis').z                                  # Blender z is up
scale = (neck.z - pel.z) / rise('neck_01')
for name in ('spine_01', 'spine_02', 'spine_03'):
    z = pel.z + rise(name) * scale
    y = pel.y + (neck.y - pel.y) * (z - pel.z) / (neck.z - pel.z)                  # follow MPFB's own front-back lean
    ebs[name].head = Vector((0, y, z))
for eb in rig.data.edit_bones:
    length = max(eb.length, 0.02)
    R = q_world(eb.name).to_3x3()
    eb.matrix = Matrix.Translation(eb.head) @ R.to_4x4()
    eb.length = length
bpy.ops.object.mode_set(mode='OBJECT')
for b in rig.data.bones:
    b.name = {'Root': 'root', 'head': 'Head'}.get(b.name, b.name)
for o in meshes:                                  # vertex groups follow the bone names
    for g in o.vertex_groups:
        g.name = {'Root': 'root', 'head': 'Head'}.get(g.name, g.name)

# ─── Materials ─────────────────────────────────────────────────────────────────────
def load_img(path, name, colorspace='sRGB'):
    img = bpy.data.images.load(path, check_existing=True)
    img.name = name; img.colorspace_settings.name = colorspace
    return img

def grey_copy(img, name):
    """A luminance-only copy of `img` normalised to GREY_MEAN, so the game can tint it."""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    lin = np.where(px[:, :3] <= 0.04045, px[:, :3] / 12.92, ((px[:, :3] + 0.055) / 1.055) ** 2.4)    # to linear for luminance
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lum = np.clip(lum / max(float(lum.mean()), 1e-4) * GREY_MEAN ** 2.2, 0, 1)
    srgb = np.where(lum <= 0.0031308, lum * 12.92, 1.055 * lum ** (1 / 2.4) - 0.055)
    out = bpy.data.images.new(name, w, h, alpha=False)
    out.colorspace_settings.name = 'sRGB'
    buf = np.empty((w * h, 4), dtype=np.float32); buf[:, :3] = srgb[:, None]; buf[:, 3] = 1.0
    out.pixels.foreach_set(buf.ravel()); out.pack()
    return out

def build_material(game_name, mhmat_path, tint=False, alpha=False, force_diffuse=None):
    kv, _ = parse_mh(mhmat_path)
    base = os.path.dirname(mhmat_path)
    mat = bpy.data.materials.new(game_name)
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Specular IOR Level'].default_value = 0.1
    tex = force_diffuse or (os.path.join(base, kv['diffuseTexture']) if 'diffuseTexture' in kv else None)
    if tex:
        img = load_img(tex, game_name + '_diffuse')
        if tint: img = grey_copy(img, game_name + '_grey')
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = img
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            nt.links.new(n.outputs['Alpha'], bsdf.inputs['Alpha'])
            mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else None
            mat.alpha_threshold = 0.5
    if 'normalmapTexture' in kv:
        nimg = load_img(os.path.join(base, kv['normalmapTexture']), game_name + '_normal', 'Non-Color')
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = nimg
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return mat

def set_mat(o, mat):
    o.data.materials.clear(); o.data.materials.append(mat)

def mhmat_of(kind, name):
    kv, mat = check_licence(kind, name)
    return mat

SK = lambda key: os.path.join(DATA, 'skins', SKINS[key], SKINS[key] + '.mhmat')
for key in SKINS:                                 # skins have to say CC0 too
    LICENCES[f'skins/{SKINS[key]}'] = {'cc0': 'cc0' in ' '.join(parse_mh(SK(key))[1]).lower()}
    if not LICENCES[f'skins/{SKINS[key]}']['cc0']: raise SystemExit(f'skin {SKINS[key]} has no CC0 header')
set_mat(parts['skin'], build_material('skin', SK('light')))
set_mat(parts['eyes'], build_material('eyes', os.path.join(DATA, 'eyes', 'materials', 'brown.mhmat'), alpha=False))
set_mat(parts['brows'], build_material('brows', mhmat_of('eyebrows', BROWS), alpha=True))
set_mat(parts['lashes'], build_material('lashes', mhmat_of('eyelashes', LASHES), alpha=True))
for k, n in HAIR.items(): set_mat(parts[f'hair_{k}'], build_material(f'hair_{k}', mhmat_of('hair', n), alpha=True))
for style, asset in TOPS.items():
    m = build_material(f'top_{style}', mhmat_of('clothes', asset), tint=True)
    set_mat(parts[f'top_{style}'], m)
    if style != 'tank': set_mat(parts[f'top_{style}_sleeve'], m)
set_mat(parts['pants_jeans'], build_material('pants_jeans', mhmat_of('clothes', JEANS), tint=True))
set_mat(parts['shoes_timbs'], build_material('shoes_timbs', mhmat_of('clothes', SHOES['timbs'])))
set_mat(parts['shoes_sneakers'], build_material('shoes_sneakers', mhmat_of('clothes', SHOES['sneakers']), tint=True))

# Skin textures for the other tones (the game swaps them): written as PNG next to the raw GLB.
for key in SKINS:
    kv, _ = parse_mh(SK(key))
    src = os.path.join(os.path.dirname(SK(key)), kv['diffuseTexture'])
    open(os.path.join(OUT, f'skin_{key}.path'), 'w').write(src)

# ─── Names, cleanup, export ────────────────────────────────────────────────────────
for name, o in parts.items():
    o.name = name; o.data.name = name
    o.vertex_groups  # touch
    for m in list(o.modifiers):
        if m.type != 'ARMATURE': o.modifiers.remove(m)
    # Hand-baked tweaks to the stack are gone; make sure every mesh is skinned to the rig and parented to it.
    o.parent = rig
    o.matrix_parent_inverse = Matrix.Identity(4)
rig.name = 'Armature'
for o in list(bpy.data.objects):
    if o not in parts.values() and o is not rig: bpy.data.objects.remove(o)

bpy.ops.object.select_all(action='DESELECT')
for o in list(parts.values()) + [rig]: o.select_set(True)
bpy.context.view_layer.objects.active = rig
raw = os.path.join(OUT, 'person_raw.glb' if VARIANT == 'balanced' else f'person_raw_{VARIANT}.glb')
bpy.ops.export_scene.gltf(filepath=raw, export_format='GLB', use_selection=True, export_apply=False, export_skins=True,
                          export_animations=False, export_yup=True, export_image_format='AUTO', export_materials='EXPORT',
                          export_extras=False, export_def_bones=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'person.blend' if VARIANT == 'balanced' else f'person_{VARIANT}.blend'))
json.dump(LICENCES, open(os.path.join(OUT, 'licences.json'), 'w'), indent=1)
print('WROTE', raw, 'objects', sorted(parts))
