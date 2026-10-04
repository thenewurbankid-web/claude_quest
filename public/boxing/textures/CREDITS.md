# Textures

All from Poly Haven (https://polyhaven.com), licence CC0 (public domain, no attribution required).
Downloaded 2026-10-03 at 1k JPG and resized to 512 px WebP by hand (sharp). `*_diff` is colour, `*_nor` an OpenGL normal map.

| File | Poly Haven asset | Use |
|---|---|---|
| asphalt_* | asphalt_02 | road |
| brick_red_* | red_brick_03 | tenement walls |
| brick_dirty_* | brick_4 (Rob Tuytel) | alternate wall brick |
| sidewalk_* | concrete_floor_worn_001 | sidewalks |
| rust_* | rusty_metal_02 | barrels, dumpster |

These are wired into the procedural court (`buildStreet()`) and, through `scripts/bake-court.py`, into the baked
`models/court.glb`; the bake's extra Poly Haven files (HDRI, concrete, bark) are listed in `../models/CREDITS.md`.

## Crowd photos (`crowd_atlas.webp`, `crowd_atlas.json`)

Generated locally on 2026-10-04 by `scripts/gen_crowd_photos.py` and packed by `scripts/build-crowd-atlas.py`; the photos are of
people who do not exist (text-to-image), so there is nobody to credit or release. Tools, both free to use:

| Tool | Licence | Source |
|---|---|---|
| Z-Image-Turbo (`z_image_turbo_bf16.safetensors`), text to image | Apache-2.0 (Tongyi-MAI, Alibaba) | https://huggingface.co/Tongyi-MAI/Z-Image-Turbo |
| BiRefNet-general, background cut-out | MIT (Peng Zheng et al.) | https://huggingface.co/ZhengPeng7/BiRefNet |
| Qwen3 4B text encoder (`qwen_3_4b.safetensors`, Z-Image's own) | Apache-2.0 (Alibaba Qwen) | https://huggingface.co/Qwen/Qwen3-4B |
| ComfyUI + ComfyUI-RMBG (the nodes that run them) | GPL-3.0 (tools only, not shipped) | https://github.com/comfyanonymous/ComfyUI |

The weights are not in the repo. Source PNGs and mattes are in `assets-src/crowd/` (git-ignored).
