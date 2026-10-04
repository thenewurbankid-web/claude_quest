"""Renders the crowd's cut-out frames from public/boxing/models/person.glb (the CC0 MPFB person) in headless Blender.
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/build-crowd-person.py -- [--people 0,3] [--samples 64]
Writes assets-src/crowd/render/pNN_vK.png (RGBA, 192x384), K = 0 front, 1 .. 4 turning to the back; K=2 is a side view facing
image-right. Then `node scripts/build-crowd-atlas.mjs` packs them into textures/crowd_atlas.webp + .json.
Each person is one of PEOPLE: garments, tints and skin tone come from the same parts and hex colours the fighters use.
"""
import json, math, os, sys
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MODELS = os.path.join(ROOT, "public", "boxing", "models")
OUT = os.path.join(ROOT, "assets-src", "crowd", "render")
RW, RH = 192, 384          # 2x the atlas frame (96x192)
FRAME_M = 1.95             # frame height in metres; STAND_M tall person fits with a margin
FEET_M = 0.04
FIT_M = FRAME_M - FEET_M - 0.03
VIEWS = [0, 45, 90, 135, 180]
GREY_MEAN = 0.8            # garment textures are baked grey at this mean; the tint hex / 0.8 gives the colour

# name, skin, top part, top hex, sleeve hex, jeans, boots, cap (hex or None), cap backwards, arms up, width, height
PEOPLE = [
    ("deep",   "tee",     "#ecebe6", "#ecebe6", "#8fa8c4", "timbs",    "#1c2540", False, False, 1.00, 1.02),
    ("medium", "varsity", "#1f2a44", "#c9c6bf", "#2f3b52", "sneakers", None,      False, False, 0.96, 0.98),
    ("deep",   "hoodie",  "#16171a", "#16171a", "#8a8f96", "sneakers", None,      False, False, 1.06, 1.00),
    ("light",  "tee",     "#8fa8c4", "#8fa8c4", "#1d1e22", "sneakers", None,      False, True,  0.94, 0.95),
    ("medium", "tee",     "#8a1f2b", "#ecebe6", "#4f6b8f", "timbs",    "#7a1f26", True,  False, 1.02, 1.01),
    ("deep",   "hoodie",  "#8a8f96", "#8a8f96", "#2f3b52", "timbs",    None,      False, False, 1.08, 1.04),
    ("light",  "varsity", "#3d5a3a", "#3d5a3a", "#8fa8c4", "sneakers", None,      False, False, 0.98, 0.99),
    ("light",  "hoodie",  "#16171a", "#16171a", "#8a8f96", "sneakers", "#16171a", False, False, 1.04, 1.00),
    ("deep",   "hoodie",  "#8a8f96", "#8a8f96", "#4f6b8f", "timbs",    "#1c2540", False, False, 1.05, 0.97),
    ("medium", "tee",     "#ecebe6", "#ecebe6", "#2f3b52", "sneakers", "#1c2540", False, True,  1.00, 1.02),
    ("deep",   "tank",    "#16171a", "#16171a", "#4f6b8f", "timbs",    None,      False, True,  0.95, 0.96),
    ("light",  "tee",     "#2f3b52", "#2f3b52", "#8fa8c4", "sneakers", None,      False, True,  1.01, 1.03),
]
TOP_PARTS = {"tee": ["top_tee", "top_tee_sleeve"], "tank": ["top_tank"], "varsity": ["top_varsity", "top_varsity_sleeve"],
             "hoodie": ["top_hoodie", "top_hoodie_sleeve"]}
TINTED = {"top_tee", "top_tank", "top_hoodie", "top_varsity", "pants_jeans", "shoes_sneakers"}


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h, scale=1.0):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) * scale for i in (0, 2, 4))


def tint_material(mat, hex_, grey=True):
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    link = bsdf.inputs["Base Color"].links[0] if bsdf.inputs["Base Color"].is_linked else None
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    k = 1 / srgb_to_lin(GREY_MEAN) if grey else 1.0
    mul.inputs[7].default_value = (*hex_lin(hex_, k), 1)
    if link:
        nt.links.new(link.from_socket, mul.inputs[6])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])


