# Boxing Manager AI: handoff

Worktree `.claude/worktrees/boxing-manager-ai`, branch `worktree-boxing-manager-ai`, based on `3d-world`.
Live tracker: https://claude.ai/artifact/PRsPyaXBu4g9UpCFbPwP3K (its `db` holds `tasks/t01..t12`,
`log/l01..l12`, `meta/status` and `meta/balance`; update them with ArtifactData and pin each write with `if_version`).

## Done (2026-10-04): swag for the 3D fighters (BOX-28 follow-up)

- **`swag.js`** (new, pure maths, render-only): `STYLES` per sim tactic (pressure and body attack crouch low and lean in; outbox rises on its toes with a looser, lower, wider lead hand; counter gets a Philly-shell lean back; brawl is square with rolling shoulders and chin up; dirty boxing leans close), blended slowly when the corner changes tactic. `Swag` (seeded per fighter) holds the beats and a lopsided guard (one hand a bit lower and wider, constant per fighter).
- **Beats**, all cosmetic and slow, only start when nothing is happening (not punching, no punch incoming, no shell/clinch/taunt/hit), with a 3.5 s quiet gap, 9 s before a repeat, and cues made mid-exchange are dropped after 1.4 s: nod / head tilt / hand dropped low after a clean landing (`impact` event, about 55% of landings), shoulder shrug after slipping a punch (from the opponent's `slipped` punch), glove offered at the bell from round 2 and a shimmy before round 1 (`awaiting_corner` phase), slow neck roll or glove-adjust every 8-15 s while idle, backing slowly to the corner after the bell (`round_over`/`fight_over`), and the KO winner backing away with a fist up and chin raised. Taunt now also tilts the head. Idle bounce is 1.5 Hz (90 BPM), weight shifts foot to foot at 0.75 Hz.
- **Files**: `swag.js`, `boxer-model.js` (`ModelBoxer.cue`, style and beats in `pose`; no read of looks, no write to the sim), `arena-babylon.js` (cues from `impact`, phase changes, `fight_end`).
- **Checks**: 334 tests pass (2 new: styles/beats/never mid-exchange/deterministic/smooth envelopes; boxer smoke for style height and shimmy swing and unchanged snapshot). Idle hip/head reversals still 1.45/s with or without injected sim noise, feet 0. `measure-boxing.mjs`: 5.2 ms CPU/frame, no errors.
- **Untested**: how any of it looks in a browser (head and shoulder angles, glove offer, backing to the corner, KO walk-off, the 2D photoreal arena has no swag). Tell me which beats read badly or too often. Not pushed or synced (waiting on permission).

## Done (2026-10-04): calm, loose fighters: less stepping, no shiver (BOX-28)

- **Footwork** (`footwork.js`): the sim position is low-passed (`Smoother`, 12 rad/s, lag taken back out) before it drives feet, root and hips. A foot lifts only at ~75% (lead) / 85% (trail) of stance width of lag (hysteresis via a 0.3 s per-foot cooldown), steps are cadence-capped (0.42 s between step groups), land past their spot (one step = a long hold), and the back foot follows (step-drag). A `still` hold (punching, clinch, shell, taunt) raises the threshold; only an emergency lag (1.1x stance) steps through it. Hips drop so both legs always reach (planted feet still do not slip).
- **Shiver**: the cause was per-tick sim noise (position and velocity) reaching hips/feet, plus a fast bounce. Now filtered at the source, bounce slowed to ~1.7 Hz and small. Idle with 0.5x injected noise: hip/head reversals 27/s -> ~1/s, foot reversals 0, steps 0.
- **Looseness** (`boxer-model.js`): seeded per-fighter `Drift` sway, head bob and weave, shoulder roll, chin tuck, hands drifting in the guard (springs), soft knees on the bounce, hips-lead/shoulders-follow twist on punches with lagged torso, weight shift (front foot on punches, back on defence). `Spring` gives overshoot and settle. `arena-2d.js`: 110 ms clip crossfade, smoothed gap shift, procedural sway and lean on top of the clips.
- **Numbers** (`node scripts/motion-metrics.mjs [seed]`, seed 11, 35 s round, pressure vs outbox): foot steps/s red 7.1 -> 3.65, blue 9.84 -> 4.04. Not the 1.5-2/s asked for: **the sim itself keeps both fighters moving (avg 0.7 m/s, mostly radial in/out, not oscillation); smoothing harder did not shorten the path.** Getting to <=2/s needs the sim's constant locomotion reduced, which is a sim change (pinned hash), not mine. Decision for you.
- **Tests**: 332 pass (new: idle-noise and real-round cadence test using `scripts/motion-metrics.mjs`; standing-still step test now asserts no steps in the last 1.5 s). `measure-boxing.mjs`: 5.7 ms CPU/frame at 400x760 headless, no errors; `shot-arena2d.mjs` no console errors.
- **Untested**: how it looks (sway, twist, hands, hip drop, 2D crossfade and sway) in a real browser, a real phone's frame time, and no before/after clip or frame strip (I can't open a browser; check at http://localhost:4792/boxing/ via `npm run static -- 4792`). Not pushed or synced: AGENTS.md says never push, the issue says push main and sync bring-the-ruckus; waiting on you.
## Done (2026-10-04): BOX-30 title follow-up (logo word gap, photoreal fighters)

- **Logo**: `scripts/build-logo.mjs` now has a clear word gap (BRING / THE), a stronger slant (0.30), and more joined strokes (B-R-I-N-G run on, R-U in RUCKUS). First-row scale 2.3 so both rows fit. Rebuilt `img/logo-ruckus-{640,1100}.webp` (105 KB / 231 KB).
- **Title background**: the two flat SVG silhouette fighters are gone. The BOX-17 photoreal `sprites2d/{red,blue}_idle_guard.webp` sheets now idle there (`.duel .fgt` in `index.html`, frame stepped from the title fx loop at about 9 fps; blue is mirrored; dimmed, fading into the fog at the feet; the `.cam` drift gives the slow camera move; static first frame under reduced motion). Fence, lamps and light shafts kept. No new assets, so no new credits (sprites are the BOX-17 renders).
- Shipped: claude-quest main 1b8b304, bring-the-ruckus defedbc. Shots: `scripts/title-shots.mjs <tag>` writes `qa/box-30-{before,after}-{375,1440}.png`. `npm test` 331 pass, no console errors.
- **Untested**: real phones, Safari/Firefox, whether the fighters look right next to a long player name line, the idle loop seam (16-frame sheet, looped as is).


## Done (2026-10-04): BOX-29 logo with flow, then the UI system pass

- **Logo redone with flow** (commit 725997e): `scripts/build-logo.mjs` no longer uses a font. Every letter is a pen path (marker handstyle: one slant, a rising baseline, N-G and similar letters joined in one stroke, chisel-nib width with thicker downstrokes and tapered entries and exits, translucent ink that builds where strokes cross, bleed into the CC0 brick photo, an underline swash out of the final S, drips). Two lines: BRING THE / RUCKUS. 107 KB (640 px), 237 KB (1100 px). Sedgwick TTF removed from the repo; `fonts/CREDITS.md` updated.
- **UI system** (`index.html` CSS plus small JS): black, white and concrete grey only; the old ember accent is gone from selected states, bars, numbers and tips, and a dull red (`--danger`) is kept only for low health, the late clock, errors and DEFEAT. Buttons: primary = white plate (`.primary`), secondary = thin outline (default `button`), tertiary = text only (`.link`); 48 px minimum, `.big` 52 px, radius 6 px everywhere, press = scale .98 plus darken, no glows or gradients. Tokens in `:root`: `--r`, `--h`, type scale `--t-xs/sm/md/lg/xl/hero` (12/14/17/22/32/64), 4/8 px spacing (headers, cards, bottom bar), tabular figures on. Headers have a divider and one back chevron (48 px). Selected options (seg buttons, outfit swatches, opponent cards) are white, not coloured. Title menu is CAREER (primary), QUICK FIGHT, GYM, SETTINGS (GYM says "Start a career" in a toast if none exists); shake, skewed slide-in and glow sweep removed, grain quieter. Screens slide/fade in over 240 ms (direction follows depth); reduced motion is covered by the global rule.
- Shots: `scripts/ui-shots.mjs <tag> [dir]` walks every screen at 375x812 and runs a button audit (every settings option, title Gym, back chain); `qa/box-29-before.png` and `qa/box-29-after.png` (13 screens each; "before" already has the new logo), `qa/box-29-title-375.png`. `npm test` 331 pass, no console errors.
- **Untested**: real phones, Safari, the 1440x900 layout of the new title menu, the P2P sheet and stats overlay styling by eye, the Look panel's lower rows, night HUD. The drill glove and a few damage-figure heat colours still use small gradients/colours on purpose (game elements, not controls).

## Done (2026-10-04): crafted spray-paint logo, no more graffiti webfont (BOX-29)

- The landing logo is now a pre-rendered image, `public/boxing/img/logo-ruckus-640.webp` (128 KB, phones) and `-1100.webp` (333 KB), served with `srcset`. `scripts/build-logo.mjs` builds it (dev only; needs playwright-core and Chromium): Sedgwick Ave Display as the letter base, every glyph placed, tilted and scaled individually, thin grey outline, soft dark offset shadow, overspray speckle halo, uneven coverage showing the CC0 brick photo, five drips. White on transparent. The TTF now lives in `scripts/fonts/`; the game no longer loads it.
- All other titles, buttons and banners (`--display`) use Barlow Condensed 700 (`Barlow Display` face alias in `index.html`), including the round and K.O. banners and the verdict text. No raw Sedgwick anywhere.
- Landing animation: a spray wipe plus blur-to-sharp fade (CSS mask), removed under `prefers-reduced-motion`. The long-press-to-open-debug handler still sits on `#logo`.
- Checked with headless Chromium (375x812 and 1440x900 screenshots, landing and K.O. banner). `npm test` 331 pass. Untested: real phones, Safari mask support (`-webkit-mask` is set), Firefox.
- Not done: FIGHT NIGHT-style one-off posters do not exist as static titles in the UI, so none were pre-rendered.

## Done (2026-10-04): BOX-14 follow-up, stat-driven physique and boxing gear (BOX-25)

- **Physique**: `build-mpfb-boxer.py --variant lean|heavy|balanced` now builds all three (same vertices), and `build-mpfb-models.mjs` merges lean and heavy into `person.glb` as glTF morph targets (`lean`, `heavy`) on every mesh (skin, garments, hair, eyes), 3.2 -> 4.0 MB. `boxer-model.js` `physiqueOf(stats)` (power vs mean of speed and stamina; a 30-point gap is the full shift; even stats = balanced) and `ModelBoxer.setPhysique`. The arena gets `physiques: {red, blue}` from each side's stats (so P2P needs nothing new), the Look preview follows the fighter's stats and updates when training changes them. Render-only, `FighterModel` never reads it. The skeleton stays the balanced one, so animations are unchanged.
- **Gear**: Look has Bottoms (Jeans / Boxing trunks, `pants_trunks` from CC0 `cortu_jeans_shorts`, tinted by `look.trunks`), Mouthguard (small white insert on the face, drawn in code) and the Wraps colour now also colours gloves. All three go through `normalizeLook` (`bottoms`, `trunks`, `mouthguard`). Sanctioned fights wear padded gloves with white cuffs instead of wraps: `career.js` `isSanctioned(offer)` is true for career fights above tier 0 (block parties stay street); quick fights and P2P use wraps. **That tier rule is my choice**, change it in `isSanctioned` if you want otherwise.
- **Re-check**: variants differ from balanced by at most 2.1 cm per vertex (lean) and 1.5 cm (heavy); arm and leg bones are unchanged, so clips can only move a limb that far into the garments. Screenshots of the stance, gloves, and hook/body shots at full heavy (`qa/box-25-physiques.png`; use `scripts/shot-stance.mjs --phys=heavy --gloves=1 --punch=hook`) show no visible clipping. Frame time: `measure-boxing.mjs` (rewritten for the new flow, has `--nomorph`) gives 3.8-7 ms CPU/frame at 400 px with or without morphs, i.e. noise, no measurable cost. 285 tests pass, `demo-e2e.mjs` clean.
- **Untested**: a real phone's frame time, the morphs through P2P between two devices, Look panel at 375 px with the new rows (code only, not screenshotted), night.
- **Not great yet**: the differences between lean, balanced and heavy are subtle (more in arms and legs than the torso); to exaggerate, rebuild with stronger values in `VARIANTS`. The trunks are short (jean-shorts length) with no waistband stripe; gloves don't wear in the primitive fallback.

## Done (2026-10-04): more gym drills (BOX-19)

Three new `DRILLS` in `career.js`, each a phone mini-game scored through the same `hitScore`/`drillResult`/`applyDrill` path as the heavy bag: **Speed bag** (speed; fast marker, 14 taps), **Roadwork** (stamina; tap as a closing ring meets its core on a fixed beat, `beatAt`), **Sparring** (ring IQ; a glove loads, slip the other way fast, fixed `SPAR_CUES`, scored by `sparPos`). All deterministic, no randomness. The gym screen now lists every drill as a card with its own Start button; the trainer tip points at the weakest trainable stat, so it now names all four. Files: `career.js`, `index.html` (gym section and CSS), `test/boxing.test.js` (277 tests pass).
- **Untested in a browser**: drill feel and timing windows (sweep speed 4.6, beat period 0.62 s, 1.1 s sparring window, 300 ms reaction baseline), ring animation, glove layout at 375 px, reduced-motion (ring stops pulsing in scale but still fades).

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

## Done (2026-10-04): BOX-14 slice 1, straightened rig and boxing stance (shipped live)

User: the fighters "look weak and crooked" (BOX-14). Before shots showed the Quaternius jab frame we use as the stance on the MPFB person: lower spine leaning back 14 deg under an upper spine bent 31 deg forward (S-bend, head thrown ahead), a wide deep squat, and open hands over the forehead. Not a bone-roll bug: the rest-pose retarget is fine, the clip pose itself is hunched.
- `boxer-model.js`: `ModelRig.straighten(f, w)` turns pelvis, spine_01-03, neck and head segments toward a small forward lean (`SPINE_LEAN`, 3.5-7 deg) each frame after the clips (each segment keeps its twist; weight eases off during the KO). Stance feet scaled in (`STANCE_NARROW` x 0.78, z 0.82) and hips 3 cm higher (`KNEE_BEND` 0.02) so the knees are slightly bent, not squatting. Guard hands moved down to the cheekbones, elbows in (`GUARD`). `initFists()` finds each finger's curl axis and curls both hands into fists (applied in `applyLayers`). Cap sits 2.5 cm lower.
- Test: "idle guard stands straight" checks every spine/neck segment is within 10 deg sideways and 25 deg fore/aft, hips and shoulders level, head over the feet, hands at the face, and a cross doesn't fold the torso. `npm test` 271 pass.
- Tools: `public/boxing/dev-stance.html` + `node scripts/shot-stance.mjs <prefix> --cams=front,side,back,three [--punch=cross --k=0.9]` screenshots one boxer in headless Chromium; `node scripts/stance-check.mjs` prints the angles with no browser. Screenshots `qa/box-14-before-*.png`, `qa/box-14-after-*.png`, `qa/box-14-cross-three.png`.
- **Untested in a browser by eye**: other punches (hook, uppercut, body) and the hit and KO animations with the new torso, the tired sag, the Look preview framing. Hands are fists with the wraps over them, the thumb still pokes out a little.
- **Next for BOX-14**: the athletic body (MPFB targets, 3 variants by stats), boxing gear (trunks, gloves, mouthguard). The crowd now comes from the 2D render pipeline (user direction change), so no realtime crowd work here.

## Done (2026-10-04): BOX-14 slice 2, athletic boxer body (shipped live)

`scripts/build-mpfb-boxer.py` now builds an athletic body: `ATHLETE` detail targets (V-shape torso, lats, pecs, thick neck, strong jaw, shoulder/arm/leg muscle), `proportions=0.6`, and a `--variant balanced|lean|heavy` switch (only balanced is shipped; lean/heavy write `person_raw_<variant>.glb`, for slice 3). Garments are inflated 4-6 mm along their normals so the muscle doesn't poke through clothes. `person.glb` rebuilt (`node scripts/build-mpfb-models.mjs`). Before/after: `qa/box-14-before-front.png` vs `qa/box-14-athletic-front.png`/`-side.png`. 272 tests pass. Untested in a real game/phone: frame time with the new mesh, clipping of every punch against the wider shoulders.
- Slice 3, slice 4 and the clip re-check were done in BOX-25 (above).

## Done (2026-10-04): BOX-18 slice 3, lean into starts, stops and turns (shipped live)

`boxer-model.js` `pose()`: smoothed acceleration of the sim velocity shifts the body up to 3 cm along it (a start drives forward, a stop rocks back, a turn leans into the curve); render-only, feet stay planted. `npm test` 274 pass; `demo-e2e.mjs` clean locally and live. Shipped: claude-quest main 9908bb7, bring-the-ruckus 39c7d47. **Untested by eye**; the 3 cm cap and 8 Hz smoothing are guesses.
- Still open in BOX-18: CMU mocap footwork, before/after clip, phone frame time.

## Done (2026-10-04): BOX-17 slice 2, medium-angle fighters and the 2D arena (beta)

- Rendered 8 clips per corner in Blender/Cycles (`scripts/render-fighters.py`, `render-all-fighters.sh`): idle_guard, atk_jab/cross/hook, block, hit_head, stagger, ko. Packed by `scripts/pack-sprites.mjs` into `public/boxing/sprites2d/` (16 WebP atlases plus `manifest.json`, 2.99 MB total, 0.75 scale). Day plate: `plates/medium_day.webp` (`scripts/render-plate.mjs`). Shared camera: `camera2d.js`.
- `arena-2d.js`: canvas compositor driven by `sim.snapshot()` and `impact` events only (render-only). Clip choice and timing from `clips2d.js`; unrendered clips fall back via `resolveClip` (uppercut to hook, body to jab, knockdown to ko). Blue is the mirrored red render.
- Options, Fight options, View: "2D photoreal (beta)". 3D stays the default. 287 tests pass (2 new: `resolveClip`, `clipFrame`).
- Smoke: `node scripts/shot-arena2d.mjs` (dev page `dev-arena2d.html`) ran a round in headless Chromium at 375x667 with no console errors; shots in `qa/box-17-arena2d-*.png`.
- Not done / untested: night plate (falls back to day), ground contact shadow barely visible, no post-pass or looks recolour, no close angles, no crowd animation (crowd is baked into the plate), no real-phone frame time, game flow (not just the dev page) in a browser, P2P with this view.
- Next: slice 3 (post-pass and looks).
- **Shipped (live, 2026-10-04)**: claude-quest main 7703d78, bring-the-ruckus 1016762 (merged origin/main incl. BOX-22 and BOX-26 first; 308 tests pass; `demo-e2e.mjs` clean locally and live; live manifest, atlases and plate return 200). Dev pages are not synced to the public repo. Blue's outfit is a second Cycles render (`--outfit blue`), not the mask recolour in the plan.

## BOX-17 plan: photoreal 2D projection (written 2026-10-04, before any rendering)

Nothing is rendered yet. Built so far: `clips2d.js` (pure, render-only: clip catalogue, `reactionClip`, `clipRate` that lands a clip's impact frame on the sim's arrival tick, `planImpact`, `ShotDirector`, `LOOKS`/`postProfile`, `timecode`) and 4 tests (281 pass). The sim is unchanged; the 3D view stays as the fallback until 2D is better. All sizes below are estimates, not measurements.

**Camera and shots (user: tighter, more close shots).** Few fixed camera setups, each plate and clip set rendered once per angle; every push, shake and whip is a 2D move on the same plate.
- `medium`: both fighters knees-up filling the phone portrait frame, heads about 1/6 from the top, court and crowd soft behind. The readable default. `push` is a 1.18x 2D punch-in on it for hits.
- Close angles (own renders): `close_red` / `close_blue` over-the-shoulder past the defender (85 mm look), `ko_close`, `replay_close`. 3 close angles plus medium = 4 setups; replays reuse `replay_close` with the camcorder look.
- Edit rhythm (`ShotDirector`): cut on a heavy hit (energy01 >= 0.6) to the attacker's side, hold 0.5-1.5 s by hit strength, 2 s cooldown, then back to medium; a KO always cuts to `ko_close` (2.4 s, slow-mo 0.9 s, dutch).
- Close-up library (inserts, 0.5-1.5 s, mostly pre-bell and finishers; picked by impact per KB): face/eyes before the bell, gloves tapping, jab in the face, body-shot impact, sweat spray, feet on canvas, corner and trainer, ref's count, slow-mo KO. Techniques: rack focus, speed ramp into impact, whip-pan cut, match cut between exchanges, foreground occlusion (ropes/gloves), slight handheld drift, all 2D post except the rack focus (two depth-layer blends).

**Fighters.** Rendered in Blender/Cycles from the straightened MPFB person, same HDRI and key as the baked court (day and night). Motion blur baked into fast clips (Cycles, 180 deg shutter). Alpha film with soft AA edges plus a separate contact-shadow pass. Clips (`CLIPS` in `clips2d.js`): idle guard, step in/out, jab, cross, hook, uppercut, body, block, slip, hit head/body, stagger, knockdown, get up, KO, celebrate; red faces right, blue is the mirrored render, so one render serves both corners.
- **Looks: a curated outfit set plus a runtime mask recolour.** Each frame ships as colour RGBA plus a small mask (R top, G bottoms, B shoes/wraps) that a shader recolours; skin tone is 3 pre-rendered sets later (the prototype ships one). Full per-garment layer passes cost 6x and aren't worth it on a phone. Cap, chain and wraps are baked.
- Size per angle, 384x512 px WebP frames at ~18 KB colour + ~5 KB mask: about 224 frames x 23 KB = ~5 MB for medium; close angles at 768x1024 for ~8 clips = ~3 MB each. First load target (under 15 MB): medium core clips (idle, 5 punches, block, slip, hit x2, ko = ~3 MB) + day plate + crowd far layer; the rest streams.

**Scene (user: everything photoreal, "leaves, every single thing").** `scripts/bake-court.py` is rebuilt in Blender with CC0 PBR textures (Poly Haven, ambientCG) at real-world scale, weathering, grime, cracks, puddles, decals; a photoreal street car, real foliage with translucent leaves, grass through cracks, HDRI sky and clouds, power lines, litter, ring ropes and canvas, original spray-paint graffiti (no real artists or brands). Output: day and night plates per angle with a depth pass for the DoF, ~300-450 KB each as WebP. Ambient motion (leaves, flags, lamp flicker) as short looping layers. **Gate before calling it done: `qa/scene-inventory.md`, every object with its source and licence, each marked photoreal; nothing stylized left.** All sources in `models/CREDITS.md`. Before/after renders posted on the issue.

**Crowd (user: small animations only; real stock footage where it beats a render).** Kept in the soft out-of-focus background of every shot, three layers (near: cropped by the frame edge and blurred; mid; far), faces small, turned or occluded by ropes, fence and fighters, so no lip sync. Each layer is a few short seamless loops (2-4 s, 12-15 fps) with random start offsets so they never sync, plus 1 s reaction loops (`cheer`, `wince`, `jump`, from `planImpact().crowd`) played on a few people at a time. Format, smallest per layer at equal quality: sprite-sheet WebP atlas on a canvas (best for reaction sync), animated WebP for far/mid groups, WebM VP9 alpha (HEVC-alpha .mov for iOS Safari) only for near layers; never .gif. Budget a few hundred KB per layer, ~1.5 MB for the crowd.
- **Footage vs render**: crowd, street plate ambience (flicker, steam, rain, smoke, traffic glimpses) come from real stock video where a clip fits (Pexels, Pixabay, Mixkit, CC0; no logos, celebrities, watermarks, editorial-only; each clip's URL and licence in `models/CREDITS.md`; originals stay out of git, only processed loops are committed). Fighters, the car and props are renders unless footage fits. Grain, grade, blur and camera height are matched so the two read as one camera. The HANDOFF will list each element as footage or render with its size once built.

**Finish (all a cheap 2D post-pass, toggleable, 60 fps; `postProfile`).**
- Clean filmic (default): LUT grade, light grain, subtle vignette, gentle bloom on highlights, DoF from the depth pass, crossfades between clips with matched boundary poses (every clip starts and ends in the idle guard pose), impact accents (radial/directional blur, slight chromatic aberration, shake, slow-mo with blur trails on knockdowns).
- Camcorder (setting: Clean filmic / Camcorder; also forced for replays and intro/walk-out): soft image, chroma bleed, scanlines, tape noise, rare tracking wobble, warm washed grade, rounded vignette, REC dot and a date plus round-clock stamp (`timecode`), stronger glitch/roll on knockdowns and between rounds.
- `lowEnd` drops bloom, DoF, grain, chroma and wobble and keeps the grade. Detecting low-end (frame-time probe over the first 2 s) is not built.

**Pipeline and build order.** `scripts/render-fighters.py` (Blender, headless, poses `person.glb` with the existing `anims.glb` clips straightened as in `boxer-model.js`) then `scripts/pack-sprites.mjs` (sharp: crop, WebP, atlas JSON, mask pass) then `arena-2d.js` (canvas compositor: plate, depth-sorted fighters, shadows, crowd layers, post-pass, driven by `clips2d.js`). Slices, each shipped when green: (1) this plan + mapping (done); (2) render the medium angle, day, 6-8 actions for one round and the 2D arena behind a View option ("2D photoreal (beta)") with the 3D view as default; (3) post-pass and looks; (4) close angles and shot director live; (5) crowd loops; (6) scene rebuild and the inventory gate; (7) the full clip set and night.
**Tooling gaps found**: `ffmpeg` and `cwebp` are not installed (sharp can write animated WebP, but WebM VP9-alpha and HEVC-alpha need ffmpeg, and stock footage needs it for keying and loops). Installing it (`brew install ffmpeg`) changes the machine, so I'm asking before doing it.

## Done (2026-10-04): BOX-18 slice 4, street moveset animated (shipped live)

BOX-22 landed. `boxer-model.js`: the seven new punches borrow a base punch's clip and IK path (`PUNCH_CLIP[...].as`; `big` widens the swing and foot pivot: haymaker 1.6, overhand 1.25, check hook/short upper 0.7, cheap shot 0.6; side from the sim's hand). Before this, a slipped street punch from the opponent would have thrown in `pose()` (`PUNCH_CLIP[type].side` of undefined); now guarded. Non-punch moves read from `snapshot()` (`action`, `shell`, `clinch`, composure unused): shell (hands up tight, knees dip), clinch (hands over the opponent's shoulders, leans in), shove/push_off (both hands to the chest, step in), feint (lead hand twitch and dip), taunt (arms open, rises). Pivot has no pose of its own (the sim moves the body and the footwork steps). Test: every punch type (also as the opponent slipping it) and every action poses finite bones with planted feet under 0.5 mm per frame. Shipped: claude-quest main a91ec1e, bring-the-ruckus 4a3702f; `demo-e2e.mjs` clean locally and live.
- **`npm test` has 1 failure on main that isn't from this change**: `test/corner-ai.test.js` "the schema lists exactly the sim tactics" is missing `brawl` and `dirty_boxing` from BOX-22. Its owner needs to add them to the schema.
- **Untested by eye**: all the poses (clinch hand reach and arms through the opponent's body, shove, shell, taunt), the street punches' windups (haymaker uses the hook clip, no real wind-up pose), and no combo/flurry-specific motion.
- Still open in BOX-18: CMU mocap, before/after clip, phone frame time.

## Next jobs

0a. **BOX-28 follow-ups**: watch the fighters in a browser (stepping, sway, hands, swag beats) and tell me what's off; decide whether the sim's constant locomotion (0.7 m/s average) should be reduced so steps reach <=2/s (sim change, Sim Dev); and say whether I may push main and sync bring-the-ruckus.

0. **BOX-17 slice 3**: post-pass and looks (see the plan above). Check slice 2 in the browser first: View, "2D photoreal (beta)".

0b. **Play BOX-13 and the career on a phone** and tell me what feels off (see its untested list).

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

## Done (2026-10-04): UI style pass, graffiti type and monochrome (BOX-13, Boxing UI Dev)
User style direction applied to the whole UI. Sedgwick Ave Display (graffiti: logo, titles, buttons) plus Barlow Condensed (body, numbers) are self-hosted in `public/boxing/fonts/` (OFL, licences in `fonts/CREDITS.md`), no Google request at runtime. Palette in `:root` of `index.html` is now black surfaces, white/soft-grey text and one muted ember accent (`--accent #c2512f`); primary buttons are white on black; the title scene is desaturated; logo has an ember tag underline and a slow drip (off under `prefers-reduced-motion`). Fight-canvas content (3D arena, Phaser) is unchanged. Untested: real phone/Safari font rendering; screens other than title and career intro were not eyeballed after the recolour (hurt flash, result, gym, card), only the token swap.

## Done (2026-10-04): damage on screen, BOX-9 first slice (Boxing UI Dev)
The sim records only `target` ('head'/'body') and `outcome` per punch (the `ZONE` in `physics-engine.js` is the ropes zone), so no sim change: zones are derived from those. Landed head shots -> head, landed body shots -> body, blocked shots -> arms ("Blocked"); slips hit nothing. `flow.js`: `zoneOf`, `emptyDamage`, `recordDamage`, `zoneHeat` (pure, tested). `index.html`: `silhouette()` / `paintSilhouette()`; each fighter's HUD has a small figure beside the bars whose zones tint amber to red and pulse on each hit (listens to `impact`, never writes the sim); the result screen has a "Damage taken" card with a big figure and health points and shots per zone for both fighters. Tally is reset per fight and stored in `state.result.damage`. `npm test` 271 pass; `demo-e2e.mjs` clean (new `qa/game-7b-fight-damage-*.png`, `game-8-result-*.png`).
- Not built yet from BOX-9: between-rounds stats screen, per-round breakdown, punches by type, AI corner timeline. **Untested**: night HUD by eye, real phone, reduced-motion.

### Style pass follow-up (2026-10-04)
Eyeballed hub, gym, fight card, corner and result at 375 px (career-e2e screenshots) and fixed leftovers: energy bar, archetype portrait tints, blue/red corner names and table headers now grey/white, all big numbers (purse, money, XP, record, damage) use Barlow Condensed bold instead of the graffiti face. Left as is: damage figure heat colours (functional). Still unchecked: real phone, Safari.

## Done (2026-10-04): BOX-9 slice 2, full stats screen (Boxing UI Dev)
`flow.js` `punchBreakdown(rounds)` (landed/thrown per punch type and per round, from `sim.rounds`, tested). `index.html`: a "Fight stats" button in the between-rounds corner sheet opens a full-screen overlay (damage by zone so far, punches by type with land rate, round by round); the result screen has the same punches-by-type and round-by-round cards. `npm test` 272 pass; `demo-e2e.mjs` clean, screenshots `qa/game-7c-stats-*.png`, `game-8-result-*.png`.
- Not built from BOX-9: the AI corner timeline (tactic per round, retrieved precedents and why, labelled as retrieval). **Untested**: real phone, overlay scroll on short screens.

## Done (2026-10-04): BOX-9 slice 3, AI corner timeline (Boxing UI Dev)
`flow.js` `aiPlan(me, opp, roundIndex, seed)` is the AI corner's old rule moved out of `index.html` (same order and outcomes) and now returns `{ tactic, reason }`; tested. The stats overlay and the result screen (single player only) have an "<opponent>'s corner" card: per round, its tactic against yours and why. **Finding**: the AI corner does not use the fight log and does not read the player's tactic; it is a fixed rule on stamina, health and stats. `retrieveTacticalPrecedents` only feeds the player's coach tip. The card says so, plus "Your coach's intel: N precedents retrieved from M logged rounds". `npm test` 274 pass; `demo-e2e.mjs` clean (`qa/game-7d-stats-corner-*.png`).
- Not built: real in-fight adaptation (AI using precedents or reacting to the player's tactic). Proposed as a separate deterministic step in the BOX-9 comment. **Untested**: real phone, P2P (no AI there, card hidden).

## Done (2026-10-04): BOX-21 Fight IQ panels (Boxing UI Dev)
`fightiq.js` (pure, tested): `statSources` (start 50, + training camp, + gym sessions from `career.trained`), `tendencies` (plain words from the stats and `deriveAttributes`), `learnedFromLog` / `learnedLines` (counts from the player's own `fight_logs` rounds: favourite plan and its win rate, best plan with 2+ rounds, best plan per opponent kind). `index.html`: the Fighter screen shows what raised each stat under its bar and a "Fight IQ" card (How you fight, Learned from your fights, with a note that it is counting and lookup, not a trained model); the Training screen shows the same source line per stat plus "+N unsaved"; the fight HUD chip now reads "PLAN · <yours> · vs <theirs>". "What changed" after a career fight was already there. `npm test` 275 pass; checked at 375 px in headless Chromium with seeded log rows (`qa/box-21-fighter-iq.png`, `box-21-training.png`), no console errors.
- **Untested**: real phone, the plan chip in a live fight (code path only), the card with a long career log, P2P (rows use `managerCorner`).
- Not built: a stat-change line in the quick-fight result, the plan tag as a richer HUD element.

## Done (2026-10-04): BOX-24 fighter card and What changed (Boxing UI Dev)
Most of BOX-24 was BOX-21 (stat sources, tendencies, learned-from-log, plan chip). New here: `fightiq.js` `fighterSummary` (record, camp points and gym sessions, unspent points, energy and injury with the exact penalty) shown as "Record and condition" at the top of the Fight IQ card, and `changeLines` for a "What changed" card on quick-fight results (record before/after, points, unlocks; career fights keep their own card). `npm test` 276 pass; `demo-e2e.mjs` clean at 375 px (screenshots `qa/game-3-fighter.png`, `game-8-result-*.png` refreshed).
- **Untested**: real phone, the card with a long career, P2P result card.

## Done (2026-10-04): BOX-26 slice 1, fight HUD polish (Boxing UI Dev)
`index.html` only. Meters are monochrome (white health, grey stamina; health under 35% turns ember and pulses), the clock turns ember and blinks in the last 10 s, round pips under the clock, and a graffiti banner slams in on "Round N / Fight", "End of round N" and "K.O." (`banner()`, `drawPips()`). Speed and leave buttons are 56 px round thumb buttons in the bottom corners above the plan chip. Reduced motion: the global rule makes the banner and pulses instant (banner never visible). `npm test` 277 pass; `demo-e2e.mjs` clean at 375 px (`qa/game-7-fight-*.png`).
- **Untested**: real phone thumb reach, the banner and low-health pulse by eye (the screenshot is a mid-round frame), night HUD.
- Already existed from BOX-13 (not redone): hit flash, shake, KO slow-mo, scorecard reveal, Training upgrade screen, outfit unlocks, debug drawer. **Remaining in BOX-26**: scorecard reveal polish, upgrade-screen polish, a 2D-swap check.

## Done (2026-10-04): BOX-26 slice 2, scorecard reveal polish (Boxing UI Dev)
`index.html` only. Scorecard cells now mark the round winner (bright, stamps in) and dim the loser; the Total row glows for the winner. Reduced motion: global rule makes it instant. `npm test` 281 pass.
- **Untested**: by eye on a phone. **Remaining in BOX-26**: upgrade-screen polish, a 2D-swap check (the e2e script only drives the 3D view).

## Done (2026-10-04): BOX-26 slice 3, upgrade-screen polish (Boxing UI Dev)
`index.html` only. Training screen: points counter bumps when it changes, each raised stat shows an accent "+N" chip (pops in), saved rows flash on Confirm. Reduced motion: global rule makes it instant. `npm test` 281 pass.
- **Untested**: by eye on a phone. **Remaining in BOX-26**: a 2D-swap check of the new HUD (e2e only drives the 3D view; needs a browser).

## Done (2026-10-04): BOX-23 corner talk, your own AI (Boxing UI Dev)
Between rounds the corner sheet has a chat strip: 2-3 bubbles from the fight state, a text box, the trainer's reply and a plan tag. `corner-ai.js` (pure, tested): `buildContext` (round, health, stamina, hits taken per zone, opponent's favourite landed punch, scorecards), `suggestBubbles`, `keywordPlan` (the basic corner), `PLAN_SCHEMA`/`parsePlan` (tactic, focus, aggression, say; fences, prose and unknown tactics handled), and the client for the player's own model. **The plan only ever sets the next round's tactic key** (the sim has no other corner parameters): focus body turns pressure into body attack and low aggression turns pressure/body attack into counter, the rest is shown as a tag. P2P sends it like a button press; the model runs only on the player's machine. Test: a fight with the plan's tactic equals the same fight with the button.
- **Settings, "Your AI corner"**: Ollama (default http://localhost:11434, native `/api/chat` with a `format` schema), LM Studio (http://localhost:1234/v1) or Your API (any OpenAI-compatible endpoint plus key; Anthropic through a compatible gateway). Find models, Test connection (model and ms), Forget key, Disconnect. The setup line for CORS is shown per kind (`OLLAMA_ORIGINS=*`; LM Studio "Enable CORS"). The key is in localStorage `bm.ai` only, sent only as `Authorization: Bearer` to the typed address (`redirect: 'error'`, no credentials, no referrer), never in a URL, body, prompt, error text or log; Ollama requests carry no key. Tests assert this with a mock fetch; `scripts/corner-e2e.mjs` asserts it in a browser against a mock endpoint.
- **Not connected or failing** (down, 4xx, timeout 20 s, unusable reply): the keyword corner answers and the line under the chat says "Basic corner (connect your AI for smarter advice)" (plus the reason on failure). Connected: "Your AI: llama3.2 on localhost". Bubble wording also comes from the model when connected (templates show first and are swapped in).
- The in-round shout was not built: changing a plan mid-round would write to a running sim (determinism, lockstep). The HUD plan chip now ends with the player's words, e.g. `PLAN · Counter-punch · vs Pressure · "protect the body"`.
- Files: `corner-ai.js`, `index.html` (corner strip, settings, `initTalk`, `renderAI`), `test/corner-ai.test.js` (21 tests), `scripts/corner-e2e.mjs`; screenshots `qa/box-23-*.png`. `npm test` 302 pass; `demo-e2e.mjs` and `corner-e2e.mjs` clean at 375 px.
- **Untested**: a real Ollama, LM Studio or hosted API (only mocks: real models may ignore the schema or answer slowly; CORS and the https-page-to-http-localhost rule (Chrome allows localhost, Safari and Firefox may block it) are unchecked), a real phone keyboard over the sheet, reduced motion, P2P with a plan, the sheet height on very short screens (it scrolls).
