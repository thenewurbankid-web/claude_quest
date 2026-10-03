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

## Next jobs

1. **Rebuild the location from the user's photo** (sent 2026-10-03; a frame from a YouTube short, "NY Cypher",
   tagged New York, not saved in the repo). This replaces item 2. What it shows:
   - **Location:** a neighbourhood basketball court, not an alley. Grey asphalt court with faded white lines; the
     fight spot is on the court. A tall black chain-link fence (about 4 m) runs around it on posts.
   - **Hoop:** a steel gooseneck pole, a rectangular white/grey steel backboard with a red-orange square, an orange rim
     with a chain net. It stands behind the crowd, centred in the camera's view.
   - **Buildings behind:** 5–6 storey red-brown brick tenements, in a continuous row. Black iron fire escapes zig-zag
     up the fronts. Window AC units stick out, some lower windows have bars, and there are decorative stone lintels.
     A ground-floor shop at the back right has a dark green awning with white lettering, partly hidden.
   - **Trees:** bare or sparse autumn street trees (thin trunks, a few yellow-green leaves) between the fence and the
     buildings.
   - **Light:** **daytime, overcast**. Soft, even, slightly cool light, no hard shadows, muted colours. That is matte
     and fits "no shiny graphics", but it replaces the night look (neon, fire barrels, headlights, rain): ask the user
     whether night stays as an option.
   - **Crowd (the cypher):** packed shoulder to shoulder in a tight circle, several rows deep, leaning in, arms up,
     shouting. Clothes: New York Yankees fitted caps (navy, some backwards), navy and grey varsity jackets with leather
     sleeves, light and dark denim jackets, white tees and tank tops, black hoodies, gold chains, light-wash and ripped
     jeans, wheat Timberland boots and white sneakers. This is also the reference for the hip hop outfits in the
     creator (item 3) and for dressing the onlookers.
   - Textures already in `public/boxing/textures/` fit: asphalt (court), brick_red or brick_dirty (tenements; compare
     against the photo's red-brown), sidewalk concrete. A chain-link alpha texture exists in code (`chainLinkTexture`).
2. **Outdoor street** (user: "and outdoor steet fight"). Open the yard into a street: buildings on ±z only, with
   sidewalks and curbs, the road running away along x into the fog, more lamps and parked cars, sky. Wire in the
   textures: asphalt on the road, brick on the walls, the worn concrete on the sidewalks, rust on the barrels.
3. **Character creation, looks + name only** (picked by the user). The sim is untouched. Hip hop outfits are the
   options: hoodie or tank, baggy jeans or sweats, sneakers, chain, cap. Store a `look` with the fighter in Dexie and
   add it to `profileOf()` so it rides along in P2P `start` messages (`FighterModel` ignores unknown fields). Dress the
   onlookers to match.
4. Balance (see Open issues).

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
