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
- Lighting: moonlight hemi, a work lamp over the fight (the key and the shadow caster) and a wide flood. 13 lights in
  all, so every material gets `maxSimultaneousLights = 14`. A `ReflectionProbe` (refreshed every 30 frames) stands in
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

## Done (2026-10-04): night load card (BOX-2)

`arena-babylon.js`: the overlay now has a loading card ("Setting up the fight", plus "Night takes a little longer the first time" at night). `createArena3D` awaits `scene.whenReadyAsync()` (capped at 60 s) before starting the render loop, so the shaders compile behind the card instead of a frozen page; the card fades out and removes itself. All views and both times of day get it. No lights removed, look unchanged. `npm test` passes (96); no test covers it (needs WebGL).
- **Untested in a browser**: that the card shows during night's compile, that the page stays responsive, how long night actually takes now, the card at 375px, and that day still starts without a visible flash.

## Next jobs

1. **Realistic people from Blender** (not picked yet; step 2 after the bake): Blender's MPFB (MakeHuman) add-on has CC0
   output and clothing assets, and its game rig uses UE-style bone names like the Quaternius clips. Character creation
   would then be built on those models.

2. Balance (see Open issues).

The user's decisions (2026-10-03):
- **Renderer: Babylon.js**, not three.js and not Phaser. It should look like a real televised boxing match.
- **Physics stays as it is.** `CombatSimulation` is the single source of truth. The 3D layer only reads `sim.snapshot()`
  and listens to `impact` / `exchange` / `round_end` events. It must never write to the simulation, or P2P lockstep breaks.
- **Boxer models:** find the best free resources available. Check the licence of every asset and record it in
  `public/boxing/models/CREDITS.md`.

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
