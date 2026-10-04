# Boxing Manager AI: handoff

Worktree `.claude/worktrees/boxing-manager-ai`, branch `worktree-boxing-manager-ai`, based on `3d-world`.
Live tracker: https://claude.ai/artifact/PRsPyaXBu4g9UpCFbPwP3K (its `db` holds `tasks/t01..t12`,
`log/l01..l12`, `meta/status` and `meta/balance`; update them with ArtifactData and pin each write with `if_version`).

## Done (2026-10-03): the 3D view, stage 1 (procedural boxers)

- `public/boxing/arena-babylon.js`: `createArena3D({ parent, sim, names })` lazily loads `/vendor/babylonjs/babylon.js`
  (npm `babylonjs` 7.54.3, UMD) and only reads `sim.snapshot()` plus 'impact' / 'round_end' / 'fight_end'.
  Ring (canvas texture drawn in code, posts, pads, four ropes, stools, apron), lighting truss with glow, ~2k thin-instanced
  crowd that bounces on big shots, flash bulbs, press tables. Boxers are primitives posed each frame with two-bone IK
  (arms and legs), orthodox stance, torso twist per punch type, punch paths per type (straight, hook arc, uppercut,
  body), windup cock-back, block (guard up) and slip (lean) from the opponent's punch outcome, head snap / body fold
  springs on impact, planted feet that step, fatigue sag, wobble when hurt, knockdown fall on KO. Broadcast cameras:
  CAM 1 hard camera tracking the pair, CAM 3 ringside cut on big shots and on the KO, CAM 2 slow wide orbit between
  rounds; shake on impact, ACES grade, bloom, vignette; DOM overlay with LIVE bug, round banners and lower thirds.
- `index.html`: the Headless checkbox is now a View select (3D broadcast, the default / 2D top-down / Headless).
  Phaser always steps the sim; outside 2D it runs headless with a detached parent (its headless mode still makes a canvas).
- Checked on port 4794 (`boxing-static-2`, defined in the main checkout's `.claude/launch.json` because the preview tool
  reads that one): rounds run, punches and spray show, no console errors. `npm test` 93 pass (new IK test).

## Done (2026-10-03): real boxer models (stage 2)

- Assets: the free Quaternius CC0 packs (Universal Base Characters, Universal Animation Library 1 and 2, all one rig).
  `scripts/build-boxing-models.mjs <unzipped packs>` (gltf-transform + sharp, devDependencies) writes
  `public/boxing/models/boxer.glb` (0.81 MB), `skin_light.webp` (0.03 MB) and `anims.glb` (0.33 MB, 13 clips, finger
  channels dropped). Licences and sources in `models/CREDITS.md`. The zips themselves are not in the repo.
- `public/boxing/boxer-model.js`: `ModelRig` samples clips per bone itself (`Animation.evaluate`) and blends layers, so a
  punch clip is scrubbed to the sim's launch → arrive ticks (impact at 25 % of Punch_Jab, 30 % of Punch_Cross, 42.5 % of
  Melee_Hook, measured in `dev-model.html`). Two-bone IK on the real arm bones (`aim` works through the parent's world
  matrix, so the glTF root's mirroring doesn't matter) holds the guard (relative to the head bone) and drives the
  uppercut, body shot and hook arcs; jab and cross come from their clips with IK pulling them onto the target at impact.
  Hit_Head / Hit_Chest / Hit_Knockback on landed shots, Death01 on the KO. Gloves, trunks, belt and high-top boots are
  drawn in code and placed on the bones each frame. Skin is rebuilt as StandardMaterial (no environment map in the
  arena, so PBR came out near black); red has the light skin, blue the dark.
- `arena-babylon.js` uses `ModelBoxer` and falls back to the primitive boxers if the models fail to load. `?debug` on the
  page exposes `__bmArena` (scene, engine, boxers). Vector/IK helpers moved to `pose-math.js`.
- Gaps: no free uppercut or body-shot clips (IK fakes them), no boxing footwork clip (Walk_Loop at ≤ 45 % while moving,
  feet slide a little), the trunks are a rigid cylinder over the model's briefs, one body model for both corners, no hair.
  LayToIdle (getting up) is unused because the sim has no knockdowns other than the KO.

## Done (2026-10-03): street fight setting (stage 3)

The user switched the setting mid-way through the lighting pass: "can we make it street fighting instead? ... and have
cool street theme". They picked **new setting, same physics**: `CombatSimulation`, logs, RAG and P2P are untouched.
- `arena-babylon.js`: the ring, truss and stands are gone. `buildStreet()` is a back lot at night, 26 m square, every
  texture drawn in code. It has wet asphalt with a blurred `MirrorTexture` reflection (fresnel, strongest at a grazing
  angle), the sim's ring sprayed on the ground (square, red/blue corner dots, centre X, "NO ROPES"), brick walls with
  lit/dark/TV-flicker windows, roller doors, drainpipes and graffiti pieces, four neon signs with coloured point lights
  (one stutters), a sodium street lamp, string lights, three fire barrels (flames, smoke, flickering light), two cars
  with headlight spots and flares, a chain-link fence, a dumpster, pallets, a steaming manhole and rain. The onlookers
  are thin-instanced people in three rows, open on the hard camera's side.
