"""Generates the crowd's source photos with a local ComfyUI (Z-Image-Turbo + BiRefNet cut-out), five views per person.

Start ComfyUI yourself (`cd ~/Repositories/ComfyUI && .venv/bin/python main.py --port 8188`), then, with its python:
  ~/Repositories/ComfyUI/.venv/bin/python scripts/gen_crowd_photos.py [--people 0,3] [--force]
Writes assets-src/crowd/pNN_vK.png (photo) and pNN_vK_mask.png (matte), K = 0 front, 1 three-quarter, 2 side, 3 back
three-quarter, 4 back. Existing files are kept unless --force. Then run scripts/build-crowd-atlas.py.
The side views face image-left (the atlas builder's `flip` -1 relies on it). Seeds are fixed, so the same people come back each run. Outfits follow CROWD_WEAR in arena-babylon.js (the reference photo).
"""
import argparse, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import comfy_lib

W, H = 288, 576          # 3x the 96x192 frames, so the atlas is a clean 3:1 downscale
OUT = os.path.join(os.path.dirname(__file__), "..", "assets-src", "crowd")

# (description, arms up)
PEOPLE = [
    ("a 28 year old Black man with dark brown skin, navy fitted baseball cap, plain white oversized t-shirt, light wash blue jeans, wheat Timberland boots", False),
    ("a 24 year old light-brown-skinned man with short black hair, navy varsity jacket with pale grey sleeves, dark indigo jeans, white sneakers", False),
    ("a 31 year old medium-brown-skinned man with a short beard, black hoodie, grey jeans, black sneakers", False),
    ("a 26 year old Latina woman with her hair tied back, light blue denim jacket over a white t-shirt, black jeans, white sneakers", False),
    ("a 22 year old tan-skinned man wearing a red fitted cap backwards, burgundy and white t-shirt, faded blue jeans, wheat Timberland boots", False),
    ("a 35 year old dark-skinned man, grey hoodie with the hood down, dark jeans, wheat Timberland boots", False),
    ("a 29 year old olive-skinned man, olive green bomber jacket, light wash jeans, white sneakers", False),
    ("a 33 year old white man with light stubble, black beanie, black puffer jacket, grey sweatpants, black sneakers", False),
    ("a 40 year old Black man with a grey-flecked beard, navy flat cap, grey crewneck sweatshirt, blue jeans, brown boots", False),
    ("a 27 year old medium-brown-skinned man, navy fitted cap, white t-shirt, dark jeans, white sneakers", True),
    ("a 23 year old Black woman with braids, black hoodie, light wash jeans, wheat boots", True),
    ("a 30 year old light-skinned man with a shaved head, charcoal t-shirt, light blue jeans, black sneakers", True),
]
VIEWS = [
    "facing the camera",
    "body turned three quarters toward the left of the image, face turned slightly back toward the camera",
    "standing in pure side profile, facing left",
    "seen from behind at a three-quarter angle, turned toward the left of the image, face mostly hidden",
    "seen from directly behind, back to the camera",
]
ARMS = {False: "arms relaxed at his sides", True: "both arms raised high above the head, fists up, cheering loudly"}


def prompt(i, v):
    who, up = PEOPLE[i]
    arms = ARMS[up].replace("his", "their") if "woman" in who else ARMS[up]
    return (f"Full-length photo of {who}, {VIEWS[v]}, standing, {arms}. Head to toe in frame. Plain flat light grey studio backdrop, "
            "even soft overcast daylight, sharp realistic photograph, natural skin, detailed fabric.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--people", default="")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    ids = [int(x) for x in a.people.split(",")] if a.people else range(len(PEOPLE))
    os.makedirs(OUT, exist_ok=True)
    for i in ids:
        for v in range(len(VIEWS)):
            f = os.path.join(OUT, f"p{i:02d}_v{v}.png")
            if os.path.exists(f) and not a.force:
                continue
            t = time.time()
            out = comfy_lib.zimage(prompt(i, v), W, H, seed=1000 + i, cutout=True, prefix=f"crowd_p{i:02d}_v{v}")
            photo, mask = (out[k][0] for k in sorted(out, key=int))
            open(f.replace(".png", "_mask.png"), "wb").write(mask)
            open(f, "wb").write(photo)
            print(f"person {i} view {v}: {time.time() - t:.1f}s", flush=True)
