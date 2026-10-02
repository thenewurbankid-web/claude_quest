# Quest (formerly Claude Quest): handoff (2026-10-02, evening)

**New session, start here.** Run with `npm start` (http://localhost:4777) or the `claude-quest` preview config.
Git repo: github.com/thenewurbankid-web/claude_quest (public). `config.json` is git-ignored; copy `config.example.json`.

## NEXT SESSION START HERE: smooth buildings + an asset editor (user, 2026-10-02 late night)
- Done this session (on `3d-world`, not pushed): Nunito text (b3ed7fb), moonlight (4d43d2d), Sunnyside pixel houses
  folded like cards + the Lodge as the big orange house (d1b5b39), the Sunnyside stone well (6a39309).
- **Then the user changed direction:** the pixel houses "don't match other assets". Buildings should be **smooth
  stylized 3D** to match the KayKit people; the ground and trees stay pixel art. This replaces the pixel houses and
  well above, but keep `folded()` in sunnyside.js as the fallback.
- **Uncommitted, untested:** a richer ground painter in `public/3d/sunnyside.js` `ground()` (grass variants, ragged
  road fringe, flower/tuft decals; `LOOK.ground.flowers/tufts`). It has two unused leftover variables (`px`,
  `grassRGB`). Run it and check it, then commit or drop it.
- **Asked for: an asset editor** in the game. It should show the full sprite sheet and all 3D assets, get assets
  from packs (e.g. KayKit Medieval Hexagon, CC0, 33 MB, kaylousberg.itch.io; not downloaded, needs the user's yes),
  generate assets locally or in the cloud through connectors, and import and export. Scope it into steps first
  (viewer → import/export → place in world → generation). It could grow out of the existing Sprite Lab artifact.
  The saved preference is real assets first and minimal AI generation, so ask how generation should fit.

## polish (user, 2026-10-02 night)
The user wants it polished "like a Zelda or Pokémon game", with readable text that isn't pixelated.
- **"Not pixelated" means the text only** (user: "no just text"). The world stays Sunnyside pixel art, and the people
  stay 3D (KayKit). Do NOT move the world to 3D. That was proposed and declined.
- ~~Readable text~~ **done (b3ed7fb):** Nunito everywhere (3D HUD, 2D game, settings, map labels), and the 2D boxes
  are rounder with a soft shadow, a smooth "more" arrow and an accent cursor.
- Improve the ground, trees, well and buildings within the pixel world: Sunnyside's modular houses instead of boxes, a
  proper well, richer ground (paths, edges, flowers), and more tree variety.
- Voice (optional, 0 Claude tokens): Keepers and townsfolk speak their lines. Choose between the browser's built-in
  speech (free, robotic) and a small in-browser voice model (~80 MB download, better). Add a mute setting.
- ~~Night too dark~~ **done (4d43d2d):** cool moonlight at night, tunable with `LOOK.light.moon` (0 = old night).
- Then the 2D→3D port, step by step: real Keepers, talking, towns and camps, game systems, then autoplay, minimap and save.

## Characters + feel (user, 2026-10-02 night)
- **3D is the default page** (`/` = the 3D view, `/2d.html` = the full 2D game; `#link=` pairing links forward to 2D).
- **People are 3D now:** KayKit Adventurers (CC0, in the repo at `public/assets/3d/kaykit`) on the Sunnyside pixel
  world. The user found the pixel people "too pixelated" and asked for stylized 3D that matches the world.
  `LOOK.characters` ('3d' or 'pixel') or `?chars=pixel` switches back. The height is 1.35 tiles (manifest). The
  player runs (Running_A) and Keepers walk (Walking_A).
- Idle animations (breathing) start only after `LOOK.move.idleAfter` (2.5 s) of standing still, for both 3D and pixel.
- The player glides cell to cell at a steady speed while a key is held, with no easing or stop per cell. Footsteps are removed.
- Trees no longer cycle their frames, which looked like dancing.
- **User's lab settings applied (2026-10-02 night)** in `public/3d/look.js` plus the manifest: the player is the Ranger,
  the Keepers are the other KayKit models, 1.85 tall, 3 Keepers. Also animation speed 1.75, blend 0.55, idleAfter 2.75,
  camera 9.2 up and 17 back, sun 1.5 at azimuth −6, shadow softness, saturation and contrast in the grade pass,
  ground brightness 0.56, water opacity and flow, wisps at 9.4, trees (mixed, ×1.2, density 0.27, ring 4, 4 inside),
  and animals (3, chickens and ducks; ducks swim in the pond).
- **Trees fixed after "they look like they're floating":** they stand upright (not camera-facing) with their own
  contact shadow (`LOOK.trees.contact`). The high canopy is off: trunkless crowns near the ground read as floating.
- **Next, asked by the user:** improve the ground, trees, well and buildings. Houses and the Keeper's Lodge are still
  placeholder boxes, the well is a plain cylinder, the ground is flat swatches, and the trees are two small Sunnyside sprites.
- Sprite lab (artifact) has controls for every sprite, parallax layer, weather, grade and light. It still shows
  pixel people; giving it the 3D characters is not done yet.
- An 8-way Sunnyside human export was started and parked: a reader exists in the scratchpad, and the characters are 3D now.

## Naming (user, 2026-10-02 night): no real product names
- The helpers formerly called Claudes are **Keepers**; the hub building is the **Keeper's Lodge**. The game is **Quest**.
  Done everywhere players see it and in identifiers (`keepers`, `keeperName`, kind/source/owner `'keeper'`).
- Kept on purpose, because they're functional: the `claude` CLI and `cfg.claudeBin`, `~/.claude/` paths, the hook install,
  model IDs, and "Claude Code" in comments and in prompts describing real transcripts.
- Old saves still load: `claudeName`, `claudes`, `source: 'claude'`, `owner: 'claude'` and the `claude-quest-save`
  file kind are all migrated or accepted (`upgradeWorld` in world.js, `settings()` in lib/areas.js).
- The settings screen keeps real tool names (user's call). Dead files (`server.js`, `game.js`, `hook/deliver.js`) were not touched.
- **Waiting on the user:** a new code, folder and repo name. That step also renames the IndexedDB `claude-quest`
  (needs a migration), the local hub town id, the hook path and the package name, and changes the Pages URL.

## Art direction, latest (user, 2026-10-02 late): pixel HD-2D, Sunnyside World as the anchor
Supersedes the Pixel Crawler and KayKit notes below. Both are parked on branches: `hd2d-pixel-crawler` (Pixel Crawler
ground tiles in a world-space shader, reusable for Sunnyside) and `lowpoly-kaykit` (KayKit glTF characters).
- **Default packs**, all downloaded into ~/Downloads with real names:
  - World: `Sunnyside_World_ASSET_PACK_V2.1.zip` (Daniel Diggle, 16 px). The 8-way human beta is an `.aseprite`
    source only, so it needs an export step.
  - Village: `Pixel 16 v2 village free.zip` (zedpxl). Paid v2 is $5.99.
  - Pets: `AllCatsDemo.zip`, `CatMaterialsDEMO.zip` (ToffeeCraft, 32 px frames). Paid, all cats: $1.80.
  - UI: `Humble Gift - Paper UI System v1.1.zip` (Humble Pixel). Paid Player Status: $4.
  - FX and music: Ninja Adventure (CC0). Backup props: Pixel Crawler.
- **User decisions:** the packs ship as defaults; players can reset to defaults but can't delete them. `/settings` gets
  an asset manager (import packs, pick a pack per role, credits, buy links).
- **Licence decision (user, 2026-10-02):** keep the packs out of git and upload them into the Pages build from the
  Mac. They're unzipped in the git-ignored `public/packs/`. That deploy step isn't built yet. Caveat raised to the
  user: packs on the live URL are still publicly downloadable.
- **Slice 1 built (uncommitted):** `public/3d/sunnyside.js`. With Sunnyside present, the 3D view paints:
  - the ground (grass and path) from the 16 px tileset onto one canvas, with water from a world-UV tiled swatch
  - Sunnyside animated trees at the tileset's own scale, which fade when they stand between the camera and the player
  - people as camera-facing billboards: body, hair and tools layers composited, idle and walk strips flipped for
    left and right, sun and fire shadows, and a blob shadow
  - the 3D grass blades and the Ninja Adventure canopy hidden (`atmos.hideCanopy()`), since they clash with the pixel style
  Without the packs (for example on Pages), `load()` returns null and the placeholders remain. Water was invisible
  before this change: its plane sat under the tile tops, now fixed at y −0.28.
- **Next slices:** houses and Claude Center built from Sunnyside's modular roof and wall tiles (they're still
  placeholder boxes); well, board, mailbox and waystone props; animals (chickens, sheep) and ToffeeCraft cats; the
  `/settings` asset manager; the Pages upload step. Up/down walking reuses side frames, because Sunnyside humans are
  side-view only. The 8-way beta is `.aseprite` and needs an export step.
- **Queued from the user:** smooth animation, walking and camera; parallax layers; an occasional lightning flash in
  rain, not only storms.
- Sprite lab artifact (tuning sprites, light, camera): https://claude.ai/artifact/KXfCSDFdAg5UmzaeFCnYfP. Its tuned
  values are in `public/3d/look.js`, already used by `scene.js`.

## Next up
**Read `PLAN-settlements.md` and `PLAN-adventure.md` first.** Settlements is phases A–F. Adventure is the casual-player
mode: a real game with no Claude Code needed, traditional game AI by default and WebLLM opt-in. Phase A comes first for both.
1. **Phase A, lore foundation:** move today's story text into `lore/` with no visible change, then the lore loader,
   then the WebLLM storyteller (Ollama/Off as fallbacks). This also covers the old "editable names + project-aware lore".
2. Then Phases B (Studio + saves), C (Settlements), D (GitHub), E (Android), F (multiplayer), in the plan's order.
3. Older backlog: battles phase (proposed), parallax/RS feel (3b), mounts (5), plugin.

Decisions made 2026-10-02 (details in the plan):
- In game the name is **Quest** / **Quest Marketplace**. On GitHub and in code it stays `claude-quest`.
- GitHub repos are owned by `thenewurbankid-web`: `claude-quest-marketplace`, plus a private `claude-quest-saves` per
  player. Neither is created yet.
- Paperclip is optional.
- The game itself costs 0 Claude tokens.
- Lore files hold lore and settings; the save file holds state.
- Multiplayer is invite-only over WebRTC with an MQTT relay fallback, never through git.

Still open: the licence for shared lore and art in the marketplace.

## North star (user, 2026-10-02)
*"This should be the way people work with agents."* Aim for mindblowing and clean: a living, classy diorama of your
agents at work, not a dashboard with a game skin.

## Atmosphere + real time (2026-10-02, late; uncommitted, see `git status`)
Built in `/3d.html` and checked in the browser (rain, storm, snow at night, autumn leaves, clear dawn). No console errors.
- **Camera:** lower and closer, like the newer Pokémon games (`CAM` in `public/3d/scene.js`, (0, 10.5, 13.5), fov 32).
  The user asked for "a little down and closer". Tune it there.
- **Real local time:** `public/3d/clock.js`. Sunrise and sunset come from the stored rounded location, else a guess from
  the time zone. `?time=dawn|day|dusk|night` pins a time. T runs a fast preview day.
- **Weather, toggled with R or the top-right chip** (`public/3d/atmosphere.js`). Modes: Seasonal (default, changes every
  20 min by season), Real (opt-in: the browser asks for location, rounded to ~10 km, Open-Meteo, no key), and fixed
  Clear, Cloudy, Rain, Storm, Snow, Fog, Autumn wind, Blossom, Off. The choice is kept in localStorage. `?weather=` sets it.
- **Depth layers, for parallax with this camera:**
  - pixel tree crowns outside the map
  - drifting cloud wisps and cloud shadows
  - weather particles through the whole depth (Ninja Adventure sheets, a custom points shader)
  - rain splashes, dawn mist, light shafts, lightning
  - rain, storm and wind ambience
- **Not tested:** Real weather (needs a location permission), sound in the browser.
- **Decided:** parallax and weather moved ahead of textured terrain in the technique list.
- **Horizon backdrops** (ansimuz CC0 Magic Cliffs and Mountain Dusk, the MatiasVME CC0 forest) only show with a flatter
  camera. Not downloaded. VISTA is generated by code and looks muted. edermunizz is CC BY-ND, so reference only.
  Board of candidates and reference games: scratchpad `parallax-board.html` (rebuild if needed).
- **Pixel Crawler** (Anokolisa, pixel-crawler on itch): the user says it's a must. Its terms (Google Drive PDF) allow
  commercial use and edits, need no credit, and only forbid reselling the art. **Decided (user, 2026-10-02): Pixel Crawler is the
  main world and character style.** Ninja Adventure stays for particles, FX and probably music. The user downloads it into ~/Downloads.
- The user wants every artist credited (`public/assets/CREDITS.md`), matching effects and music (next: the pack's 37
  tracks by mood, replacing `music.js`), and a delightful game where people "forget they are working".

## Art direction: HD-2D (user, 2026-10-02; replaces the low-poly plan, "no low poly")
Pixel-art sprites in a lit 3D scene, like Octopath Traveler, Triangle Strategy and the Dragon Quest III remake (Sea of
Stars and Eastward for lighting). It keeps the Pokémon-GBA soul and looks premium with free assets.
- **No low-poly models.** KayKit and Quaternius are dropped; don't download them. No hand-drawn or AI art.
- **Assets:** the Ninja Adventure pack, Pixel-Boy & AAA, CC0. It has:
  - animated characters with portraits, monsters, bosses
  - tilesets, effects, items, UI, fonts
  - 37 music tracks and 100+ SFX

  It's at pixel-boy.itch.io/ninja-adventure-asset-pack (89 MB). itch.io downloads can't be scripted, so the user downloads
  it into ~/Downloads. Credit it in `public/assets/CREDITS.md`.
- **Keep from the 2.5D step 1** (`public/3d/`):
  - Three.js renderer, square grid interface, camera follow
  - sky, day/night, bloom, tilt-shift, vignette
  - Ember Well fire, fireflies, footsteps, touch pad
- **Swap:**
  - placeholder shapes → camera-facing sprites (billboards) with walk animations from the pack's sheets,
    nearest-neighbour filtering, lit by scene lights and casting shadows
  - box tiles → textured tiles from the pack's tilesets
- **Techniques to add, in rough order:**
  1. sprites lit by real lights, with shadows (the Ember Well lights the characters)
  2. textured terrain plus wind sway on grass, trees and water
  3. a smooth spring-damped camera with gentle sway
  4. layered parallax backgrounds (mountains, clouds, distant forest)
  5. curved-world projection (the ground bends away at the edges)
  6. light shafts through trees, plus bloom on embers and magic
  7. water reflections and shimmer
  8. weather particles (rain, petals, embers)
  9. ambient occlusion, anti-aliasing, colour grading
- **Grid:** hybrid, built in steps, starting with the square grid. Keep the grid interface so hex regions can come later.
- Be honest about "AAA": the target is a polished, cohesive indie game that's a delight to play.
- Parallax is back in, as layered backgrounds.
- Open: whether the pack's music replaces the generated music in `music.js`. It probably should, matched by mood.
- Uncommitted on purpose: `site/index.html` hero change. Replace it later with a real HD-2D screenshot.

## 2.5D preview: step 1 built (f4e36ed)
- `/3d.html` (local: `npm start` then http://localhost:4777/3d.html). Test server: the `claude-quest-3d` launch
  config on port 4779, which uses a scratchpad copy of `data/`.
- What's in it:
  - the hub as a diorama on the square grid (`public/3d/grid.js`, `hub.js`, `scene.js`)
  - lighting, sky, grass, water, Ember Well fire, fireflies
  - day/night, with `?time=night` etc. to jump to a time
  - tilt-shift and bloom
  - footsteps and a touch d-pad
- **Placeholder shapes until the Ninja Adventure sprites arrive** (KayKit plan dropped, see Art direction). The user
  downloads the pack into ~/Downloads, since itch.io downloads can't be scripted. Then:
  - copy the sheets and tilesets the scene uses into `public/assets/`
  - swap the placeholders for sprites
  - credit the pack in `CREDITS.md`

  `public/assets/3d/manifest.json` was for glTF models. Replace it with a sprite map when sprites go in.
- Downloaded and in the repo (CC0): Kenney Particle Pack subset, Kenney RPG Audio subset, Poly Haven Kloofendal sky 1k.
- Next steps:
  - Ninja Adventure sprites and tiles (HD-2D)
  - the 2x2 footprint for the Claude Center
  - real 2D-game data (towns, Claudes, bosses) feeding the 3D view
  - then hex regions

## Live on GitHub Pages (deployed 2026-10-02)
Game: https://thenewurbankid-web.github.io/claude_quest/ · guide: /guide/ (from `site/index.html`).
`.github/workflows/pages.yml` redeploys on every push to main.

## Hosted game link: built, committed in e5ee096
- `public/net.js` has three modes:
  - **local**, served by `app.js`
  - **linked**, a hosted page (GitHub Pages build via `scripts/build-pages.sh`) paired with the Mac over an outgoing-only,
    E2E-encrypted MQTT link (`lib/link.js`, `public/linkcrypto.js`). The pairing code is in `data/link.json`.
  - **browser**, which plays on the last world saved in IndexedDB, with export/import and checkpoints. Actions wait in a
    queue until there's a link.
- `public/touch.js` has phone touch controls. `/settings` shows the mode and manages saves.
- **Not verified:** it was committed as found, without a run in that session. Before relying on it, check:
  - a real linked session end to end (world arrives, an action round-trips)
  - the Pages build deploying
  - play on a phone
  - a save export/import round trip

## What changed today (Phase 2 + polish)
- **Areas come from `data/world.json`** via `lib/areas.js`, not `config.json`. Server, storyteller and `hook/live.js`
  all read it. Only claude-quest is charted. Old towns are gone; their 11 undelivered inbox letters won't deliver.
- **Title screen / New Game / intro** with Warden Ash (`titleScreen`, `intro` in `public/world.js`). New Game only
  resets client-side position and attuned stones; never touches `data/`.
- **Cartographer** in the hub: chart a git repo directly under ~/Repositories (max 5, the fixed `TOWN_SLOTS`), abandon a
  land. Routes `GET /api/repos`, `GET/POST /api/areas`, `POST /api/areas/update`. Lands register in Paperclip when
  the Guild Hall is up (`registerAreas`). Changing lands reloads the world.
- **Guild Hall** (Clerk or Enter menu): post a quest, send word, call off a quest, send the guild home / call back. The
  Guide's missions can be posted there. Each token-spending action asks first.
- **`/settings`** (`public/settings.html`, the "Map Room"): land name, colour, instructions (`areas/<id>.md`, read by
  the storyteller), sound, music, autoplay delay, subtext, minimap on/corner/size. `POST /api/settings`, `/api/notes`.
- **Maps** (`public/map.js`): minimap (default top right, N toggles) and a full Town Map (M) painted from the live scene,
  cropped to the charted region; arrows jump between places, Z warps to attuned ones.
- **Music** (`public/music.js`): generated chiptune per mood (center, working, idle, boss, night), key and melody seeded
  per land, crossfades, ducks under fanfares.
- **Lumi**, the spirit courier: rift entrance, smooth Catmull-Rom glide with a mote trail, dissolves on exit.
- **Rewards**: `celebrate()` fanfare, sparks, reward card for badges, victories, missions done, new lands.
- **Answers go out when the menu closes** (owner's choice, spends tokens): `POST /api/flush` wakes each resting session
  once with all its answers from the last 24h (`claude -p --resume`). Working sessions still get them live via the hook.
- **Back everywhere**: Esc in a text box returns to the choices; ◀ Back / Send ▶ buttons; options are clickable.
- **Guide**: "NEXT ▸" line (fades after 5s) plus a subtle edge pointer toward the most useful next action.

## Testing safely
- Test server: preview config `claude-quest-test` in `~/Repositories/.claude/launch.json` (port 4778). It uses
  `CQ_DATA` = a copy of `data/` in the session scratchpad, `CQ_PAPERCLIP_URL` = an unreachable address, and
  `CQ_NO_WAKE=1` (wakes are logged, never run). Recopy `data/` into a new scratchpad for a new session.
- Not tested live: charting a land end to end, the settings page saving, Guild actions against real Paperclip, a real
  (non-dry) answer flush.
- **The real game on 4777 may still run the old code** (started from another chat). Restart it to pick this up.

## Watch out
- `claude-sonnet-5` hit its weekly limit today (resets 7am Berlin). Quest Dev and the Line agents use it; Line retries
  fail every ~10 min. Guardrails Dev also fails with "not a git repository" (bad workspace path).
- Night detection treats that model-specific limit as the Long Night when no other transcript moves for 60s.
- `server.js`, `public/game.js`, `hook/deliver.js` are dead. Delete after the user confirms.
- Quest Dev uses `workspaceStrategy: project_primary` because claude-quest wasn't a git repo; it is now.
- The user sends many rapid mid-turn additions. Surface conflicts (e.g. minimap top left → top right: newest wins) and
  re-scope instead of building everything at once.
- Don't clear `data/`: `inbox.json` holds real answers the user gave in game.

## Architecture (unchanged)
- `app.js` server: scans every 15s, Ollama narration, control channel, Paperclip snapshot in `world.guild`.
- `lib/collect.js` transcripts/git/docs/worktrees, `lib/lore.js` game rules and bosses, `lib/paperclip.js` client.
- `hook/live.js` (UserPromptSubmit/PreToolUse/PostToolUse in `~/.claude/settings.json`): inbox delivery, STOP deny.
- v2 plan: `~/.claude/plans/deep-yawning-mountain.md`.
