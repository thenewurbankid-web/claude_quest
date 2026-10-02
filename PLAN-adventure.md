> **Art (2026-10-02):** HD-2D: CC0 pixel sprites (Ninja Adventure) in a lit Three.js scene on the tile grid. No low poly. Wherever this plan says
> "drawn in code" or "procedural art", read it as that instead. See HANDOFF "Art direction".

# Quest: Adventure mode (a real game for casual players)

Status: **plan only.** The user approved the direction on 2026-10-02. It builds on `PLAN-settlements.md`.

## Decisions the user made (2026-10-02)
- **One game, two modes.** *Adventure* is for anyone, with no Claude Code, no Mac server, and play right on GitHub Pages
  or a phone. *Claude mode* is today's game, driven by real work. Both share the engine, lore files, Lore Studio, saves,
  marketplace and art.
- **Traditional game AI by default, WebLLM opt-in, for Adventure.** Adventure must start instantly and run on any phone.
  WebLLM is an optional "Living World" setting for richer dialogue, and progress never depends on it.
  Claude mode keeps WebLLM as its default storyteller (`PLAN-settlements.md` §11).
- **Core loop, all four:** explore and quest · battles and collection · build settlements · story campaign.

## The loop in one paragraph
You arrive at the Ember Well as the Long Night creeps over the lands. You explore towns and wilds, take quests from
NPCs, and battle bosses with a party of Sprites you collect. Each land you free becomes a settlement you build up
through the ages. The settlements feed your adventure: the forge makes gear, the library teaches moves, the trade
port opens routes to new lands. The campaign's chapters tie it together, and each one ends at a gym and a Rift boss.
A session can be 5 minutes (collect from your town, do one quest) or an hour (a chapter).

## 1. Title screen and modes
- **New Adventure** / **Continue** / **Link Claude Code**. The last is today's flow, and it's hidden on the hosted page
  until the player pairs a Mac.
- Adventure runs fully in the browser (the existing `browser` mode in `public/net.js`) and saves to IndexedDB.
  Cloud saves (§17 of the settlements plan) are optional.
- Choosing a mode is per save slot. A Claude-mode save and an Adventure save can sit side by side.

## 2. World
- **Authored core:** the hub (Ember Hollow) and the campaign regions, defined in lore files (`lore/campaign/regions/*.md`):
  - map size
  - which kind of land it is
  - landmarks, NPCs, encounter table
  - music mood
- **Procedural lands:** extra lands generated from a seed plus a kind template (§1 of the settlements plan): layout,
  names and NPCs come from that kind's lore file. They're used for side content and replay. Same seed, same land.
- Day and night, plus the Long Night as a story state. In Claude mode it's tied to usage limits; in Adventure it's a
  campaign event.

## 3. Story campaign (authored, from lore files)
- `lore/campaign/chapters/NN-*.md`: each chapter has scenes. A scene is a list of steps written as **data, not code**:
  - `say` (speaker, lines)
  - `choose` (options → flags)
  - `give` / `take` (items, Sprites)
  - `battle` (boss id)
  - `move` (an NPC walks to a tile)
  - `wait_for` (flag, item, age, quest done)
  - `set` (flag)
  - `unlock` (land, building, waystone)
- Conditions use a small fixed vocabulary (`flag`, `has`, `age>=`, `badge`), and there's no expression evaluation, so
  shared campaigns from the marketplace stay safe.
- **First campaign: "The Long Night"**, 3 chapters for the first release:
  1. *Embers:* meet Warden Ash, get your first Sprite, free Ember Hollow, and found your first settlement.
  2. *The Red Golem:* the forge land and its gym. Your settlement reaches the Feudal Age.
  3. *The Sphinx's Riddle:* the scriptorium land, a riddle boss and the first Rift.

  Lumi, the Sphinx, the Golem, the Wyrm and the Fog become story characters instead of status signals.
- Player-made campaigns are packs (marketplace §15) and are edited in the Lore Studio (a Campaign tab gets added).

## 3b. Never-ending lore (user, 2026-10-02)
The story never ends. The authored chapters are the opening. After them, the **Chronicle** keeps generating new
chapters forever:
- **Arcs from templates:** `lore/arcs/*.md` defines arc shapes, for example:
  - a Rift opens → a land falls → rescue its people → face the Rift lord
  - a rival guild rises
  - a lost Sprite species returns
  - the Long Night deepens

  Each arc has 3–5 beats, and each beat is a scene built from the same step vocabulary as §3.
- **Seeded and remembered:** the Chronicle picks the next arc from the world's state (your lands, ages, party, unresolved
  threads, defeated foes). It reuses named characters and places, and stores every generated chapter in the save. That
  way the story stays consistent, and old villains and allies come back.
- **Escalation without a wall:** new arcs open new procedural lands, Sprites, bosses (variants with new behaviour-tree
  phases) and higher ages. Difficulty follows party level, so a casual player is never blocked.
- **A chapter log:** the Chronicle book in the start menu lists every chapter so far (authored and generated). Each
  chapter ends with a card that teases the next one instead of a game-over ending.
- **Living World (WebLLM, opt-in)** writes richer prose and new names for generated chapters. Without it, chapters are
  made from lore-file lines and templates, and still never run out.
- **Player and pack arcs:** new arc templates from the Lore Studio or marketplace packs join the Chronicle's pool. More
  lore means more variety.