- Lighting: moonlight hemi, a work lamp over the fight (the key and the shadow caster) and a wide flood. 15 lights in
  all; at night each ranged light is limited to the meshes it reaches (`limitLights`), a mesh in reach of more keeps its
  strongest, and every material gets `maxSimultaneousLights = 8` (phones allow ~16 uniform blocks). A `ReflectionProbe` (refreshed every 30 frames) stands in
  for an HDRI on glass, car paint and skin sweat. Post: ACES, exposure 1.2, vignette 1.4, light chromatic aberration,
  sharpen.
- `boxer-model.js`: `colors.wraps` gives taped fists instead of gloves and low sneakers instead of high-tops (white on
  red, black on blue). `colors.sheen` adds sweat to the skin.
- Overlay: "● LIVE · BACK LOT", with CAM 2 · ROOFTOP and CAM 3 · CROWD.
- Checked at 1280×720 in the preview: hard, crowd and rooftop shots, about 45 fps, no console errors, `npm test` 93 pass.
- Not done: the primitive fallback `Boxer` still wears gloves; the onlookers are simple shapes (no arms raised, no
  phones); there is no rain splash on the ground. The page title, `index.html` copy and names still say "Boxing".

## Done (2026-10-03, uncommitted at first): New York dressing, matte look

- User: "make them have hip hop style clothing and make the world like new york alley nd streets". The world part is
  done: `buildNewYork()` adds fire escapes, cornices, a water tower, a bodega (DELI · GROCERY · 24 HR, striped awning,
  lit window), a yellow cab, a hydrant, trash bags, the Con Ed steam stack, subway globes, LENOX AV / W 125 ST signs
  and a basketball hoop on the fence. Graffiti and neon are New York themed, and the overlay reads "LIVE · UPTOWN NYC".
- `mergeStatic()` merges static meshes by material. Without it, the scene went from 480 meshes and 3,500 draw calls
  down to 2 fps. With it, the scene has 115 meshes and runs at 60 fps.
- User: "no need of shiny graphics" → picked "drop gloss and reflections". The wet-ground mirror, reflection probe, skin
  sweat, glossy cars, bloom and chromatic aberration are gone, and the `mat()` helper caps specular at 0.1. The glow
  layer stays at 0.3 so neon still reads as neon.
- User then: "photo realitic textures no shiny is also ok", "you can downoad". Five CC0 Poly Haven textures are in
  `public/boxing/textures/` (see CREDITS.md there) but **not wired in yet**.

## Done (2026-10-03): the reference photo rebuilt (day, with a night toggle)

