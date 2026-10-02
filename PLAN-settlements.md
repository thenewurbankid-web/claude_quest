# Quest, Phase 6 plan: Settlements (Age of Empires + tycoon layer)

**Names (user, 2026-10-02):** in game (title screen, page titles, dialogue, Studio, `/settings`) the game is called
**Quest**, and the marketplace is **Quest Marketplace**. On GitHub and in code it stays `claude-quest` for now:
- the repo `thenewurbankid-web/claude_quest`
- the package name, the IndexedDB name, the save kind `claude-quest-save` (so existing saves keep working without a migration)
- the Paperclip company
- new GitHub repos follow the same prefix: `claude-quest-marketplace`, the player's `claude-quest-saves`

The display name lives in `lore/world.md` (§12), so it can be changed there later without touching code.

**Phases (each ships on its own, in this order):**
| Phase | Sections | Ships |
|---|---|---|
| A. Lore foundation | §12, §8 (files part), §11 | story in `lore/`, lore loader, WebLLM storyteller with Ollama/Off fallback |
| B. Studio and saves | §13, §14 | `/studio`: lore editors, asset download/replace, save slots, file manager |
| C. Settlements | §0, §0b, §1–§7, §9 | project kinds, economy and ledger, buildings, villagers, ages, tech, trade, all working without Paperclip |
| D. GitHub | §17, §15, §16 | private cloud saves, Quest Marketplace packs, shared/public quest boards |
| E. Android | §10 | phone layout, PWA, push, phone setup README |
| F. Multiplayer | §18 | invites, WebRTC sync of shared lands, presence, co-op quests |

**Multiplayer (user, 2026-10-02):** invite-only, over WebRTC (§18), for people working on the same project. **Not through
git or GitHub.** GitHub stays only for the marketplace, quest boards and private cloud saves.
Sharing happens only through marketplace packs (§15) and quest boards (§16).

**Builds on uncommitted work (found 2026-10-02, not yet committed):** `public/net.js` already has three modes:
- local (`app.js`)
- linked (hosted page, e.g. GitHub Pages via `scripts/build-pages.sh`, with an E2E-encrypted MQTT link from `lib/link.js`)
- browser (IndexedDB save, export/import, checkpoints, queued actions)

`public/touch.js` has phone controls. So:
- §10 part 1 extends linked mode.
- §14 Saves extends `Saves` in `net.js` rather than adding a second save system. Server slots in `data/saves/` and
  browser saves should share one `.cqsave` format, which `Saves.bundle()` already starts.
- "Browser only" (§9) is the existing browser mode.

Commit that work before starting here.