## 4. Quests (procedural + authored)
- **Authored quests** sit in the campaign files.
- **Procedural quests** come from templates per land kind in `lore/quests/*.md`:
  - fetch, deliver, escort, defeat, build, gather, riddle, find a lost Sprite
  - slots are filled from lore names, so a quest reads like "Bring 3 Glass to the Lensworks before the Long Night"
- A **director** paces them. It looks at the player's level, time since the last fight, and party health, then picks the
  next event: a courier with a quest, a wandering boss, a festival, a raid on the settlement, or a rest. The tuning is
  gentle for casual play, so a raid never destroys anything and only slows production.
- Quest log, tracked quest arrow (the existing edge pointer), and rewards (gold, items, Sprite eggs, reputation per land).

## 5. Battles and collection
- **Turn-based battles** in `public/battle.js`, the GBA layout from v2 Phase 4. In Adventure, moves are game moves; in
  Claude mode, they're real actions (v2 plan).
- **Sprites:** creatures typed by land kind (artisan, trade, mine, forge, theatre, festival, scriptorium), with a type chart.
  - Party of 6; they level up and learn moves (some from the library building).
  - **Catching** works by befriending: a quick riddle or offering instead of a throw, which fits the lore.
  - 12 Sprites in the first release, with art drawn in code and replaceable through the Studio asset sheets.
- **Bosses** use small behaviour trees, e.g. the Golem *hardens* when hit twice. They're defined in `lore/bosses/*.md`
  as data: moves, phases, taunt lines.
- **Gyms:** one per campaign land, 3 trainers plus a leader, and a badge each.
- Casual-friendly:
  - losing sends you to the last Waystone with nothing lost
  - an optional "easy" setting
  - auto-battle for grinding

## 6. Settlements (simulated in Adventure)
The same systems as `PLAN-settlements.md` §1–§7, but **game events drive the economy instead of real work**:
- Villagers gather on a tick while you play, with capped offline progress (max 8h, shown as "while you were away…").
- Buildings cost resources and take time. Ages unlock via resources plus a campaign milestone.
- The tech tree uses research points from the library.
- Trade caravans run between your lands, and raids come from the director.
- **Villager AI uses utility scoring.** Each villager picks the most useful job (gather what's short, repair, rest at
  night) and walks there. It's cheap and readable, and you can watch it work.
- The settlement feeds the adventure:
  - forge → gear
  - library → moves
  - market → items
  - trade port → new routes
  - stable → mounts (v2 Phase 5)

## 7. Riddles and puzzles
- A riddle bank in `lore/riddles/*.md`, with accepted answers and fuzzy matching.
- Logic puzzles for Rift dungeons: lights-out runes, ordering stones, sliding blocks. Each puzzle is generated from a
  seed and checked to be solvable.
- Hints come from the Guide after a while, so nobody gets stuck.

## 8. Game AI summary (no language model needed)
| System | Technique |
|---|---|
| NPC daily life | schedules by time of day + wander |
| Villagers | utility AI (needs → job) |
| Bosses | small behaviour trees per boss |
| Event pacing | director (player state → next event) |
| Quests and lands | template + seed generation from lore files |
| Dialogue | lore-file lines with `{placeholders}`, picked by situation |

**Living World (WebLLM, opt-in in settings):**
- the storyteller rephrases lines in the land's voice
- NPCs can answer free-text questions, kept to lore canon
- procedural quests get a richer story

Progress never depends on it. The first run asks before the download.

## 9. Making it a "legit" game: the first release scope
Target a vertical slice that a stranger can finish:
- 3 campaign chapters (about 60–90 min)
- 3 lands, 12 Sprites, 4 bosses, 2 gyms
- settlements up to the Castle Age
- 10 procedural quest templates, 30 riddles, 3 puzzle types
- Polish:
  - onboarding in chapter 1 (one mechanic at a time)
  - autosave
  - touch-first controls
  - sound and music (exists)
  - a settings page
  - chapter-end cards. There is no final ending; the Chronicle continues (§3b).

## 10. Build order
Do **Phase A (lore foundation)** from `PLAN-settlements.md` first: Adventure needs every line in lore files. Then:
1. Mode select + browser-only Adventure save (extends `net.js` `Saves`).
2. Scene scripting runner + chapter 1 in lore files (no battles yet: talk, choose, give, unlock).
3. Battles + 4 Sprites + the first boss. Chapter 1 complete.
4. Settlement simulation (economy tick, buildings, utility-AI villagers) + offline progress.
5. Procedural quests + director.
6. Chapters 2–3, gyms, riddles and puzzles, 12 Sprites, plus the Chronicle with 4 arc templates (§3b). First release.
7. Living World (WebLLM opt-in). Campaign tab in the Studio.

## Verification
- A fresh browser on the GitHub Pages URL can play chapter 1 to the end with no Mac, no Claude Code and no model download.
- Same on an Android phone with touch only.
- Behaviour checks:
  - Offline progress: close for 2h, reopen, and the "while you were away" card shows capped gains.
  - Seeds: the same seed gives the same procedural land and quests; a puzzle generator check proves solvability.
  - A lore pack that changes chapter 1's dialogue changes the game, and a pack with code-like content is rejected.
  - The Claude-mode save still loads and plays unchanged.
