# Quest (formerly Claude Quest): handoff (2026-10-02, evening)

**New session, start here.** Run with `npm start` (http://localhost:4777) or the `claude-quest` preview config.
Git repo: github.com/thenewurbankid-web/claude_quest (public). `config.json` is git-ignored; copy `config.example.json`.

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
- **Placeholder shapes until the Ninja Adventure sprites arrive** (KayKit plan dropped, see Art direction). itch.io downloads can't be scripted (signed key), so the user
  downloads the 4 KayKit packs + Quaternius Ultimate Monsters into ~/Downloads. Then unzip the glTF files into
  `public/assets/3d/` and map roles in `manifest.json`:
  - roles: player, claude, tree, house, center, board, mailbox, waystone
  - optional `"scale": {role: n}`

  Update `CREDITS.md`.
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