def matte(mat):
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.85
    for k in ("Specular IOR Level", "Specular"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.1


def world_bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        for v in me.vertices:
            p = e.matrix_world @ v.co
            lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
        e.to_mesh_clear()
    return lo, hi


def rotate_bone(arm, name, axis, deg):
    pb = arm.pose.bones[name]
    head = pb.head.copy()
    m = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = m @ pb.matrix
    bpy.context.view_layer.update()


def pose_arms(arm, up):
    # T-pose: arms along +-X, the person faces -Y. Rotating about +Y takes +X toward -Z (down).
    for side, sgn in (("l", 1), ("r", -1)):
        if arm.pose.bones[f"upperarm_{side}"].head.x * sgn < 0:
            sgn = -sgn
        if up:
            rotate_bone(arm, f"upperarm_{side}", "Y", -sgn * 50)
            rotate_bone(arm, f"lowerarm_{side}", "Y", -sgn * 25)
        else:
            rotate_bone(arm, f"upperarm_{side}", "Y", sgn * 72)
            rotate_bone(arm, f"lowerarm_{side}", "Y", sgn * 8)


def make_cap(hair, hex_, backwards):
    lo, hi = world_bounds([hair])
    cx, cy, top = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z
    mat = bpy.data.materials.new("cap")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*hex_lin(hex_), 1)
    matte(mat)
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=24, ring_count=12, location=(cx, cy, top - 0.045))
    dome = bpy.context.object
    dome.scale = ((hi.x - lo.x) / 2 + 0.012, (hi.y - lo.y) / 2 + 0.012, 0.095)
    parts.append(dome)
    # The person faces -Y; the brim sits on the face side, or the back for a backwards cap.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=24, ring_count=8, location=(cx, cy + (0.12 if backwards else -0.12), top - 0.058))
    brim = bpy.context.object
    brim.scale = (0.075, 0.095, 0.01)
    parts.append(brim)
    for p in parts:
        p.data.materials.append(mat)
    return parts


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, "person.glb"))
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "GPU"
    sc.render.resolution_x, sc.render.resolution_y = RW, RH
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.78, 0.81, 0.86, 1)
    bg.inputs["Strength"].default_value = 0.85
    sc.world = w
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy, sun.angle = 1.6, math.radians(35)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-30))
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam")
    cam.type, cam.ortho_scale = "ORTHO", FRAME_M
    co = bpy.data.objects.new("cam", cam)
    co.location = (0, -10, FRAME_M / 2 - FEET_M)
    co.rotation_euler = (math.radians(90), 0, 0)
    sc.collection.objects.link(co)
    sc.camera = co
    return sc, co


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    people = list(range(len(PEOPLE)))
    samples = 64
    for i, a in enumerate(argv):
        if a == "--people":
            people = [int(x) for x in argv[i + 1].split(",")]
        if a == "--samples":
            samples = int(argv[i + 1])
    os.makedirs(OUT, exist_ok=True)
    json.dump({"up": [p[8] for p in PEOPLE], "frameHeightM": FRAME_M}, open(os.path.join(OUT, "people.json"), "w"))
    sc, co = build_scene()
    sc.cycles.samples = samples
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
    rest = {n: m.material_slots[0].material.copy() if m.material_slots else None for n, m in meshes.items()}
    for n, m in meshes.items():
        if rest[n]:
            matte(rest[n])
    skin_img = {}
    for tone in ("light", "medium", "deep"):
        img = bpy.data.images.load(os.path.join(MODELS, f"person_skin_{tone}.webp"))
        img.colorspace_settings.name = "sRGB"
        skin_img[tone] = img

    for idx in people:
        skin, top, top_hex, sleeve_hex, jeans, boots, cap, backwards, up, wd, ht = PEOPLE[idx]
        for b in arm.pose.bones:
            b.matrix_basis = Matrix()
        bpy.context.view_layer.update()
        arm.rotation_euler = (0, 0, 0)
        arm.scale = (1, 1, 1)
        arm.location = (0, 0, 0)
        shown = ["skin", "eyes", "brows", "lashes", "pants_jeans", f"shoes_{boots}", *TOP_PARTS[top]]
        if not cap:
            shown.append("hair_short02" if skin == "light" else "hair_short01")
        extra = []
        for name, o in meshes.items():
            on = name in shown
            o.hide_render = not on
            if not on:
                continue
            mat = rest[name].copy()
            o.material_slots[0].material = mat
            if name == "skin":
                for n in mat.node_tree.nodes:
                    if n.type == "TEX_IMAGE":
                        n.image = skin_img[skin]
            elif name in TINTED:
                tint_material(mat, jeans if name == "pants_jeans" else "#ececea" if name == "shoes_sneakers" else top_hex)
            elif name.endswith("_sleeve"):
                tint_material(mat, sleeve_hex if name == "top_varsity_sleeve" else top_hex)
        pose_arms(arm, up)
        if cap:
            extra = make_cap(meshes["hair_short02"], cap, backwards)
            for p in extra:
                p.parent = arm
        arm.scale = (wd, wd, ht)
        bpy.context.view_layer.update()
        vis = [meshes[n] for n in shown] + extra
        lo, hi = world_bounds(vis)
        s = min(1.0, FIT_M / (hi.z - lo.z))
        arm.scale = (wd * s, wd * s, ht * s)
        bpy.context.view_layer.update()
        lo, hi = world_bounds(vis)
        arm.location.z = -lo.z
        for v, deg in enumerate(VIEWS):
            co.rotation_euler = (math.radians(90), 0, math.radians(-deg))
            co.location = Matrix.Rotation(math.radians(-deg), 3, "Z") @ Vector((0, -10, FRAME_M / 2 - FEET_M))
            sc.render.filepath = os.path.join(OUT, f"p{idx:02d}_v{v}.png")
            bpy.ops.render.render(write_still=True)
        for p in extra:
            bpy.data.objects.remove(p)
        print(f"person {idx}: {skin} {top} {'cap' if cap else 'hair'} up={up} scale={s:.3f}")


main()