Status: **plan only, not started.** The user approved it on 2026-10-02. It comes after the hosted game (HANDOFF "Next up" #1),
whose work is still uncommitted. Don't start building until the hosted-link work lands, because both touch `public/world.js`
and `app.js`.

## Decisions the user made
- **Layer on top.** The Pokémon overworld stays the way you play: you walk, talk and answer. Each charted land also becomes
  a settlement with an economy, buildings, ages and a ledger. Battles, Sprites and gyms (Phase 4) stay in the backlog.
- **Outcomes earn gold, activity costs gold.** Income comes from closed issues, green checks, releases and answered
  questions. Token spend and agent runs are upkeep. The game must never reward burning tokens.
- All existing hard rules still hold:
  - No Claude tokens for game logic. Ollama qwen3:4b does names and narration.
  - No auto-answering.
  - Fantasy lore, with the real data as grey subtext.
  - Never reset `data/`.

## 0. Token rule: the game itself costs 0 Claude tokens (user, 2026-10-02)
- Everything in this phase runs on facts the game already has: file scans, git, transcripts on disk, Paperclip's local API
  (issues, runs, cost events) and Ollama. Nothing here calls `claude`, Paperclip `wakeup`, or the Anthropic API.
- Tokens are spent only by **work the player asks for**. Each of these already asks before it runs:
  - answer delivery to a resting session (`app.js` `claude -p --resume`)
  - Guild quests (`createIssue`)
  - send word (`wakeup`)
  - tech "research" in §5 is a Guild quest, so it asks too.
- Show it in the game: the Steward's ledger has a line `"Spent on the game itself: 0"` with subtext
  `Claude tokens used by Quest: 0`. Work spend is listed separately as upkeep for each quest.
- Enforce it in code:
  - `lib/kind.js` and `lib/economy.js` may not require `child_process`, `lib/paperclip.js` write functions, or any HTTP client except Ollama and Paperclip GET.
  - A check script `scripts/zero-tokens.js` greps for this and fails if it finds any.
  - On the test server (`CQ_NO_WAKE=1`), an hour of scans must log zero wakes.

## 0b. Real stats → game stats (one table, the single source of truth)
| Real stat (source) | Game stat | Where it shows |
|---|---|---|
| Issues done (Paperclip) | Buildings completed, + primary resource | skyline, resource bar |
| Issues open / in progress | Construction sites + scaffolding % | town plots |
| Check pass/fail streak (`collect.js` checks) | Iron, + barracks morale | resource bar, Steward |
| Answered questions (inbox) | Gold + Renown | resource bar |
| Releases/tags, merged branches | Caravan payout (big gold) | courier event |
| Token/run cost (Paperclip cost/finance) | Upkeep (− gold) | Steward ledger |
| Monthly budget headroom | Granary / population cap | resource bar |
| Concurrent live runs | Villagers at work | town |
| Tests, CI, lint, HANDOFF present | Techs researched | tech tree |
| Milestones (§4) | Age | town tileset, banner |
| Goal progress (Paperclip goal) | Wonder % | town center |
| Open bosses > 24h | Morale (−) | Steward |
| Commits / lines changed | **Flavour only** (villager bustle), never gold | town animation |

Rule: gold only moves on outcomes (rows 1–5) and upkeep (row 6). Activity (the last row) animates the town but never pays.

## 1. Project type → settlement kind (`lib/kind.js`, new)
Score each land from cheap file signals, scanning the root plus `packages/*`, `apps/*` and `services/*` for monorepos.
The highest score is the primary kind and the runner-up is the secondary kind, which adds one district.

| Kind | Signals | Settlement | Primary resource | Signature building |
|---|---|---|---|---|
| artisan | react, next, vite, tailwind, `*.css`, storybook | Artisan City | Glass | Gallery |
| trade | express, fastify, fastapi, nest, prisma, openapi files | Trade Port | Gold | Exchange |
| mine | torch, pandas, numpy, comfy, notebooks, ETL/pipeline dirs | Mining Valley | Ore | Refinery |
| forge | bin/, commander, Dockerfile, terraform, CI-heavy | Forge Hold | Iron | Great Forge |
| theatre | media/film/render dirs, ffmpeg, blender | Theatre Quarter | Renown | Playhouse |
| festival | phaser, three, game assets | Festival Town | Joy | Arena |
| scriptorium | mostly `*.md`, docs sites | Scriptorium | Ink | Library |

- Ties and empty roots (seen in construct-final, slatehouse and zeus2point0) go to Ollama with the file list and README
  head, and it picks one kind. The result is cached in `data/world.json` on the area as `kind` and `kindSecondary`.
- **The player always wins:** the kind can be overridden in `/settings` and by the Cartographer when charting.
- Sample from today: claude-quest → festival. Project-Max, max-ai-ui and max-data-upload → artisan. ComfyUI → mine.
  webfilm-pipeline → theatre (from its dirs; its root shows only express). vision-architect-pipeline → artisan + trade.

## 2. Economy (`lib/economy.js`, new; pure functions over scan facts + Paperclip snapshot)
Every resource tick is derived from real state and kept in `data/economy.json` (append-only ledger, one row per event,
deduped by source id so rescans never double-count).

| Ledger row | Real source | Effect |
|---|---|---|
| Income | Paperclip issue → done | + the primary resource for its kind, plus gold |
| Income | check that went from failing to passing (`failStreak` reset) | + iron (any land) |
| Income | answered question (inbox delivery) | + gold, + renown |
| Income | release/tag or merged branch | big gold payout ("caravan returns") |
| Upkeep | Paperclip cost events / run spend (`paperclipai cost`, `finance`) | − gold |
| Upkeep | boss alive > 24h | − morale |

- **Treasury:** the company's `budgetMonthlyCents` is the gold reserve. If it's 0 (unlimited), show reserve as "∞" and
  track only net flow.
- **Population cap:** set from budget headroom. It shows how many villagers (agents) the land can sustain at once.
  Going over doesn't block anything. It only shows a "the granary runs thin" warning. It's a brake you can see, never a hard stop.
- **No auto-spending:** every action that spends tokens still asks first, as the Guild Hall does today.

## 3. Villagers and buildings (`public/world.js`, `public/art.js`)
- **Villagers:** a Claude walks to the building that matches its current tool activity, from `collect.js` tool hits:
  - edits UI files → workshop
  - runs tests → barracks/training yard
  - edits docs → library
  - git/CI → forge
  - idle → town square

  This also solves the old Phase 3 "spread Claudes out" item.
- **Construction sites:** each open Paperclip issue in the land is a plot with scaffolding. Progress comes from status:
  todo → in_progress → in_review → done. When an issue is done, the building completes with the existing `celebrate()`.
  Done buildings stay as the land's skyline, capped at about 12, with the oldest becoming houses.
- Building art comes from the land's kind, so each kind looks different. Generate it procedurally in `art.js` like the
  current tiles, without AI image generation.

## 4. Ages (progression)
| Age | Reached when (real milestones, detected in scan) |
|---|---|
| Dark Age | land charted |
| Feudal Age | tests exist **and** at least one passing check recorded |
| Castle Age | CI workflow present and last run green, or 10 issues done |
| Imperial Age | a release/tag, or a Paperclip goal marked achieved |

- Advancing an age is a big moment: a fanfare, the Warden Ash speech, and the town tileset upgrades.
- The **Wonder** is the land's Paperclip goal. Its progress is the share of the goal's issues that are done.

## 5. Tech tree (research = real practices)
Each tech is a check on the repo, plus a small in-game bonus:
- Linting → +10% iron
- Tests → enables the Feudal Age
- HANDOFF.md → villagers move faster (pure flavour)
- Typed API → caravans carry more
- `.claude/launch.json` → a waystone appears

"Research" means the player posts a Guild quest to adopt the practice. It's a normal Paperclip issue and asks before spending.
The tech completes only when the repo check passes. The game never fakes it.

## 6. Trade between lands
- Lands that share dependencies or import each other's packages (`collect.js` can read package.json/pyproject) get a
  caravan route on the existing roads, drawn with the Phase 5 "road life" carts.
- Caravans carry each land's primary resource. Lumi's courier events can announce "the Glass caravan from Max Front
  arrives" when a cross-repo issue closes.

## 7. Steward and ledger UI
- **Steward NPC** in each town hall: income, upkeep and net for today and this week, with the top earning and costing items.
  The real numbers are subtext, e.g. `"The coffers swell by 40 gold"` / `LIN-152 done · $1.20 spent`.
- **Resource bar** (top left, hidden on title screen): gold, the land's primary resource, population x/cap, current age.
- **`/settings` → Economy:** kind override per land, show/hide resource bar, and how the weekly report is sent (in game only).

## 8. Customization: in game, in settings, and in lore files (user, 2026-10-02)
**Two stores, split by what they hold (user, 2026-10-02):**
- **Lore files = lore and settings.** Names, kind, resource names, building styles, tone, gold rules. A person writes
  these, and the game and `/settings` edit the same files, so they never disagree.
  Order: player-written value → detected/Ollama value → built-in default.
- **Save file = state.** `data/world.json` (charted lands, age reached, techs done, completed buildings, the cached
  detected kind) and `data/economy.json` (the ledger, treasury, the last values of derived stats). Only the game writes
  these; nobody hand-edits them. State never goes into a lore file, and lore never goes into the save file.

**Lore files** (plain markdown with YAML frontmatter, hand-editable, git-ignored like `config.json`):
- `areas/<id>.md` already exists, and the storyteller reads its body. Add frontmatter:
  ```yaml
  kind: artisan            # override detection
  kindSecondary: trade
  name: Glasshaven         # town name (HANDOFF #2 editable names)
  resource: { primary: Glass, gold: Crowns }
  buildings: { signature: The Prism Hall, workshop: Lensworks }
  villagers: { claude-abc123: Brother Tamsin }   # stable per session id
  gold: { rules: outcomes }  # setting, not state
  ```
  The age, ledger and built skyline aren't here. They're state, kept in the save file.
  The body stays free text: tone, history and rules for the storyteller.
- `lore/world.md` (new): global lore the storyteller always reads, covering the realm's history, the factions per kind, and words
  to use or avoid.
- `lore/kinds/<kind>.md` (new, optional): renames a whole kind for every land, e.g. call all trade ports "Free Cities".
- Files are re-read on each scan. A malformed file shows a Steward line ("the scrolls are smudged") with the parse error
  as subtext, and keeps the last good values.

**In game:**
- *Town Architect* NPC in each town hall: rename the town, a building or a villager; change the kind; pick a building style.
  Each choice is written into `areas/<id>.md`.
- *Steward:* rename resources, hide or show the resource bar, choose what the weekly report covers.
- *Lore Keeper* in the hub opens a free-text box ("tell me about this realm") that appends to `lore/world.md`.
- Interacting with any named thing (a villager, building or caravan) gives a "Rename" option.
- All of this is text and menu edits. It uses no tokens; the storyteller is Ollama.

**`/settings` (Map Room):**
- A new Economy tab: kind override, resource names, and gold rules per land.
- A lore editor for `lore/world.md` and `lore/kinds/*.md` next to the existing `areas/<id>.md` editor.

**Limits the player can't customize away:**
- The zero-token rule (§0).
- Answers always go to Claude as the original option text.
- `data/` is never reset.

The gold rules *are* customizable, since it's the player's economy. The default stays outcomes-only, and the
Economy tab shows a one-line note if a rule pays for activity.

Note: this overlaps with HANDOFF #2 (editable names + project-aware lore). Build them as one piece of work: this section
uses the same files and the same cache in `data/lore-cache.json`.

## 9. Paperclip is optional (user, 2026-10-02)
Settlements must work fully with Paperclip off. Paperclip only adds things when it's running.

| Stat | Without Paperclip (always on) | With Paperclip (extra) |
|---|---|---|
| Construction sites / buildings | the player's own quests, kept in the save file (`data/quests.json`) and posted from the Guild Hall; done when the player marks them or a linked branch merges | Paperclip issues and their status |
| Upkeep (token cost) | `usage` fields in transcript JSONL under `~/.claude/projects` (input/output/cache tokens × price table in `config.json`) | Paperclip cost/finance events |
| Treasury / population cap | a monthly token budget set in `/settings` | company `budgetMonthlyCents` |
| Villagers at work | live transcripts (already in `collect.js`) | + Paperclip live runs |
| Wonder | a goal written in `areas/<id>.md` with a checklist | Paperclip goal |
| Releases, checks, techs, ages | git, files, transcripts | same |

- The ledger dedupes by source id, so a quest isn't counted twice when Paperclip comes back up and mirrors it.
- With Paperclip off, the Guild Hall shows "the Guild is away". Agent control is hidden; everything else plays.

## 10. Android (user, 2026-10-02)
Three parts. Parts 1 and 2 build on HANDOFF #1 (hosted game, outgoing-only link) and can't ship before it.
1. **Play on the phone.** The hosted page in Android Chrome:
   - layout fits the screen at phone width
   - `public/touch.js` d-pad and A/B buttons
   - tap to choose dialog options
   - the resource bar collapses to one row

   Answers and quests go through the encrypted link as already designed. No incoming connections to the Mac.
2. **Installable app (PWA):**
   - `manifest.webmanifest` and icons
   - a service worker that caches the app shell, so it starts offline and shows the last world snapshot
   - full screen and portrait/landscape
   - Web Push notifications when a boss, question or courier appears

   Open question for the user: push needs a push service and keys. Can the host from HANDOFF #1 send it, or is the
   notification shown only while the page is open?
3. **Control Claude from the phone.** This is setup on the Claude side, not game code:
   - Claude Code Remote Control
   - the Claude app reaching sessions directly

   Add a short "Phone setup" section to the README with steps, and have the game deep-link to the session from a
   Claude NPC's menu ("Speak to this Claude directly"), with the session id as subtext. The game never relays tokens
   for this.

## 11. WebLLM is the default storyteller (user, 2026-10-02)
Replaces "Ollama by default". The storyteller runs in the browser with WebLLM (`@mlc-ai/web-llm`, WebGPU), so names,
lore lines and dilemmas need no local Ollama and work on the phone too. It still uses 0 Claude tokens.
- **Engines, chosen in `/settings` → Storyteller:**
  - WebLLM (default)
  - Ollama (local, as today)
  - Off: built-in fallback names and lines from `lib/lore.js`, with no model at all
- **Model:** a Qwen3 build from WebLLM's prebuilt list, to match today's prompts. Start with the 1.7B q4 model on phones
  and the 4B model on desktop. The player can pick in settings. The first run downloads it once (about 1–2.5 GB), and it's
  cached in the browser after that. Ask before downloading, and show size and progress as an in-game "the Lore Keeper
  is learning the old tongue" line.
- **Where it runs:** today `lib/story.js` calls Ollama from the Node server. Split it:
  - the server builds the prompt and facts as it does now and sends them to the page as a "lore job"
  - the page runs WebLLM in a Web Worker and posts the result back
  - the result is cached by id in `data/lore-cache.json`, as now

  When no page is open, jobs wait and the fallback names show meanwhile. The hosted/phone page (§10) runs jobs the same way.
- **No WebGPU** (older Android, some browsers): fall back to Ollama if it's reachable, otherwise to Off. Say so once in
  game, with the reason as subtext.
- The schema-constrained JSON output in `story.js` maps to WebLLM's `response_format: json_schema`. Check that the
  chosen Qwen3 build supports it before choosing; if not, validate and retry once, then fall back.

## 12. All story comes from lore files (user, 2026-10-02)
Code holds mechanics only. Every name, line, dialogue and rule of the world lives in lore files. The storyteller
(WebLLM/Ollama) reads them as canon and only fills gaps or adapts lines to the current facts. With the storyteller set to
Off, the game plays entirely from lore files.

**Layout (`lore/`, markdown + frontmatter, hand-editable):**
| File | Holds | Moves out of |
|---|---|---|
| `lore/world.md` | realm history, tone, words to use/avoid, the Ember Well, the Long Night, Waystones, Rifts | scattered strings in `public/world.js`, `app.js` |
| `lore/storyteller.md` | the narrator's system prompt and rules | `SYSTEM` in `lib/story.js` |
| `lore/characters/*.md` | Warden Ash, Lumi, Clerk, Cartographer, Steward, Architect, Lore Keeper: name, look, voice, dialogue lines by situation | about 71 `UI.say` calls in `public/world.js` |
| `lore/bosses/*.md` | Waiting Sphinx, Red Golem, Ouroboros Wyrm, Stalling Fog: name, lore, battle lines, fallback steps | `BOSS`, `fallbackSteps` in `lib/lore.js` |
| `lore/kinds/*.md` | each settlement kind: name, resources, buildings, villager jobs, age names, age-up speeches | §1–§4 tables |
| `lore/events/*.md` | courier, caravan, age-up, wonder, night fall/dawn, reward cards | `celebrate()` and event text |
| `lore/intro.md` | title screen, New Game intro script | `titleScreen`, `intro` in `public/world.js` |
| `areas/<id>.md` | per-land overrides (§8) | – |

- **Line format:** each situation has a list of lines with `{placeholders}` filled from real facts, e.g. a Red Golem
  `taunt` line is `"The {boss} grows stronger: {streak} failed trials!"`. One is picked at random, the storyteller may
  adapt it, and the real fact is always shown as subtext.
- **Override order:** `areas/<id>.md` → `lore/kinds/<kind>.md` → `lore/*` defaults shipped in the repo.
- **Shipped defaults:** the repo ships `lore/` with today's text moved over unchanged, so the game reads the same as now.
  The player's edits are what change it. Decide with the user whether the player's `lore/` is committed or git-ignored
  (the shipped defaults could live in `lore/default/`, with player edits in `lore/` on top).
- **Mechanics stay in code:** what triggers a boss, what earns gold, ages, the zero-token rule. Lore files can rename and
  re-voice any of it, but can't change game rules. The gold rules in §8 are a setting in a lore file, but they're checked
  against the allowed list.
- **Loading:** the server reads `lore/` on each scan and sends a merged lore bundle to the page. A malformed file is
  reported by the Lore Keeper, and the last good copy is used.
- **Check:** `scripts/no-hardcoded-story.js` fails if `public/*.js` or `lib/*.js` contain dialogue string literals outside
  a small allowlist (UI labels like "Back", "Send").

## 13. Lore Studio page: one place for all of it (user, 2026-10-02)
`/studio` (`public/studio.html`, same local server, works on the phone link too). It is where the player customizes
the world. `/settings` (Map Room) keeps only system settings, meaning the parts that aren't lore or art:
- sound, music, minimap
- storyteller engine and model (§11)
- Paperclip status
- token budget

This replaces the §8/§12 idea of a lore editor inside `/settings`. In-game NPCs (Architect, Steward, Lore Keeper) stay
as quick edits and offer "Open the Lore Studio" for the rest.

**Tabs:**
1. **World:** edit `lore/world.md`, `lore/intro.md`, `lore/storyteller.md`. A markdown editor with a frontmatter form and a
   live preview of how a line renders in the dialog box, with its subtext.
2. **Lands:**
   - one card per charted land: name, colour, kind override (§1), resource and building names, villager names
   - the gold rules setting (§8, checked against the allowed list)
   - Wonder checklist (§9)
   - writes `areas/<id>.md`
3. **Characters / Bosses / Events / Kinds:**
   - a list of every lore file in that folder, with situation → lines editing (add, remove, reorder)
   - placeholder chips you click to insert (`{boss}`, `{streak}`…), with unknown placeholders flagged
   - "Reset to default" per file, from `lore/default/`
4. **Assets:** the asset sheets section below.
5. **Preview:** pick a situation, such as "Red Golem appears in Glasshaven", and see it rendered with the current lore and
   assets, using real or sample facts. It costs no tokens. If the storyteller is on, it also shows the adapted line.

**Saving:** each edit writes the file right away. A per-file history is kept in `data/studio-history/` so you can undo.
That's state, so it goes in the save folder (§8). Malformed input is caught in the form before writing.

### Asset sheets: download and replace, as a sheet or one asset at a time
All art is drawn in code (`public/art.js`) and registered under a texture key (`tiles`, `center`, `house-<id>`,
`tent-<id>`, character sheets, kind buildings from §3). Overrides hook in at that registration point.
- **Asset registry (`public/assets.js`, new):** a list of every key with its size, frame grid (e.g. 12 frames of
  16×16 for a character), category (tiles, characters, buildings, effects, UI) and the `art.js` function that draws it.
  `world.js` asks the registry for each texture instead of calling `Art` directly.
- **Download:**
  - *one asset*: a PNG of that key
  - *a sheet per category*: one PNG atlas plus a JSON frame map, in TexturePacker/Phaser format so common tools can open it
  - *everything*: a zip of all sheets, plus `assets.json` with the palette and sizes as a guide for artists
- **Replace:**
  - drop or upload a PNG on a single asset, or on a whole sheet. A sheet is split by its JSON map, or by the default grid.
  - checked first: the size must match, or you're asked whether to scale it with nearest-neighbour. Frame count must match.
  - before anything is saved, a preview shows the asset in place: an animated character walk cycle, or a tile in a sample field.
  - stored in `assets/custom/<key>.png`. That's player content, kept with lore and git-ignored like `lore/`.
- **Mixing:** any key without an override keeps its procedural art, so you can replace one house and keep the rest.
  - "Revert" per asset or per sheet.
  - per-kind building art (§3) can be overridden for one land or for a whole kind.
- **No AI image generation.** This matches the user's media preference. Art is yours or procedural.
- Loading: the server serves `assets/custom/` and the page swaps the texture on the next scene load. In the Studio, the
  preview updates live.

## 14. Studio: managing save files and lore files (user, 2026-10-02)
New Studio tabs **Saves** and **Files**.

**Split `data/` first.** Today it holds two kinds of thing:
- *Game state* (swappable):
  - `world.json` for areas, age, techs and buildings
  - `economy.json`, `quests.json`, `lore-cache.json`, the client position, the attuned stones
- *Work records* (never swapped, never reset):
  - `inbox.json`, the player's real answers to Claude
  - `events.json`, `runs/`, `control.json`

Saves cover only game state. Loading or importing a save never touches work records. This keeps the HANDOFF rule
"Don't clear `data/`" true.

**Saves tab:**
- *Slots:* named save slots under `data/saves/<slot>/`. Each one shows when it was last played, the lands, their ages and gold.
  "Continue" on the title screen uses the active slot.
- *Backup:* automatic before every load, import, New Game and reset, and daily. The last 10 are kept.
- *Restore* from any backup.
- *Export* a slot as a `.cqsave` zip (game state only), so you can move it to another machine.
  The export lists what's inside (land names and repo paths) and leaves out work records.
- *Import* a `.cqsave` into a new slot. It never overwrites an existing slot. Lands whose repo path doesn't exist here are
  marked "uncharted" until you repoint them.
- *Duplicate*, *rename*, *delete a slot*. Delete asks to confirm, makes a backup first, and can't delete the last slot.

**Files tab (lore files):**
- a tree of `lore/`, `areas/` and `assets/custom/`, with badges for edited, default and from a pack
- open in the matching Studio editor, compare with the default, revert
- import a file or folder, export a selection as a lore pack (§15)
- validation status per file

## 15. Quest Marketplace: a GitHub repo where players share lore packs (user, 2026-10-02)
**Not created yet.** Creating a public GitHub repo is a publishing action, so the user confirmed `thenewurbankid-web/claude-quest-marketplace` (2026-10-02). Still open: the licence for shared lore and
art. Creating the repo still asks first.

**Pack format** (data only, no code ever):
```
packs/<pack-id>/
  pack.json      # id, name, author, version, game version range, licence, kinds/characters it touches, preview image
  lore/...       # same layout as §12; only files that change something
  assets/...     # PNG + JSON frame maps from §13
  README.md
```
- `index.json` at the repo root lists every pack, so the Studio can browse it with one fetch. A CI action in the
  marketplace repo rebuilds the index and validates each PR:
  - schema
  - placeholders
  - PNG sizes
  - no files other than `.md`, `.json` and `.png`
  - size limit

**In the Studio (Quest Marketplace tab):**
- *Browse:* fetch `index.json` and pack previews from GitHub (outgoing read only, works without login).
- *Install:* download into `lore/packs/<id>/`. Packs sit between the shipped defaults and your own edits, so
  `areas/<id>.md` → your `lore/` → enabled packs (in the order you set) → `lore/default/`. Enable, disable, reorder,
  update and uninstall. Installing never overwrites your own files.
- *Share:* export a pack from the Files tab, then "Publish to marketplace". This opens a PR through the user's `gh` CLI after
  showing exactly which files go out. Asks every time.

**Safety rules (packs come from strangers):**
- **No code:** packs can't contain JS, HTML or anything other than markdown, JSON and PNG. Templates only fill
  `{placeholders}`, and there's no expression evaluation.
- **The storyteller rules stay fixed.** A pack can change the narrator's voice and tone, but `lore/storyteller.md` keeps
  a locked rules block (stay truthful to the facts, never answer for the player, real data stays as subtext) that packs
  can't override. Pack text goes to the model as quoted lore, not as instructions.
- **No private data on export.** Pack export leaves out by default:
  - `areas/<id>.md`, because it names your repos and keys villagers by session id
  - any save file
  - anything in `data/`

  The export preview flags repo paths, emails and session ids found in the files.
- Installed packs show their author and source link in the Studio, and the game never fetches a pack on its own.

## 16. Shared and public quests through GitHub (user, 2026-10-02)
A **quest board** is any GitHub repo whose issues carry the `quest` label:
- a team's private repo (shared quests)
- a public repo (public quests)
- the Quest Marketplace repo's own board for community quests

GitHub issues are the quest storage, so this works without Paperclip.
- **Boards:** in the Studio (Quest Marketplace → Boards) you add boards by `owner/repo`. Each one appears in game as a
  notice board in the hub, with subtext `owner/repo · 12 open quests`. All reads go out through the `gh` CLI or the GitHub API from the Mac
  (outgoing only), or straight from the browser for public boards.
- **Quest issue format:**
  - Template `.github/ISSUE_TEMPLATE/quest.yml` in the board repo: title, story line (lore), target repo, what "done"
    means, reward tier, difficulty, settlement kind.
  - Labels: `quest`, `kind:<kind>`, `tier:<n>`.
  - The marketplace repo ships the template, and any repo can copy it.
- **Create a quest** (in game at a notice board, or in the Studio):
  - write the lore line and the real task, pick a board
  - the game shows the exact issue it will post, and you confirm
  - it posts through `gh issue create`
  - private-repo names and paths are flagged before posting to a public board
- **Take a quest:**
  - accepting one is a choice you make. It never happens automatically.
  - "Take" links the quest to a local land, charting the target repo if needed, and adds a construction site (§3)
  - a comment "Taken by <player>" is posted only if you choose to
- **Complete:** the quest completes when its issue closes as completed, or a linked PR merges. Rewards follow the
  outcome rule (§0b), with bonus Renown for public quests.
- **Safety, because public quest text is written by strangers:**
  - Quest text is data. It's shown to you, never fed to Claude as instructions automatically.
  - Sending Claude to work on a quest is a separate Guild action that asks first. It hands Claude the quest body as quoted
    text ("the quest says: …") with a note that the content is untrusted.
  - The storyteller only turns quest text into lore. It never acts on it.
  - The zero-token rule (§0) holds: browsing, posting and tracking quests cost 0 Claude tokens.
- **Without GitHub login:** you can browse public boards read-only. Creating, taking and commenting need `gh auth`.

## 17. GitHub as cloud saving (user, 2026-10-02)
A **private** GitHub repo per player, e.g. `<user>/claude-quest-saves`, created only after the player confirms. It stores:
- `saves/<slot>.cqsave`, unzipped as JSON so git shows diffs. The same format as §14 and `Saves.bundle()`.
- `lore/`, `areas/` and `assets/custom/`, so your world follows you to another machine or the phone.
- `backups/`: git history is the backup. Restore any earlier save from a commit list in the Saves tab.

**What it is and isn't:**
- It's for saves. Live play still uses local or linked mode (`net.js`), because GitHub isn't real-time.
- It holds game state and lore only, never work records (`inbox.json`, `events.json`, `runs/`), transcripts or Claude
  output. The first sync shows exactly what goes up, including land names and repo paths. That's why the repo is private.

**Sync:**
- **When:** on save, on quit, and every N minutes if changed (setting). Pull on Continue.
- **How on the Mac:** `gh` / git over HTTPS, outgoing only.
- **How on a phone or hosted page:** the GitHub API with a fine-grained token limited to that one repo (contents read/write).
  The player creates the token on GitHub themselves and pastes it into the Studio. It's stored only in that browser and
  never in a save, a lore file or a pack.
- **Conflicts:** if two devices saved since the last sync, the game never merges silently. The Saves tab shows both (time,
  device, lands, ages) and you choose: keep one, or keep both as separate slots.

**Without GitHub:** local slots and file export/import (§14) work as before. Cloud saving is an add-on.
Zero-token rule (§0) holds.

Note: this repo is the player's own private save. It's separate from the public Quest Marketplace (§15) and from quest
boards (§16). The Studio shows the three side by side so it's clear which one is private.

## 18. Multiplayer by invite over WebRTC (user, 2026-10-02)
Goal: several people working on the same project share one land in the game, and the game keeps it in sync.
Code still syncs through each person's normal git workflow. Quest syncs only the *game* layer.

**Invite and connect:**
- The land's owner opens Studio → Lands → "Invite" and gets an invite link or QR code. It holds a room id, a one-time
  key and the land id, in the URL fragment so it never reaches a server.
- **Signaling by QR handoff, with no server (user, 2026-10-02):**
  - The host's invite QR or link carries the WebRTC offer (compressed SDP) in the URL fragment.
  - The joiner's page shows an answer QR or code, and the host scans or pastes it.
  - Once two peers are connected, the room's own data channels carry signaling for the next joiner, so later joiners need
    one invite from any member.
- **NAT:** public STUN only. No TURN.
- **Fallback transport when WebRTC fails** (no direct path within about 10 s):
  - route the same encrypted messages through the existing outgoing-only MQTT link (`lib/link.js`, `public/linkcrypto.js`)
  - the broker sees only ciphertext, and nobody gets an incoming connection
  - the in-game status shows "connected through the relay", and presence updates drop to about 4 per second

  Direct peer-to-peer HTTP polling is impossible here: it would need an incoming connection to someone's Mac.
  Alternatives the user can choose later:
  - a small self-deployed HTTP mailbox (e.g. Cloudflare Worker + KV, polled every 1–2 s)
  - a GitHub gist (10–30 s, quests and ledger only; but it brings git back into multiplayer, which the user ruled out)
- **Player-controlled, in `/settings` → Multiplayer (user, 2026-10-02):**
  - *Connection:* Auto (direct, then relay; default) / Direct only (fail rather than relay) / Relay only.
  - *Relay:*
    - the MQTT broker URL, defaulting to the one `lib/link.js` uses
    - or an HTTP mailbox URL, if the player deploys one
    - or None, which means no fallback at all
  - *Polling interval* for an HTTP mailbox: 1 s–60 s, default 2 s. MQTT pushes, so this only applies to HTTP.
  - *Presence rate:* direct 10/s, relay 4/s, both adjustable. "Low data" mode sends quests and ledger only, with no
    avatars.
  - *Fallback after:* 5–30 s, default 10 s.
  - *STUN server:* default public, can be changed or turned off. Off means same-LAN only, with zero third-party contact.
  - The current transport, round-trip time and messages per minute are shown live, so it's clear what the setting does.
  - Per-device settings (stored locally, not in the shared land), so each player picks what suits their network.
- **Same sync on both paths:** Yjs updates, presence and chat use one message format. Only the transport changes, and it
  can switch mid-session. If WebRTC works again, the game moves back to the direct connection.
- The owner approves each joiner by name the first time. They can kick a member or revoke the invite, which rotates the key.
- Roles per land: owner, member (can post quests, edit the land's lore), visitor (read-only).

**What syncs (per shared land):**
- **The shared land's game state:**
  - quests and construction sites
  - the economy ledger
  - age, techs and buildings
  - the land's lore file (`areas/<id>.md`), custom assets for that land, and the Wonder checklist
- **Presence:** each player's avatar position and facing, plus short chat bubbles. Positions are sent about 10 times a
  second over an unreliable data channel and smoothed on the other side.
- **Each player's Claudes appear as villagers** in the shared town, labelled with their owner. Every Mac collects only its
  own Claude facts and publishes a trimmed lore-level summary (state, building, lore line).

**How it stays in sync:**
- Shared state is a CRDT (Yjs document per land) carried over the WebRTC data channel, through a custom Yjs provider
  on our own signaling. That means concurrent edits merge, people can go offline and catch up, and nobody is a single
  point of failure.
- Each player keeps a local copy in their save slot (§14), so the land works solo and merges when peers reconnect.
- The ledger is append-only with ids per source, so the same issue closed on two machines is counted once.

**What never syncs, and the safety rules:**
- Never synced:
  - work records (`inbox.json`, runs)
  - transcripts and raw Claude output
  - Paperclip data
  - tokens and secrets
  - other lands
- Subtext (real data) is shared only if the owner turns on "share details" for that land. Otherwise peers see lore
  lines only.
- **No one can spend someone else's tokens.** A peer can post a quest on a shared land, but it only becomes Claude work
  on *your* machine if *you* take it and confirm. Peer quest text is treated as untrusted data (same rules as §16).
- Answers to *your* Claude's questions can only come from you. Peers see that a riddle exists, but can't answer it.
- The zero-token rule (§0) holds. WebRTC and Yjs cost nothing.

**Out of scope:** syncing through git or GitHub, public matchmaking, shared realms with strangers. Invites only.

## Build order (each one is a working slice)
0. Move today's story text into `lore/` (§12) with no visible change, plus the lore loader. Everything else builds on it.
0b. Lore Studio (§13): the World, Characters and Preview tabs first, then the asset registry plus download/replace
    (single asset first, then sheets and zip). Each later slice adds its own Studio tab (Lands with §1, Kinds with §3).
0c. Split `data/` into game state and work records, then the Saves and Files tabs (§14). Must land before anything can
    load or import a save.
0d. Pack format and the Marketplace tab, install side first, against a local folder (§15). Create the GitHub repo and the
    Share button only after the user approves the account, name and licence.
0d2. Cloud saving to a private GitHub repo (§17), right after local slots (0c): Mac sync through `gh` first, then the
     phone and hosted page with a repo-scoped token, then the conflict screen.
0e. Quest boards (§16): read-only browsing of a public board first, then take/complete, then create (posting asks each time).
1. `lib/kind.js` + the lore-file frontmatter reader (§8) + kind in the Cartographer and `/settings`, with override.
   No visuals yet. Also covers HANDOFF #2's file side.
2. `lib/economy.js` ledger + Steward dialogue + resource bar, using placeholder art.
3. Construction sites from issues + kind-specific building art.
4. Villager routing to buildings by activity.
5. Ages + tech tree checks.
6. Trade routes (depends on Phase 5 road life, or draws simple carts on its own).
8. Multiplayer (§18): QR handoff + WebRTC → MQTT fallback with transport switching → presence only → Yjs sync of one shared land →
   Claudes as villagers → roles, kick and revoke. Needs Phase B saves first.
7. Android: phone layout and PWA (after HANDOFF #1 lands), then push, then the phone setup README and deep links.

Every slice must pass with Paperclip off (§9) before its Paperclip extras are added.

## Verification
- Kind: run `kind.js` over every repo under ~/Repositories and check the table matches §1. Override in `/settings` and
  confirm it persists.
- Ledger: close a test issue on the `claude-quest-test` server (port 4778, `CQ_PAPERCLIP_URL` pointed at a stub) and see
  one income row. Rescan and confirm there's still exactly one.
- Upkeep: feed a cost event and see gold go down. Spending tokens must never increase gold.
- Visual: screenshots of each kind's town, a construction site at each status, the Steward panel, and an age-up.
