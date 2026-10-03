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