The user sent a photo (a New York cypher at a neighbourhood basketball court) and asked for the same look: "SAME COLOR
AND LIGHTING", and "THE OUTFITS WILL BE THE ONES IN THE PHOTO FOR CROWD AND CHARACTERS". They picked **day, with a
night toggle**.
- `arena-babylon.js` `buildStreet()` is now the court. It has photo-textured asphalt and a lighter court surface with
  worn lines, a 4.2 m chain-link fence (`COURT.half` 9.6), a gooseneck hoop at +z behind the crowd (centred in the hard
  camera's view, as in the photo), sidewalks with curbs, and street trees. Round it are 5-floor brick tenements
  (`brick_red` photo texture, `LOOK.floors`) with lintels, sills, AC units, bars on the first floor and fire escapes.
  The green-awning deli is on the far wall. `buildNight()` holds the neon, string lights, fire barrels and rain; the
  sodium lamp, headlights, lit windows and shop lights are gated on `night` as well.
- Light: day is overcast (pale grey sky and fog, hemi 1.05, a faint directional with soft 0.25 shadows, colour curves
  at −22 saturation with a green-cyan shadow tint). Night is the old setup. `createArena3D({ timeOfDay })`; the page
  has a **Time** select (Day/Night) next to View, which applies to the next fight.
- Crowd: every part is thin-instanced separately (caps, heads, tops, sleeves, hands, jeans, boots) in `CROWD_WEAR`
  colours from the photo. They stand four rows deep and lean in, and a fifth have their arms up.
- Fighters: `boxer-model.js` `paintOutfit()` paints the clothes onto the body texture. It picks each triangle's zone
  from its dominant bone and keeps the base shading as folds; denim gets a twill. `PHOTO_OUTFITS`: red wears a white
  tee, light-wash jeans, wheat Timberland-style boots, a backwards navy cap, a gold chain and red wraps. Blue wears a
  navy varsity jacket with light sleeves, dark jeans, white sneakers, a chain and blue wraps. The jeans replace the trunks.
- Checked at 1280×720: the day hard camera frames like the photo, 60 fps, `npm test` 93 pass.
- Known issues: night's first load takes about 15 s while the 15-light shaders compile (day about 3 s; now hidden by a loading card, see BOX-2). The crowd gap on the hard camera's side shows on the
  rooftop shot. The paint seams at the garment edges are jagged (they read as frayed). The primitive fallback fighters
  don't get outfits.

## Done (2026-10-03): the day court baked in Blender (job 1 of the last list)

User: "please make the 3d photorealistic", "use blender and texture mapping"; picked "environment bake first". Fighters
and crowd are unchanged. Approved changes from the plan: no roughness maps (a baked diffuse court never reads them) and no
`.env` (the fighters are StandardMaterial; the HDRI is used for a sky dome and the fill colour instead).
- `scripts/bake-court.py` (Blender 5.2, headless): `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup
  --python scripts/bake-court.py -- [--quick] [--samples N] [--court 1.35]`, then `node scripts/build-court.mjs`.
  Full bake about 1 min on the M5 GPU (Metal); `--quick` is 10 s and noisy. Writes `assets-src/build/` (git-ignored,
  includes `court.blend` to inspect), then `public/boxing/models/court.glb` (3.3 MB) and `court_sky.webp` (118 KB).
- The script models the court in Babylon coordinates (`C()` converts) at `buildStreet()`/`buildNewYork()`'s layout:
  court, street ring, sidewalk and curb, tenements with recessed windows (frame, glass, meeting rail), lintels, sills,
  AC units, bars, fire escapes with slatted decks and stairs, cornices, roofs, roller doors, fence and posts, hoop and
  chain net, trees with leaf cards, lamppost, cars, dumpster, pallets, awning, water tower, hydrant, trash bags, Con Ed
  stack, subway posts. Moved slightly so nothing sinks into the 15 cm sidewalk: manhole/stack at x −10.2, hydrant at 11.3.
- Light: Poly Haven `bethnal_green_entrance` HDRI only. Groups: `court_ground`, `court_walls`, `court_props` get
  lightmaps on UV1 (2048/2048/1024, Smart UV + concave repack); `court_details`, `court_leaves` get per-corner vertex
  colours; `court_fence` is unbaked. Light = Cycles diffuse direct+indirect × (0.55 + 0.45 AO). Exposure is calibrated
  so the court centre comes out at 1.35 × albedo (what the procedural day hemi + key gave). Encoding in the file header;
  `court_info` extras carry `lmLevel`, `court`, `exposure`, `skyUp`.
- Babylon: `buildBakedCourt()` in `arena-babylon.js` turns every glTF material into an unlit StandardMaterial
  (emissive = `tint` extra × albedo × lightmap × `lmLevel`; vertex-colour materials get a 1×1 white lightmap that
  carries the level). Ground materials keep the key light's share so fighters and crowd still cast contact shadows; the
  hemi fill excludes the court and takes the HDRI's sky colour. Signs, graffiti, court lines, steam and the crowd stay
  procedural on top. Night, or a failed load, uses `buildStreet()` (checked by moving `court.glb` away).
- Two traps: the glTF loader uploads colour images as sRGB buffers, which StandardMaterial (gamma space) draws far too
  dark, so the court loads with `useSRGBBuffers = false`. In Blender, set an image's colour space before writing its
  pixels; setting it afterwards clears them.
- Checked at 1280×720 (hard, rooftop, ringside): about 6.5 ms a frame at 2560×1440, `npm test` 93 pass.
- Not done: the trees are still sparse cards, the cars are boxes, the onlookers are unchanged, and night isn't baked.

## Done (2026-10-04): character creation, looks + name (job 2)

Built in 9717ad6 (WIP) and finished here. `boxer-model.js`: `LOOK_OPTIONS`, `normalizeLook`, skin tones (medium = light texture tinted in `paintOutfit`). `look-preview.js`: live preview, one `ModelBoxer` rebuilt on each change. `index.html`: Look panel; the look is saved in the Dexie `fighters` row and re-normalized on boot. New `profile.js`: `profileOf` (ships `look: normalizeLook(...)`, render-only, `FighterModel` ignores it) and `receivedProfile`, which `startMatch` applies to both corners, so a P2P look always goes through `normalizeLook` before the arena. The AI corner has no look and wears the blue photo outfit; a peer without one gets its corner's photo outfit. Tests: `normalizeLook`, `profileOf`/`receivedProfile`, and a look doesn't change a fight. `npm test` 96 pass.
- **Untested in a browser** (nothing here has been run): the Look panel at 375px, the preview scene (lighting, framing, rebuild without leaking textures or breaking the arena's shared assets), skin tones, a reload keeping the look, two tabs of P2P showing each other's look, the AI opponent's outfit.
- Not done: archetype AI opponents all share the blue photo outfit; the primitive fallback fighters ignore looks.

## Done (2026-10-04): night shader on phone GPUs (BOX-6)

`arena-babylon.js`: `limitLights()` sets `includedOnlyMeshes` on each ranged night light (point/spot) to the meshes whose bounds reach its range (beyond it the light is black anyway). A mesh in reach of more than 8 (ground, roofs, crowd) keeps the strongest 8 counting the moon and work lamp; the crowd's thin-instance bounds are refreshed first. `maxSimultaneousLights` is now 8 for every material (day too; it has 2 lights). All 15 lights stay. Measured at night in headless Chromium at 400 px: `scene.isReady()` true, max 8 lights on any mesh, no shader errors, card gone in ~6 s (software GL). Screenshots, same camera: `public/boxing/qa/box-6-night-before.png` / `-after.png`.
- **Look change**: slightly darker than before, mostly the crowd rim and the far ground, where the weakest lights no longer reach. Raise light intensities if you want it back; I didn't, as that is an art call.
- **Untested**: the real phone failure (this machine's GL allows 72 uniform buffers, so the old code compiled here too), lights on fighters as they move to the ring edge (margin 3 m from setup bounds), day view.

## Done (2026-10-04): night load card (BOX-2)

`arena-babylon.js`: the overlay now has a loading card ("Setting up the fight", plus "Night takes a little longer the first time" at night). `createArena3D` awaits `scene.whenReadyAsync()` (capped at 60 s) before starting the render loop, so the shaders compile behind the card instead of a frozen page; the card fades out and removes itself. All views and both times of day get it. No lights removed, look unchanged. `npm test` passes (96); no test covers it (needs WebGL).
- **Untested in a browser**: that the card shows during night's compile, that the page stays responsive, how long night actually takes now, the card at 375px, and that day still starts without a visible flash.

## Done (2026-10-04): realistic people from Blender (BOX-3)

Gate passed first: MPFB 2.0.17 installs from extensions.blender.org with no login, and its base mesh, rig and the `*_cc0.zip`
asset packs are CC0 (add-on code is GPL-3.0 but only runs at build time). It is installed into Blender's user config
(`~/Library/Application Support/Blender/5.2/extensions/.user/user_default/mpfb`); the zips are in `assets-src/mpfb/` (git-ignored).
- `scripts/build-mpfb-boxer.py` (headless Blender; setup and run commands in its docstring) builds a male human on MPFB's
  `game_engine` rig (UE bone names), one skinned mesh per garment option, poses it into the Quaternius T-pose and bakes that
  in, then gives every bone its Quaternius name (`root`, `Head`) and rest orientation, so `anims.glb` plays unchanged. It
  refuses any asset without a CC0 line in its header. The spine pivots are moved to the Quaternius heights (MPFB's sit low and
  the head swung 15 cm too far). `scripts/_glbdump.py` reads glTF node matrices through Blender. Then
  `node scripts/build-mpfb-models.mjs` writes `public/boxing/models/person.glb` (3.2 MB: 16 meshes, 53 joints, WebP 1024 px,
  hair/brows/lashes alpha-tested) and `person_skin_light|medium|deep.webp`. Licences and authors: `models/CREDITS.md`.
- `boxer-model.js`: `loadBoxerAssets` tries `person.glb` and falls back to `boxer.glb` (`assets.person` says which).
  `ModelBoxer` with the person: shows only the meshes `personParts(look)` lists, tints garments with `diffuseColor = hex / 0.8`
  (textures are baked grey at mean 0.8), swaps the skin texture by tone, no `paintOutfit`, no procedural trunks/boots (real jeans
  and shoes), keeps the procedural cap, chain, wraps and gloves. `ModelRig.ownBones`: the clips carry a translation for every
  bone, which would stretch another skeleton, so the person keeps its own bone offsets and takes only root/pelvis motion
  (`CLIP_REST`). `standOn()` computes a `lift` so the soles stand on y = 0 (legs are shorter than the clips' character).
- Look mapping (my choices, not asked): `tee` and `tank` are the same T-shirt (tank without sleeves); `varsity` is a casual
  jacket (texture-driven, tintable, `sleeve` colour on its sleeves); `hoodie` is a knit fisherman sweater. Hair is picked by
  skin tone (brown `short02` for light, black `short01` for medium and deep) and hidden under a cap. No new look option.
- Tests (4 new, `npm test` 100 pass): person.glb has every garment a look can show and the clip bones; `personParts` and
  `personTint`; the existing clips pose the person in Babylon's NullEngine (finite bones, soles near 0, fists reach forward on
  every punch, every clip); fallback to `boxer.glb` when `person.glb` fails.
- **Untested in a browser** (Babylon ran headless in Node, numbers only, nothing was rendered): how the person looks (texture
  colours, tint strength, hair, jacket vs sleeves, jeans cut, shoes against the floor), skin tones, poses mid-punch (skinning
  stretch at the shoulders and spine pivots), gloves and wraps against the hands, the cap on the head, the guard and punch
  heights (they were tuned on the Quaternius body; head is 1.49 m in the stance vs 1.46), shadows and alpha-tested hair, the look
  preview at 375px, the fallback in a real 404, load time (3.2 MB).
- Known gaps: the head leans a few cm forward of the Quaternius stance; the T-shirt's tank/tee share one mesh; the primitive
  fallback is unchanged.

## Done (2026-10-04): preview stops rendering off-screen (BOX-7)

`look-preview.js`: an IntersectionObserver on the preview's parent starts its render loop only while the preview is visible (Look panel shown), and stops it when the panel is hidden or scrolled away, so a fight draws with the arena engine alone. The engine and scene stay alive, and `setLook` still rebuilds the boxer while hidden, so the preview matches the saved look when it returns. `npm test` 100 pass; no test covers it (needs a browser).
- **Untested in a browser**: that `BABYLON.EngineStore.Instances[i].activeRenderLoops` is empty for the preview during a fight, that it resumes on return, a look change made while hidden showing up afterwards. The preview's WebGL context is still held during a fight (loop stopped, not disposed).

## Done (2026-10-04): person model smoke render in headless Chromium (BOX-10)

`node scripts/measure-boxing.mjs --cam=hard|ringside` at 400 px (Metal GPU): the person loads and fights, no console errors, 122 meshes, ~100 draw calls, CPU frame 3-4 ms. Screenshots: `public/boxing/qa/box-10-person-hard.png` / `-ringside.png`. At 338x190 the fighters read as people in the right outfits (white tee and red wraps vs navy jacket and blue wraps), standing on the court at the right scale. No code changed.
- **Still untested**: detail the small canvas can't show (tint strength, hair, jeans cut, shoes, mid-punch skinning), the Look panel and its preview at 375px, skin tones, P2P looks, the fallback on a real 404. You check these; balance still needs your numbers.

## Done (2026-10-04): crowd from open-source people (BOX-10)

User: "try using open source free resources instead", and picked **the crowd** when asked what to replace. The crowd atlas was AI-generated cut-outs (ComfyUI); it is now rendered from `person.glb` (the CC0 MPFB person), so every source is open.
- `scripts/build-crowd-person.py` (headless Blender; command in its docstring) poses `person.glb` (arms down, or raised for 4 of 12), shows a garment set, tints it with hex colours, picks the skin tone, adds a primitive cap, and renders 5 views per person with Cycles on a transparent film (orthographic, overcast light, standard view transform). `scripts/build-crowd-atlas.mjs` packs them into `textures/crowd_atlas.webp` (206 KB, was 26 KB) and `.json` (same format; `flip` 1, side views face image-right, `frameHeightM` 1.95). 12 people vary skin, garment, colours, cap or hair, build.
- The old ComfyUI scripts (`gen_crowd_photos.py`, `build-crowd-atlas.py`, `comfy_lib.py`) are removed (still in git history). `arena-babylon.js` only changed in a comment.
- Checked in headless Chromium at 400 px (`measure-boxing.mjs`, hard and ringside): atlas loads, crowd reads as varied people, no console errors, CPU frame 2-5 ms. `npm test` passes.
- Not done: all the crowd is male (MPFB base is male here; the old crowd had women), the T-shirt hem is a little ragged on back views, night crowd not checked, the arms-up pose is a plain V.
- **Untested**: the crowd at night and on a real phone.

## Done (2026-10-04): photo crowd (BOX-5), closed with the open-source atlas

The photo-impostor crowd (camera-facing cards, 5 views per person, picked from the camera angle, shader in `buildPhotoCrowd`) is in; its atlas is the Blender render from BOX-10, not ComfyUI. The ComfyUI retry the user asked for is moot: the user chose open-source sources in BOX-10, the old generation scripts are gone, and I stopped the ComfyUI server (port 8188) that was still running and swapping the machine. `?crowd=3d` or a failed atlas load keeps the procedural 3D crowd.
- Measured with `node scripts/measure-boxing.mjs --crowd=3d|photo --time=day --cam=hard` (headless Chromium, 400x760, Metal): 3D crowd 87 active meshes, 118 draw calls, 4.5 ms CPU/frame; photo crowd 79 meshes, 110 draw calls, 3.1 ms CPU/frame. Wall ms per frame (34 vs 37) is noise from headless vsync, not a regression. Gain is mostly CPU time, not draw calls, since the 3D crowd was already thin-instanced.
- Not done: trees and parked cars stay 3D (little to gain, a few meshes); night not measured.
- **Untested**: the real phone, and the crowd at night.

## Done (2026-10-04): demo end-to-end check (BOX-11)

User directive: finish a working demo first, fixes later. No open issues stood between the code and the demo (BOX-1,2,3,5,6,7,10 are done), so the slice was a check: `node scripts/demo-e2e.mjs` (headless Chromium, 375x760) names a fighter, picks a look, fights 3 rounds to the result in Day, then Night. Both finished ("Demo Kid wins: Decision (30-27)"), no console errors. Screenshots: `public/boxing/qa/demo-*.png`.
- **Run the demo**: `npm run static -- 4792`, open http://localhost:4792/boxing/ on a phone (same network) or a 375 px window. Type a name, pick a look, set Time (Day/Night), Speed, press New fight, then Start round each round; the result shows under Corner.
- **Parked (not started)**: balance (counter-punching dominates), night not measured for crowd or frame time on a real phone, all-male crowd, primitive fallback ignoring looks/outfits, `boxing-manager/` stray folder, WebLLM worker, items under "Untested" above.
- **Still untested**: a real phone's GPU and touch, how the person looks up close, P2P looks.

## Done (2026-10-04): standalone on GitHub Pages (BOX-12)

The game is its own public repo, https://github.com/thenewurbankid-web/bring-the-ruckus, live at https://thenewurbankid-web.github.io/bring-the-ruckus/. Done in claude-quest's `public/boxing` first so both stay one codebase (commit "Standalone Boxing (BOX-12)"): Babylon 7.54.3, its glTF loader, Phaser 3.90.0 and Dexie 4.4.6 load from pinned jsDelivr URLs (the versions in `package.json`); `linkcrypto.js` is copied into `public/boxing/`; models, textures and the crowd atlas load through `new URL(..., import.meta.url)`, so no absolute `/boxing/` or `/vendor/` paths remain. `scripts/demo-e2e.mjs` takes `DEMO_URL`.
- **Syncing the repo**: clone it, `rsync -a --exclude .git public/boxing/ <clone>/`, commit, push main (done once, as 4c4a687; the repo also has a `.nojekyll`). The user asked for this push in BOX-12; it is not a standing permission.
- Checked: `npm test` 101 pass; `demo-e2e.mjs` at 375 px finished day and night fights with no console errors both locally and against the live Pages URL.
- **Untested**: a real phone on Pages, P2P between two devices over Pages (HTTPS, WebRTC), jsDelivr being down (no fallback).

## Done (2026-10-04): it feels like a game (BOX-13)

The user said "the boxing game needs to feel like a game". `index.html` is now a phone-first screen game; the dashboard is gone. Commit bad4de0.
- **Flow** (`flow.js`, pure logic, tested): Title (Play / Continue / Settings) → Fighter (name, look, stats, big controls) → Training (upgrade screen, + / − with confirm) → Opponent (4 archetype cards + Mirror, 3 or 6 rounds) → Fight → Result → Rematch / New opponent / Train / Title. Settings: sound, music (off by default), day/night, fight speed (default 4× so a fight takes about 2 minutes).
- **Fight screen**: the 3D court fills the phone; HUD is two health bars, two stamina bars, round and clock; a bottom corner sheet between rounds with the coach's one-liner (from `cornerTip`, uses the RAG precedent when there is one) and five tactic buttons; speed and leave buttons (leave asks in-page). The broadcast bug, cam label and lower thirds from the arena are hidden by CSS here.
- **Juice**: hit flash (red vignette when you are hit), camera shake and crowd swell on big punches, KO slow-mo + white flash, bells at round start and end. All sounds are synthesized in `sfx.js` (WebAudio, no files, no licences). Arena gained render-only `shake()` and `slowmo()` and a portrait camera (horizontal-fixed fov 0.92, dist x0.9, lower height).
- **Result**: scorecard rows reveal one by one, then VICTORY / DEFEAT / DRAW stamps in (KO stamps at once), fight stats, XP (= training points, win 6, draw 4, loss 3), record, new unlocks.
- **Progression**: record W-L-D, points spent on the Training screen (cost 1/2/3 by stat band), outfit unlocks by wins (1 varsity, 2 black jeans, 3 knit sweater, 4 gold top, 5 gold wraps); locked choices show LOCKED and a toast, and `lockedLook` resets a saved look that wears something not yet won.
- **Debug drawer**: telemetry, exchange feed, RAG intel, LLM context, export/import, view and speed override. Open with `?debug` (DBG button) or a long-press (0.7 s) on the title logo. P2P moved to a bottom sheet on the Opponent screen ("Fight a friend instead"); rematch is hidden for P2P.
- **Tests**: 108 pass (7 new for flow, progression, unlocks, scorecard, tips, settings). `node scripts/demo-e2e.mjs` rewritten for the new flow: Title, Settings, Fighter, Training, Opponent, corner, fight and result at 375 px, day then night, no console errors. Screenshots `public/boxing/qa/game-*.png`.
- **Not built (needs art or a decision)**: night-court title background and opponent portraits (CSS gradients and initials stand in; drop `title-bg.webp` / `portraits/<key>.webp` and wire them in), a real home for crowd music.
- **Untested**: a real phone (touch, long-press on the logo, safe-area insets, audio autoplay rules, sound levels), P2P through the new sheet, sound by ear, KO slow-mo and shake by eye, portrait camera framing at other aspect ratios, Settings → Music playback.

## Done (2026-10-04): career mode, first slice (BOX-13)

User added a career mode as the main mode (Quick fight stays as the exhibition). This slice is the loop: Title → Career hub → gym drill or rest or fight card → fight → result → hub. Pure rules in `career.js` (no DOM, tested); screens `career`, `card`, `gym` in `index.html`; `flow.js` has the new edges.
- **Hub**: tier (Block parties, Local circuit, City title, Underground championship; rep 0/30/90/200), rank on the tier's ladder, rep, money, record, energy bar and condition. This week's two offers (opponent portrait initial, style, record, rounds, venue, purse; "Rival" and "Title" tags), the next two weeks peeked, rankings table, rivals who remember you, last weeks log. Footer: Gym, Rest.
- **Offers** are deterministic from the career seed and week (reload can't reroll). A rival who beat you (or a first-meeting KO win) comes back two weeks later, a little stronger, with a bigger purse; beating him clears it.
- **Fight card**: VS poster, purse, both stat sets ("You tonight" shows tiredness or injury penalty), Accept / Decline. Accept starts the normal fight with `effectiveStats` (energy under 60 and injuries lower stats up to about 30%). Leaving a career fight counts as a loss.
- **After a fight**: purse (loss 1/4, draw 1/2), rep, rank change, tier promotion, energy -25, injury (loss 1 week, KO loss 3), a week passes. Result shows a "What changed" card. Quick-fight XP and record still apply too.
- **Gym**: heavy bag (power). Timing drill, 8 taps on a sweeping marker (`markerAt`, deterministic), gain 0-3 (less at higher stats), costs 20 energy and a week, trainer one-liner. `DRILLS` is config, so the other three drills are table entries plus a new `stat`.
- Career is saved inside the `fighters` row (`fighter.career`, `normalizeCareer` on load). Title: Career (primary), Quick fight, Settings.
- Tests: 117 pass (9 new: flow, offers, win/loss, rivals, tiers/ladder, condition and rest, drill, normalize, trainer tip). `node scripts/career-e2e.mjs` plays hub → drill → card → fight → result → hub at 375 px with no console errors; screenshots `public/boxing/qa/career-*.png`. `scripts/demo-e2e.mjs` updated for the new title.
- **Not built yet** (remaining BOX-13 asks): speed bag, roadwork, sparring drills; rounds of 30-40 s (default 35) with a 10 s corner break, fast-forward and "sim to result" (needs a rebalance of the damage and KO rate with Boxing Sim Dev, I did not guess numbers); Fight IQ / tendencies / "learned from past fights" panels and the in-fight plan tag; the fight view is still 3D (screens are independent of it, so the 2D swap needs no change here); night-court title art and real portraits.
- **Untested**: a real phone (tap timing on the HIT button, safe-area insets), the career at other widths, a long career (tiers 3-4 balance: purse, rep thresholds and opponent stats are my first guesses, tune them), P2P untouched.

## Done (2026-10-04): BOX-18 slice 1, foot planting (shipped live)

User standing rule (2026-10-04): ship each slice as soon as it is built and tested (merge, sync `public/boxing` into bring-the-ruckus and push, push claude-quest main; never push a broken build). Shipped: claude-quest main d33b533, bring-the-ruckus 60b8f1a.
- `footwork.js` (pure, render-only): each foot is planted at a world point or on a short low step. A foot steps when it lags its stance spot (lead foot 7 cm, back foot 8.5 cm, plus a turn term), lands ahead of the body's travel, and the other foot stays down. Standing still re-sets a foot only if it is 5 cm off.
- `boxer-model.js`: `ModelRig.plant()` is two-bone leg IK (thigh/calf/foot, then toes aimed) holding the ankle on the planted point; the Walk_Loop layer is gone. Hips sit 5 cm lower (`KNEE_BEND`) so legs have slack; idle bounce on the balls of the feet and a dip on each step. `boxer.footSlip` reports per-frame ankle movement while planted.
- Test: poses the person at walk, shuffle, side step, pivot and standing: planted ankle moves < 0.5 mm per frame, and feet do step. `npm test` 269 pass; `demo-e2e.mjs` clean locally and against the live URL.
- **Not done in BOX-18**: start/stop/turn clips, mocap footwork (CMU / Quaternius), punch weight transfer and rear-foot pivot (planted feet currently stay put through punches), head movement, blocks/hit reactions, before/after clip on the live site, phone frame-time measure.
- **Untested by eye** (no browser here): that the steps look like a shuffle rather than a hop, knee direction and foot orientation on the person, leg stretch when lunging, KO fall.

## Done (2026-10-04): BOX-18 slice 2, punch pivot and street sway (shipped live)

User (2026-10-04) asked for more natural street-style fighting and more moves (haymakers, clinches, shoves, feints, rolls, shelling up, taunts...). Those moves need new sim punch/action types from the Sim Dev's new issue, which isn't in the sim yet, so this slice is what the current moveset allows. Shipped: claude-quest main c465f26, bring-the-ruckus 63eb097.
- `boxer-model.js` `pose()`: cross/hook/uppercut/body pivot the punching-side foot toes toward the target (0.7 rad, jab doesn't); weight rocks 1.2 cm onto the lead leg; body shots drop the hips 5 cm; the upper body sways (16 mm side, 10 mm fore-aft, only while still) and widens up to 2.5x as stamina drops; hooks swing 50% wider when tired. Sway/rock go on the rig only, the footwork gets the clean body point, so planted feet don't re-step.
- Test: punches (cross, hook, body, uppercut, jab, tired and fresh) leave planted ankles under 0.5 mm per frame; body shots drop the hips. `npm test` 270 pass; `demo-e2e.mjs` clean locally and on the live URL.
- **Untested by eye**: that the pivot, rock and sway read as natural and not as a wobble; sway amounts are my guesses.
- **Next for BOX-18**: animate the street moves once the Sim Dev's issue lands (needs the new action types in `snapshot()`); start/stop/turn transitions; CMU/Quaternius mocap (the CMU files need a download and retarget onto the straightened rig: not done); before/after clip; phone frame time.

## Done (2026-10-04): BOX-13 landing screen (Boxing UI Dev)

`public/boxing/index.html` only (title section, CSS, `restartTitleIntro`, `startTitleFx`, leave transition in the `[data-go]` click handler). Night-court SVG scene (tenements, fence, hoop, lamp glow, two fighter silhouettes) on a slow camera drift, light rays, drifting haze, film grain, vignette, a canvas of embers and dust. Logo lines slam in with a screen shake, then a glint sweeps "RUCKUS" every few seconds. Menu slides in staggered; hover/press micro-animations; the main button reads Play, or Continue once a career exists. Leaving the title zooms the camera, fades the stage and flashes white (380 ms) into the next screen. `prefers-reduced-motion` turns all of it off. Screenshots `qa/title-*.png` (Chromium at 375 px). `npm test` 269 pass, career-e2e passes, no console errors.
Untested: real phones (grain/blur cost on low-end GPUs), Safari, the music toggle. Fighter silhouettes are static shapes, not a looping fight teaser yet.

## Next jobs

0. **Play BOX-13 and the career on a phone** and tell me what feels off (see its untested list).

1. **Check the person in a browser** (`npm run static -- 4792`, http://localhost:4792/boxing/): the fight view and the Look panel, using the untested list under BOX-3 above, and tell me what to fix (tint, hair, proportions, shoe heights).

2. Balance (see Open issues).

The user's decisions (2026-10-03):
- **Renderer: Babylon.js**, not three.js and not Phaser. It should look like a real televised boxing match.
- **Physics stays as it is.** `CombatSimulation` is the single source of truth. The 3D layer only reads `sim.snapshot()`
  and listens to `impact` / `exchange` / `round_end` events. It must never write to the simulation, or P2P lockstep breaks.
- **Boxer models:** find the best free resources available. Check the licence of every asset and record it in
  `public/boxing/models/CREDITS.md`.
- **Target is phones (2026-10-04):** "close to photo realistic, we target phones so small resolution is ok". Aim close to
  photorealistic, but small textures and atlases are fine (size for a ~400 px wide view). Measure frame time with a
  phone-sized canvas. The Blender people (`person.glb`) stay phone-friendly in poly count and texture size.

Leads to verify (I haven't checked them; confirm licences and availability first):
- Mixamo: free rigged humans plus boxing animations (jab, cross, hook, block, idle stance, hit reaction, knockdown).
  Needs an Adobe login, so the user downloads the FBX files, which you then convert to GLB.
- Quaternius: CC0 humanoid rigs and an animation library.
- Poly Haven: CC0 HDRIs (an indoor arena) and PBR textures for the canvas, ropes and turnbuckles.
- Sketchfab: some CC-BY boxing rings and gloves. Attribution is required.
- Babylon.js's own asset library and playground examples for retargeting animations.

Suggested shape:
- `public/boxing/arena-babylon.js`, the counterpart of the Phaser layer. Map the sim's 2D ring (metres, origin at the
  centre, x/y) onto the Babylon ground plane (x/z). Pick each animation from `activePunch.type` and blend it by
  `(tick − launchTick) / (arriveTick − launchTick)`. Play a hit reaction on landed impacts, scaled by joules. Add
  ropes, corner posts, lit canvas, crowd, and a broadcast camera.
- Serve Babylon from npm the way Phaser and Dexie are served: add `'@babylonjs/core'` and `'@babylonjs/loaders'` to
  `VENDOR` in `dev/static.js`, or use the UMD `babylon.js` from `node_modules/babylonjs`.
- Keep `createPhysicsGame` (Phaser) as the headless/2D fallback toggle, or drop it if the user agrees.

## Current state (all verified)

- `public/boxing/physics-engine.js`: 240 Hz deterministic core (`FighterModel`, `CombatSimulation`, `computePunch`,
  serializers `bm.exchange.v1` / `bm.round.v1`), plus a lazy Phaser layer (`getPhaserClasses`, `createPhysicsGame`).
- `public/boxing/game-db.js`: Dexie `fight_logs` / `matches` / `fighters`, `retrieveTacticalPrecedents()` (top 3,
  Gaussian similarity × success score), and `toLLMContext()`.
- `public/boxing/index.html`: stats, training camp, single-player (AI corner), and P2P (WebRTC, manual offer/answer
  strings using `LinkCrypto.pack`/`unpack`, plus `#offer=` links for QR codes).
- Shared changes: `dev/static.js` (generic `/vendor/<name>/` routes), `public/linkcrypto.js` (`pack`/`unpack`),
  `package.json` (adds `dexie`), `.claude/launch.json` (`boxing-static` on port 4792).
- `test/boxing.test.js`: 8 tests. `npm test` passes 92 of 92.
- Browser check: a single-player fight ran to the end, IndexedDB logging and RAG intel worked, and the P2P loopback in
  two tabs gave identical results on both peers.

Run it with `npm run static -- 4792` (or `preview_start boxing-static`), then open http://localhost:4792/boxing/.

## Open issues

- Balance: counter-punching beats pressure heavily (by round 4, 88 landed vs 25), and fights often end by KO around
  round 5. The tuning constants are at the top of `physics-engine.js` (`PUNCHES`, `TACTICS`, the `deriveAttributes`
  maps, and the damage divisor `/ 400` in `_resolveArrivals`).
- `boxing-manager/` is a leftover empty folder at the worktree root. Delete it by hand.
- WebLLM worker is not started yet. `toLLMContext()` already produces the prompt block.
