"""Packs assets-src/crowd/*.png (from gen_crowd_photos.py) into public/boxing/textures/crowd_atlas.webp + crowd_atlas.json.
Run with ComfyUI's python (it has Pillow with WebP and numpy):  ~/Repositories/ComfyUI/.venv/bin/python scripts/build-crowd-atlas.py
Rows are people, columns the five views (front .. back); the renderer mirrors them for the other side. Frames are 96x192,
every view of a person is scaled alike and stands on the same baseline. The matte is eroded a pixel so no grey backdrop
rims the cut-out, and colour is premultiplied while resizing so edges don't halo.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), "..", "assets-src", "crowd")
DST = os.path.join(os.path.dirname(__file__), "..", "public", "boxing", "textures")
FW, FH, COLS = 96, 192, 5
PERSON_M = 1.75      # a standing person's height, metres
STAND_PX = 172       # ...and in frame pixels; the rest of the frame is margin
FEET = FH - 4


def load(i, v):
    photo = Image.open(os.path.join(SRC, f"p{i:02d}_v{v}.png")).convert("RGB")
    m = Image.open(os.path.join(SRC, f"p{i:02d}_v{v}_mask.png")).convert("L").filter(ImageFilter.MinFilter(3))
    a = np.asarray(m, np.float32) / 255
    a = np.clip((a - 0.2) / 0.6, 0, 1)
    return np.asarray(photo, np.float32) / 255, a


def bbox(a):
    ys, xs = np.where(a > 0.5)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def frame(rgb, a, scale):
    x0, y0, x1, y1 = bbox(a)
    pre = np.dstack([rgb * a[..., None], a])
    img = Image.fromarray((pre * 255).astype(np.uint8), "RGBA")
    w, h = img.size
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    img = img.resize((sw, sh), Image.LANCZOS)
    arr = np.asarray(img, np.float32) / 255
    al = arr[..., 3:4]
    out = np.dstack([np.where(al > 0.01, arr[..., :3] / np.maximum(al, 1e-3), 0).clip(0, 1), al])
    cx = round((x0 + x1) / 2 * scale)
    bottom = round(y1 * scale)
    canvas = np.zeros((FH, FW, 4), np.float32)
    ox, oy = FW // 2 - cx, FEET - bottom
    for y in range(sh):
        for_y = y + oy
        if 0 <= for_y < FH:
            xs0, xs1 = max(0, -ox), min(sw, FW - ox)
            if xs1 > xs0:
                canvas[for_y, xs0 + ox:xs1 + ox] = out[y, xs0:xs1]
    return canvas


def main():
    people = sorted({int(os.path.basename(f)[1:3]) for f in glob.glob(os.path.join(SRC, "p??_v0.png"))})
    people = [i for i in people if all(os.path.exists(os.path.join(SRC, f"p{i:02d}_v{v}.png")) for v in range(COLS))]
    if not people:
        raise SystemExit("no complete people in assets-src/crowd; run gen_crowd_photos.py")
    sys.path.insert(0, os.path.dirname(__file__))
    UP = [up for _, up in __import__('gen_crowd_photos').PEOPLE]
    loaded = {i: [load(i, v) for v in range(COLS)] for i in people}
    stand = [bbox(loaded[i][0][1]) for i in people if not UP[i]]
    heights = [y1 - y0 for _, y0, _, y1 in stand]
    base = STAND_PX / float(np.median(heights))
    atlas = np.zeros((FH * len(people), FW * COLS, 4), np.float32)
    for r, i in enumerate(people):
        s = base
        if UP[i]:   # arms raised: the whole figure has to fit
            s = min(base, (FH - 6) / (bbox(loaded[i][0][1])[3] - bbox(loaded[i][0][1])[1]))
        for v in range(COLS):
            atlas[r * FH:(r + 1) * FH, v * FW:(v + 1) * FW] = frame(*loaded[i][v], s)
    out = Image.fromarray((atlas * 255).round().astype(np.uint8), "RGBA")
    path = os.path.join(DST, "crowd_atlas.webp")
    out.save(path, quality=82, alpha_quality=90, method=6)
    meta = {"cols": COLS, "rows": len(people), "frame": [FW, FH], "aspect": FW / FH, "frameHeightM": round(PERSON_M * FH / STAND_PX, 4),
            "flip": -1, "up": [bool(UP[i]) for i in people]}
    json.dump(meta, open(os.path.join(DST, "crowd_atlas.json"), "w"))
    print(f"{len(people)} people -> {path} {out.size} {os.path.getsize(path) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
