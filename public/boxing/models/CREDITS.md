# Boxer models: credits and licences

Every file in this folder is built by `scripts/build-boxing-models.mjs` from free packs by **Quaternius**
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

Not from a pack (drawn in code in `arena-babylon.js`): gloves, trunks, the ring, the crowd, the canvas texture.
