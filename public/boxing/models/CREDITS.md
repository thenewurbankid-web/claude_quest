# Models: credits and licences

The boxer files below are built by `scripts/build-boxing-models.mjs` from free packs by **Quaternius**
(https://quaternius.com, https://www.patreon.com/quaternius). All three are **CC0 1.0 Universal** (public domain
dedication, https://creativecommons.org/publicdomain/zero/1.0/): free for personal, educational and commercial use,
no attribution required. We credit them anyway.

| File | Source pack (free Standard version) | What we took | Licence |
|---|---|---|---|
| `boxer.glb` | Universal Base Characters [Standard], quaternius.itch.io/universal-base-characters (122 MB zip, downloaded 2026-10-03) | `Superhero_Male_FullBody` (mesh, skin, textures resized to 1024 px WebP) | CC0 1.0 (`License_Standard.txt` in the zip) |
| `skin_light.webp` | Universal Base Characters [Standard] (same zip) | `Textures/T_Superhero_Male_Ligh.png`, resized to 1024 px WebP; the red corner's skin | CC0 1.0 |
| `anims.glb` | Universal Animation Library [Standard], quaternius.itch.io/universal-animation-library (15 MB zip, 2026-10-03) | Idle_Loop, Punch_Jab, Punch_Cross, Hit_Head, Hit_Chest, Death01, Walk_Loop, Jog_Fwd_Loop, Crouch_Idle_Loop | CC0 1.0 (`License.txt`) |
| `anims.glb` | Universal Animation Library 2 [Standard], quaternius.itch.io/universal-animation-library-2 (17 MB zip, 2026-10-03) | Melee_Hook, Melee_Hook_Rec, Hit_Knockback, LayToIdle | CC0 1.0 (`License.txt`) |

All three share one humanoid rig (pelvis, spine_01..03, upperarm_l, lowerarm_l, hand_l, thigh_l, ...), so the clips
play on the character directly. The finger channels and the animation library's mannequin mesh were dropped.

Not from a pack (drawn in code in `arena-babylon.js`): gloves, trunks, the ring, the canvas texture (the crowd is rendered from `person.glb`, see `textures/CREDITS.md`).

## The realistic person (`person.glb`, `person_skin_light|medium|deep.webp`)

Built in Blender 5.2 by `scripts/build-mpfb-boxer.py` (headless) and compressed by `scripts/build-mpfb-models.mjs`. It is a
male human made with **MPFB 2.0.17** (MakeHuman for Blender, https://extensions.blender.org/add-ons/mpfb/, installed from
the public extensions site with no login), on MPFB's `game_engine` rig, posed into the Quaternius T-pose and given the
Quaternius bone orientations so `anims.glb` plays on it unchanged.

Licences, as MPFB's FAQ states and each asset's own header repeats (`build-mpfb-boxer.py` refuses any asset whose
header has no CC0 line; the headers it read are in `assets-src/build/mpfb/licences.json`):
- The MPFB add-on is GPL-3.0. It is only a tool run at build time; nothing of its code ships. The base mesh, targets, rig
  and the asset packs below are **CC0 1.0**, so the GLB is CC0. Pack zips (`*_cc0.zip`, from files2.makehumancommunity.org,
  downloaded 2026-10-04, not in git): `makehuman_system_assets`, `skins01-03`, `hair01`, `eyebrows01`, `eyelashes01`,
  `shirts01`, `pants01`, `shoes01` (the others, `hats01`, `gloves01`, `jewelry01`, were downloaded but not used). CC-BY packs
  were deliberately not downloaded.

| In `person.glb` | MPFB asset | Author per its header |
|---|---|---|
| `top_tee`, `top_tank`, `top_tee_sleeve` | `elvs_crude_t-shirt_male` | MakeHuman, edited by Elvaerwyn, CC0 |
| `top_varsity`, `top_varsity_sleeve` (the jacket) | `male_casualsuit05` (its shirt) | Data Collection AB, Joel Palmius, Jonas Hauquier, CC0 |
| `pants_jeans` | `male_casualsuit04` (its trousers) | same, CC0 |
| `top_hoodie`, `top_hoodie_sleeve` (a knit sweater) | `toigo_fisherman_sweater` | MRT, CC0 |
| `shoes_timbs` | `toigo_ankle_boots_male` | MRT, CC0 |
| `shoes_sneakers` | `shoes05` | Data Collection AB et al., CC0 |
| `hair_short01`, `hair_short02` | `short01`, `short02` | same, CC0 |
| eyes, brows, lashes | `low-poly`, `eyebrow001`, `eyelashes01` | same, CC0 |
| skin, `person_skin_*.webp` | `young_caucasian_male` (light), `young_asian_male` (medium), `young_african_male` (deep) | same, CC0 |

Garment textures are converted to grey (shading kept) so the game can tint them with a look's colours; normal maps were
dropped and textures resized to 1024 px WebP.

## The day court (`court.glb`, `court_sky.webp`)

Built in Blender 5.2 by `scripts/bake-court.py` (geometry, UVs, Cycles light bake, glTF export) and compressed by
`scripts/build-court.mjs`. The geometry is ours (modelled in the script). Everything it uses from elsewhere is CC0 1.0
from **Poly Haven** (https://polyhaven.com, public domain, no attribution required):

| Used for | Poly Haven asset | File | Downloaded |
|---|---|---|---|
| The light (baked into the lightmaps and vertex colours) and `court_sky.webp` | Bethnal Green Entrance HDRI, polyhaven.com/a/bethnal_green_entrance | `bethnal_green_entrance_1k.hdr` (1.8 MB) | 2026-10-03 |
| Lintels, sills, cornices, curbs, roofs | Concrete Wall 008, polyhaven.com/a/concrete_wall_008 | `concrete_wall_008_diff_1k.jpg`, `_nor_gl_1k.jpg` | 2026-10-03 |
| Tree trunks and branches | Bark Brown 02, polyhaven.com/a/bark_brown_02 | `bark_brown_02_diff_1k.jpg`, `_nor_gl_1k.jpg` | 2026-10-03 |
| Asphalt, brick, sidewalk, the dumpster | as listed in `../textures/CREDITS.md` | | |

The downloads live in `assets-src/polyhaven/` (not in git, like the Quaternius zips); `court.glb` embeds the colour
maps resized to 512 px WebP. The chain-link texture is generated by the script.
