# Quest engine plan: a game that runs your agents' work

## Context
Quest turns agent work into a game, but today the game is a skin over a dashboard. The 2D game (Phaser,
`public/world.js`) has the systems (dialogue, quests, bosses, saves), while the 3D view (Three.js, `public/3d/`)
has the looks but no game data; the two share no code. The user (2026-10-03, dictated line by line) wants a
**customizable engine, driven by lore files**, where real project work becomes Zelda-balanced play: milestones
become dungeons you can only win once the work is done, blockers ambush you, backlogs become bosses, and the plot
writes itself from the tasks. It must be fun with no work running, and it must never put real work at risk.

This file is the agreed design plus the build order (approved 2026-10-03). It supersedes PLAN-adventure.md where they
disagree (gyms are Sealed Hall dungeons; "creature collecting is out" was reversed on 2026-10-03, see "Missions,
Keepers and the Bridge"). Build each milestone in its own session,
scoping it before building.

## Core gameplay
**Explore a world your agents are building: help them by answering their riddles, and conquer each finished
milestone's dungeon.**
- **Moment to moment (minutes):** walk a March, talk to people, follow Errand Trails, solve light puzzles, fight
  small foes, find trinkets. The Keepers work in the background.
- **Session (an hour):** Riddles arrive (real questions) and you answer them through NPCs; the work moves; the road
  writes itself out of the Haze; new paths and items open.
- **Milestone (days):** when a milestone's work is done its Sealed Hall opens: a dungeon, a Hall Warden, a Sigil, an
  Embertale.
- **Pressure (whenever it builds):** stuck work brings Tangler ambushes; a heavy backlog brings a Gloamwyrm that you
  beat by clearing it.
- **Weak spot to design for:** with no work running the map stops growing, so quiet-time play (puzzles, side
  errands, trinket hunting, practising) must carry on its own.

## Outcome
- **Winning (confirmed):** each project is its own campaign and its own win. When its last milestone ships and the
  final Sealed Hall falls, the player wins that campaign: an ending scene, credits, and the whole project's story
  told back as an Embertale. The March stays as a living, finished land with its Sigils. The Realm never ends; a new
  conversation starts the next campaign.
- **Tracking wins (user): badges plus a league.** Every Sigil (milestone) is a badge and every campaign win is a
  trophy, kept in a **Hall of Champions** at the Keeper's Lodge. Teams (projects/Marches) compete in a
  **Champions League** within the Realm: seasons (e.g. a quarter), a standings table by Sigils, campaign wins and
  Renown from outcomes, then a season final and a champion. Guard: standings use reviewed outcomes only, weighted by
  size, so the league can't be climbed with busywork. Cross-Realm leagues can come later with multiplayer.
  Sigils, trophies, league standings and season history live in the **save file** (state), not the lore files
  (lore and settings only).
- **Saves and the source** (user, 2026-10-03). **No encryption, no copy-on-load.** On every load the save is
  updated from the source if present (Paperclip reachable): live work state (tasks, milestones, questions,
  outcomes) replaces whatever the save had; play state (position, items, settings) comes from the save. With no
  source, it plays as saved. Play state is protected by atomic writes (temp file + rename), a checksum, the previous
  save kept as a fallback, and a schema version with migrations; a signature detects edits.
  **The save carries the full ledger** (user): every March, Hall, Work, Riddle, decision and mark, plus play state.
  So a save is a complete, portable backup: it restores a whole Local Ledger on any device, and with a live source it
  is refreshed from that source on load (the source wins for work state).
  **Split save** (user): a save is a bundle of parts, not one blob, so memory stays manageable:
  `manifest.json` (version, checksums, signature, part list), `play.json` (position, items, settings, Sigils,
  standings), one part per March (its Halls, Works, open Riddles, recent marks), and `archive/<season>.json` for
  resolved history. The game loads the manifest and play state, then only the March you're in; other Marches load on
  demand and archives only when opened. Packed as one file with the store-only zip writer the asset editor already
  has (`public/editor/zip.js`), so players still handle a single save. Parts make sharing easy too: **export without
  the ledger** is just the manifest and play state.
  **Archiving** (user): keeps the live parts small without losing anything.
  - *Live* holds every open item, anything an open item depends on, and items resolved in the current season.
  - *Archived* at each season end, or when a March part passes a size limit, or by hand ("archive now"): resolved
    Works and Riddles, closed Halls' details and their marks, compacted to a summary plus outcomes.
  - A *won campaign's* March moves to the archive whole; the map keeps it as a finished land from a small summary.
  - Archives are read-only and never deleted. Sigils, standings, Embertales and the Hall of Champions read from them,
    and they can always be recomputed. Sealed decisions keep their full audit text in the archive.
  - Season length and size limit live in the lore rules.
  **A save is optional:** with the save deleted, or on a new device, the player can connect to an existing project
  and the world rebuilds from the source (Marches, Halls, open questions, outcomes, and the Sigils and standings
  recomputed from outcomes). Only play state starts fresh. Built with saves in M8.
- **In real life:** projects ship with the human in the loop at the right moments. Agents spend less time blocked,
  questions get answered in batches instead of one ping at a time, nothing risky happens without a sealed decision,
  and the whole team sees one shared status.
- **How we'll know it works:** time from a question being raised to answered; share of agent time spent blocked;
  milestones shipped; token spend kept inside the budget; and whether players keep playing in quiet times (the
  north star: people "forget they are working").

## First run (user, 2026-10-03)
Title screen: **Start game → New Game or Load.**
- **New Game:** a short intro with Warden Ash at the edge of the Haze; "Where is your Realm written?" (start fresh
  in the browser's Local Ledger, the default, or Paperclip when it's running); the Cartographer founds the first
  March in a short chat (what you're working on, the first big goal), which creates the first project, Sealed Hall
  and a few Works; "Bring your Keeper home" connects Claude (copy and paste on the `/work` page, the one-click
  desktop extension, or Claude Code; skippable, planning-only without one); a tutorial Errand Trail whose Riddle is
  real (e.g. "who is this project for?") and teaches walking, talking, the Seal and the token readout; a quick tour
  (the Beacon, the log, the Recall Bell); then free play.
- **Load:** load the save file, then look for its source: the Paperclip it came from, or its Local Ledger in this
  browser. If found, the world is refreshed from it and Lumi opens with a recap ("While you were away: 3 Works
  done, 2 Riddles waiting"). If not found, offer to **start a new Local Ledger** (restored in full from the ledger
  inside the save) or **connect a Paperclip**; until then the save plays as saved.

## Design (all confirmed by the user)

**Structure, from Paperclip** (checked read-only against the live instance on 127.0.0.1:3100):
- Paperclip **company = world** (a Realm). **Project = team = region** (a March); projects run in parallel.
- **Milestone = Sealed Hall** (the gym), from the team-level goals that issues point at (`goalId`, e.g. MAX FE's
  Phase A–E with achieved / active / planned). One hall per milestone.
- **Tasks = issues**, done by agents (Keepers). Issues already carry `priority`, `status`, `blockerAttention`,
  `reviewAttention`, `unblockDescriptor`: the signals for ambushes and NPC quests.
- Projects can start from a conversation with an NPC or Keeper; the map unfogs to show the new March.

**Our own protocol.** The engine never talks to Paperclip directly. It speaks a Quest protocol (worlds, regions,
halls, tasks, agents, questions, decisions, budgets, events). Paperclip is the first adapter, a new `source` plugin
kind beside `provider`/`tool3d`/`tool2d` in `lib/plugins.js`; other adapters (e.g. Linear, Orbit) can follow.
- Every action and response carries a **mark**: status (sent → seen → working → answered → done / failed) and
  source (project, task, agent or player; real work or game-only).
- One **unified status** for all projects (the Beacon: gold / amber / red), rolled up from per-region status.
- **In-game log**: every open or ongoing interaction, plus the 5 most recently resolved.
- Every task and milestone has a **weight**: explicit if set, else derived (priority, how much it blocks,
  failures, age) ÷ size (S/M/L, WSJF). A milestone weighs its open tasks unless set.

**The loop.**
- Work runs automatically. Playing with no work earns no XP; talk to any NPC or summon a Keeper to start work
  (confirm first; show token use, even for free local models).
- A Sealed Hall is locked until its milestone is done, then won through play. If the milestone isn't done, it
  can't be won.
- Open questions come in batches as NPC quests, often as **Errand Trails** (the bike-voucher chain): each step
  answers a real question, and the gift at the end (a grapple, a lantern, a shortcut) opens new map.
- Blockers ambush (the Tanglers); planning and special attention come as NPC requests; other regions reach you by
  Speaking Stone calls or local NPCs. You set how often interruptions come; failures can't wait, questions can.
- When the weighted backlog score crosses a threshold, a **boss** (Gloamwyrm) cuts in: a full-screen 3D battle that
  pauses for each real question and lasts until all are resolved. Slow-motion tapping is an accent; mashing sets
  hit power, never an answer (input lock before any sealed choice). You can retreat; the boss returns stronger.
- **Renown** (XP) is team-wide, from reviewed outcomes only. Leading the work makes the game harder; getting
  ahead of the work makes it unbeatable until the work catches up, shown as the Haze over an unwritten road.
- Play rewards are trinkets, gear, cosmetics, mounts and shortcuts. ~~No creature collecting.~~ *Reversed
  (user, 2026-10-03):* Keepers are agents you summon with Ember and can release; no invented creatures or stats (see
  "Missions, Keepers and the Bridge").
- PM grounding (accepted): retrospectives (an Embertale after each Sigil), Fallen Bridges for cross-project
  dependencies, capacity as Keepers free vs busy.

**Feel.** Balanced like Zelda: exploration, errands, riddles, puzzles, building and calm moments, with short readable
fights. Sealed Halls play as dungeons (rooms, puzzles, keys, a Hall Warden themed from the milestone). Combat style is
a setting with all three supported: light real-time, turn-based, and hybrid (the default: real-time foes, turn-based
3D boss and ambush battles).

**One shared core for 2D and 3D.** A render-free core holds:
- the protocol client
- the rules
- world state
- quests and battles
- saves
- the lore runtime

The Phaser 2D and Three.js 3D views are thin views over it.

**Customizable through lore files.** A world's lore folder holds dialogue and quest scripts in **Ink** (inkjs) and a
rules section with:
- weights and the boss threshold
- interruption defaults and quiet hours
- Renown rates
- the number of resolved items kept in the log
- outbox seconds
- risk tiers and the never-in-game list
- the default combat style

The default lore is **"The Unwritten Realm"** . It adds the Haze,
Marches, Sealed Halls and Sigils, Works, Riddles, the Tanglers (Knot, Fray, Burr), the Gloamwyrm, Renown, Ember as
stamina, the Beacon, the Warden's Seal, True Sight and the Recall Bell. It reuses the game's existing Warden Ash,
Keepers, Lumi, the Ember Well and the Long Night.

| Mechanic | Default lore |
|---|---|
| World (company) | **a Realm**, named after the company, its seat the Keeper's Lodge |
| Region (project/team) | **a March**, with its own banner colour and an Ember Well at its heart |
| Starting a project from a conversation | the Cartographer draws a new March; the Haze peels back |
| Fog of war / pacing wall | **the Haze**: "the road isn't written yet"; the Keepers' progress shows as the road being laid |
| Milestone | **a Sealed Hall** (a dungeon); its door holds a Seal until the milestone is done. Its Hall Warden is themed from the milestone. Badge = **a Sigil** |
| Task / size | **a Work**; sized pebble / stone / boulder (S/M/L) |
| Open questions, batched | **Riddles** carried by townsfolk; a batch = one quest |
| Guided chain (bike voucher) | **an Errand Trail**: one villager sends you to the next, ending in a gift (a shortcut, a mount, a key) |
| Blockers / failures | **the Tanglers**: Knot, Fray and their pet Burr, who snarl stuck Works and ambush the player |
| Planning / special attention | a Keeper or villager asks for a **Council** |
| Calls from other Marches | **Speaking Stones** ring ("it's the Lab Keeper, got a moment?"), or Lumi brings word |
| Backlog boss | **a Gloamwyrm**: unanswered Riddles condense in the Haze into a beast whose size follows the weighted score; from R5 backlog pressure (open work against the release date) is a second input |
| Retreat from a boss | fall back to the Lodge; the Gloamwyrm returns stronger |
| XP (team, work-only) | **Renown**, shared by the whole March |
| Play rewards | trinkets, gear, cosmetics, mounts, shortcuts |
| Budget = stamina | **Ember**: the Well's fuel. When it's out, Keepers rest |
| Capacity | Keepers at the Lodge benches: free vs at work |
| Unified status | **the Beacon** atop the Lodge: bright gold, amber flicker, or red |
| Cross-project dependency | **a Fallen Bridge** between Marches until the other side finishes |
| Retrospective / campaign ending | **an Embertale** around the campfire |
| Wins | Sigils and trophies in the **Hall of Champions**; the **Champions League** by season |
| Sealed decision / true view | **Warden's Seal** in wax; **True Sight**: the game's line, with the real words always shown under it |
| Outbox recall | Lumi waits at the gate a moment before flying; call her back |
| Emergency stop | **ring the Recall Bell**: every Keeper comes home |
| Stale question | the Riddle "fades" with a note |
| Usage limit hit | **the Long Night** (already in the game) |

## No server, except the Bridge (was the Paperclip connector) (user, 2026-10-03)
> **Reversed in part (user, 2026-10-03): one Bridge for all communication.** "Make one bridge for all communication:
> MQTT, falling back to polling or a webhook when a user or agent asks for one." One optional local process replaces
> the Paperclip connector and carries Paperclip reads, sealed write-back, the Source chat and agents. The lines marked
> *reversed* below no longer hold. The game itself still runs with no server; with the Bridge off it runs on the Local
> Ledger and `/work` copy-paste as before. See "Missions, Keepers and the Bridge".
**The game runs entirely in the browser, with no server of any kind,** ours or hosted, **except a small optional
Paperclip connector** (below). It is static files (GitHub
Pages, or opened locally) plus browser storage. This overrides every mention below of the Quest server, the polling
endpoint, the local runner and server-side file writes.
- **Project data:** the Local Ledger (IndexedDB) is the only live source, and R0 starts on it.
- **Paperclip: a small JS connector, and only that** (user, 2026-10-03). Paperclip sends no CORS header (checked
  2026-10-03: no `Access-Control-Allow-Origin` from `127.0.0.1:3100`), so a page can't read it directly. We ship a
  small Node script that the player starts only if they use Paperclip. It is only a connector: it passes the game's
  Paperclip reads through (adding the header for the game's origin) and posts sealed decisions as comments. It holds
  the Paperclip key, answers only the player's own machine, and ~~does nothing else: no agents, no runner, no saves, no
  game logic~~ (*reversed* 2026-10-03: it becomes the Bridge, which also carries agents and the Source chat; still no
  saves and no game logic). With it off, the game runs on the Local Ledger. Agents never write to Paperclip directly: only sealed
  decisions are posted. Built in R4.5 as the Bridge; until then the game uses the Local Ledger only.
- **Agents:** ~~only through the `/work` copy-paste page~~ (*reversed in full* 2026-10-03: opt-in, an agent can also
  connect through the Bridge, over MQTT or polling/webhook on request, or WebLLM can act as one, and get work and report
  with no paste). Copy-paste stays the default: the player copies a prompt into their own agent and pastes the result
  back. The game itself still never starts a process. ~~No polling~~ (*reversed*).
- **The game's LLM:** WebLLM and templates; Ollama only when the page is on `localhost` (Ollama allows localhost
  origins by default). No `claude` CLI provider.
- **Saves:** IndexedDB plus a downloaded save file; the atomic-write, checksum and fallback rules apply to the
  IndexedDB copy.
- **Outside relays we don't run:** Yjs over WebRTC (teammates) and the MQTT phone link still use public
  signalling/broker servers.
- **`app.js`** (the server the game runs on today, port 4777) keeps running the current game until the browser-only
  version covers what it does, then retires. No new features go into it.

## Sources, schema and agents (2026-10-03)
**Two sources behind one protocol** (no GitHub, user 2026-10-03) (`source` plugins); the game never knows which one is running:
1. **Local Ledger** (default, free, offline, no account): tasks, milestones and questions stored in the browser
   (IndexedDB, as `public/net.js` already does for saves). Teammates sync with **Yjs** over WebRTC (multiplayer
   plan); **isomorphic-git** gives history and an optional push to any git host. Halls, Works and Riddles are made
   in game, through conversations and the planner NPC.
2. **Paperclip** (through the Paperclip connector, see No server): company = world, project = March, goals = Halls, issues = Works (see Design).

**Schema enforcement.** Native fields first (goals/milestones, priority, status, parent). Then a small fixed label
set (`size:S|M|L`, `weight:<n>`, `risk:high`, `quest:council`) where the source has no field. The adapter validates
every snapshot against the protocol and never guesses: a task with no milestone or a milestone with no tasks
becomes a **repair quest** ("this Work belongs to no Hall, where should it go?"), answered as a sealed decision that
fixes it at the source. The schema goes into agent instructions, and an audit routine can check for gaps. Sizes
and weights are soft (derived when missing); only the structure (task → milestone → project) is required.

**Agents are external workers** (user): an agent can run anywhere (Claude Code on your machine, a cloud runner, a
teammate's machine). Each one is **registered** in the ledger (name, skills); the game invokes an agent by queueing
work for it on the `/work` page, and only registered agents get work. Agent controls in game (summon = wake, rest = pause, call back =
resume, recall one run = cancel, the Recall Bell = pause all) are protocol actions, so every source offers them;
each one is a sealed decision with a token readout. 

**How agents connect: the `/work` relay page** (user, 2026-10-03; ~~the polling endpoint was dropped with the server~~, *reversed* 2026-10-03: the Bridge offers
polling or a webhook as a fallback to MQTT).
A `/work` route on the game site (works on GitHub
Pages, no server) lists queued work per agent as ready-to-copy prompts. The player pastes a prompt into their own
agent (e.g. Claude Code), then pastes the result back on the page, and it enters the protocol like any other
progress report (marked as relayed by the player). Results still pass the same validation and safety rules.

**LLM adapter (the game's own voice).** Separate from agents: agents do the work; the game's LLM writes NPC lines,
recaps, plans, the Cartographer chat and lore. It is the studio's `provider` plugin (`plugins/provider/<name>/`,
`lib/plugins.js`, moved into the browser), extended with: `usage` (token counts per reply, for the token readout),
WebLLM, and per-model capabilities (structured JSON, context size, vision). The lore rules route
each job to a model with fallbacks: flavour lines and recaps → small local model → WebLLM → **templates** (0 tokens);
planner → bigger local model or Claude (asks first); Cartographer and lore → the chat panel's picker; Errand Trails,
weights and boss triggers → **plain rules, no LLM**. Guardrails: never writes or rewords decision text; structured
output is schema-checked before saving (fall back to templates); a filter keeps real product names out of lore;
timeouts; cached per item. Providers: WebLLM, Ollama (localhost pages only), a cloud-connector slot.

**Without Paperclip (the default now).** The Local Ledger holds Marches, Halls and Works (made in game). A small
**agent registry** in the ledger (name, role, skills, status) fills in for Paperclip's org chart. Controls become
states on the `/work` page: wake = queue work, pause = resting (no prompts offered), cancel = run stopped (pasted
results refused); the Recall Bell rests everyone. Budget is our own count from the usage agents report in pasted
results plus the LLM adapter's `usage`, spent as Ember. Trade-offs: the game can't stop an agent that is already
running (the player stops it in their own tool), and budgets are as accurate as agents' reports.

**Seeing the source in game.** A Ledger panel in the Keeper's Lodge shows the protocol view (Marches, Halls, Works,
Riddles, agents, the Beacon) for any source.

## Safety (all accepted)
1. Only sealed choices reach the project.
2. True Sight shows the real text, verbatim, always: the game's line on one line and the real text right under it
   (user, 2026-10-03). Both are clearly readable (full-size, full-contrast type, never faded or tucked behind a
   toggle), and real text is always shown as plain text, never as HTML. When a conversation is split into several
   bubbles, the player can step back to earlier bubbles as well as forward. The conversation box sits docked at the
   bottom of the screen, not floating over the speaker. It is wide (most of the screen width) with the speaker's
   sprite or head beside the text, animated as if talking while the line appears (user, 2026-10-03). Until real
   portraits exist, use the character's existing 2D sprite or a placeholder (see missing art). In a Riddle, the
   Warden's Seal appears only on the last bubble, so the whole question is read before sealing (user, 2026-10-03).
3. Risk tiers: merge, deploy, delete and budget changes leave the game for a plain confirm; a never-in-game list.
4. An outbox with a recall window.
5. The budget is stamina: when it's empty, work pauses.
6. No XP for saying yes.
7. Autoplay never decides.
8. Stale questions expire.
9. Each sealed decision is written back to its Work in the ledger, and for Paperclip Works to the issue as a comment
   through the Paperclip connector.
10. Teammates' answers are shown, never overwritten.
11. The Recall Bell stops all work, from anywhere.
12. Agents work on branches, and merging always takes a human.
    *Exception (user, 2026-10-04):* this rule is about Keepers' work in the game. Quest Dev, the Paperclip agent that
    builds the game, now reviews its own diff against these safety lines and fast-forward-merges its own
    `quest-dev/*` branch into `3d-world` once `npm test` passes (paperclip/AGENTS.md, "End of every run").

## Releases (build order, user 2026-10-03; replaces "M0 first")
Playable slices first; the shared-core refactor waits until the fun is proven. The milestones below stay as the
feature list; releases pick from them.
- **R0 (today's MVP): "The Beacon lights up".** 3D view, browser only, from the Local Ledger (user, 2026-10-03):
  a minimal ledger in IndexedDB, a Ledger panel to add Halls and Works by hand, and a sample Realm to load. The Beacon
  (unified status), the in-game log (open items + last 5 resolved), one Sealed Hall per Hall shown locked/open,
  Keepers busy/free.
- **R1 "Riddles":** blocked / review-needed Works become NPCs with Riddles; answer with the Warden's Seal, True
  Sight, outbox recall; write-back to the Work in the ledger.
- **R2 "The Gloamwyrm":** a simple turn-based boss from the weighted backlog score, pausing per real question, with
  retreat. Vertical slice complete: **playtest the fun here**.
- **R3 "Lore quests":** play for days with no work: shared area lore from local weather and real local happenings
  becomes game-only Riddles and errands, and the hub's board gets a Town news tab (user, 2026-10-03; see "R3 Lore
  quests" below).
- **R4 "Bring your Keeper":** the `/work` copy-paste page and agent registry, start work from an NPC with a token
  readout. **The Paperclip connector is its own small release after R4** (user, 2026-10-03). Pasted results are read
  from **one fenced `quest-report` block** the prompt asks for (kind progress/done/blocked, summary, question, branch,
  token counts); with no valid block the player picks the kind by hand, and the paste is always kept verbatim (user,
  2026-10-03). Contract built 2026-10-03 (`parseReport`, `emberLeft`, `branchFor`, lease/Ember rules, `wandered`).
- *Build order (user, 2026-10-03): R5 Missions goes before R4.5 The Bridge; missions don't need the Bridge.*
- **R4.5 "The Bridge"** (was "the Paperclip connector"; user, 2026-10-03): one optional local process for all
  communication: Paperclip reads and sealed write-back, agents (opt-in: get work and report with no paste), and later
  the Source chat. MQTT first, polling or a webhook when a user or agent asks for one. It is the first way work reaches
  agents without a human paste, so it ships with these safety lines, each with a safety test added in R4.5: only
  registered Keepers get work over the Bridge; Bridge messages are data, never commands, shown as plain text with True
  Sight; the Bridge answers only the player's own machine, and MQTT/webhook credentials are per Realm, never in
  prompts; the Recall Bell also tells the Bridge to stop handing out work.
  *Decisions (user, 2026-10-04):* the Bridge bundles its own MQTT broker, **aedes**, with the **mqtt** client. That is a
  one-time exception to "no new dependencies", limited to those two packages plus the WebSocket adapter aedes needs for
  browsers. Paperclip write-back is **comments only** (sealed decisions and finished-work reports); issue status changes
  stay manual. Quest Dev builds it from one contract-and-split issue and creates the slice issues itself.
  *Where it runs (user, 2026-10-04):* one Bridge core module (no top-level listen), hosted two ways: as a **Paperclip
  plugin** worker (`@paperclipai/plugin-sdk`: Paperclip events pushed instead of polled, comments through
  `ctx.issues.createComment`, and no `issues.update` capability, so write-back stays comments only), and **standalone**
  (`npm run bridge`) for players without Paperclip, so Paperclip stays optional. The plugin is built and tested in the
  repo; the user installs it into Paperclip (`paperclipai plugin install --local`).
  *Bell and restarts (user, 2026-10-04):* the Bridge always **starts halted**; only the game's `open` clears it, so a Bell
  rung while it was off is never lost. Identity comes from the connection: every connection needs the per-Realm login,
  and WebSocket upgrades and the Bridge's HTTP writes from any page but the game's own origin are refused (review of
  `152c47e`/`83edeaf`). *Logins (user, 2026-10-04):* one shared Realm login, as built; anyone with the Realm password can
  claim any client id, and the user accepts that. *Keepers (user, 2026-10-04):* the game publishes only the opted-in
  Keepers and their status on a retained topic; the Bridge never holds the full ledger. *Offers (user, 2026-10-04):* that retained
  message also carries, per queued item, the finished WorkOffer the game's own rules allow now (`keepersMessage`); only
  the Bridge may read the topic, and the Bridge only relays offers, it never builds them.
- **R5 "Missions and the first Sealed Hall"** (user, 2026-10-03): missions (a parent Work and its children; the saga is
  their Hall), backlog pressure against the release date and its gate on side content, the Sealed Hall as the saga's
  finale and its Sigil, and Keepers summoned with Ember, joining and released. The R4 controls already respect
  summoned/released (`f08151c`), so R5 only adds summon, join and release. Contract built 2026-10-03 (`0e54f1d`).
- **R6 "Drama":** "Previously on…" / "Next time…" recaps and promises from the event log, the finale battle with phases
  (extends R2's boss), and Grill the Keeper (R1's asks, real text verbatim).
- **R7 "Your own Realm"** (was R6): the full Local Ledger (planner NPC, teammates), New Game / Load, split save with
  archiving, and checking the event log's chain on load (warn, never refuse).
- **R8 "The Source":** auto mode (plays, stops for the human) and the Source chat over the Bridge, with the in-game
  Help panel's "Connect your model" instructions.
- **R9+** (was R7+): shared core (M0), Ink lore (M2) and LLM routing, progression and the league, other combat modes,
  2D parity, and an MCP server for agents (from mnehmos/rpg.mcp: one tool per area with an `action` field).
Cost accepted: R0–R5 are built straight into the 3D code and partly moved into the core later.
**How a release runs** (user, 2026-10-03): (1) a short **contract** step fixes the shared shapes in code (the ledger
schema, the Riddle record, the `/work` queue states, the save format) plus a sample data file; (2) every slice is built
**side by side** in its own git worktree against that contract; (3) an **integration** step joins them into `3d-world`
and runs the safety tests. Each feature lives in its own module; only integration edits `public/3d/scene.js`. A round
is one session long. Exceptions: R2's tuning and playtest run in order after its parallel round, and R7's shared core
is built alone. The R2 playtest is the gate: nothing from R3 on starts before it passes.

## Marches as 3D regions (CLA-15, user, 2026-10-04)
- One 3D region per March, reached by a gate at a road end of the hub (8 gate slots; more Marches than that wait: the
  extra count is known to `hubGates` but nothing draws it yet). The game builds only the region you stand in and drops
  it on leaving. Regions come from the ledger snapshot (`public/quest/regions.js`), so a Paperclip source and the local
  ledger take the same path, and the renderer has no special case for either.
- **Local ledger mode** (user, 2026-10-04): with no real March (a fresh ledger, or only Town news), `regionsOf` returns a
  default set of four explorable regions (no Works); as soon as the ledger has a March, one region per March replaces them.
- A region shows its Works as posts (at most 24, most urgent first); E reads one as plain text. Not built yet: Speaking
  Stones, the Fallen Bridge, Keepers walking a March, an Ember Well in each region.

## Missions, Keepers and the Bridge (user, 2026-10-03)
Prompted by a study of mnehmos/rpg.mcp and r/aigamedev's list of LLM games, and the user's verdict that fights are
boring: "more fun and drama like Pokémon and DBZ, some story and milestone drive; it should be mostly missions". Not
Pokémon itself: "don't force Pokémon mechanics".
- **Missions:** the player goes on one mission at a time. A mission is a sub-milestone: a parent Work and its child
  Works (`Work.parentId`, Paperclip's parent issue; one level). A Work with neither is a side mission. Briefing from its
  Keeper, each Work a step, a waiting Riddle a cliffhanger, then a debrief. Mission progress is play state.
- **Sagas:** the Hall (milestone) strings its missions together; its finale is the Sealed Hall and its Sigil.
- **Deadlines and timed releases:** "we work on deadlines and time releases". `Hall.dueAt` is the release date (the
  saga's clock), `Work.dueAt` a deadline. Deadlines are on work, never on answering.
- **Backlog pressure:** "if backlog is piling up, link that to the game, so we can control gameplay". Open work weight
  against the time left to the release date drives the villain, the Haze and mission urgency, and above
  `rules.pressureGate` it locks side content (lore quests, the lore tab, exploring beyond the hub). It never gates
  `/work`, Riddles, the Lodge, the Recall Bell or saves (safety test), and never changes hit size or answers.
- **Keepers are agents, made of Ember:** summoning one spends `rules.summonCost` Ember (it comes back as the window
  moves on); it joins the Lodge after its first approved Work, and can be released to the Hall of Champions (kept, never
  deleted). Everything else about a Keeper is read from its real work; the game invents no stats, types or levels.
- **Auto mode:** the game plays itself (picks missions by pressure, walks, wakes and queues Keepers, plays fight
  beats) and stops for the human at every Riddle, and at every paste for Keepers on copy-paste; Keepers connected
  through the Bridge report on their own (opt-in).
- **The Source:** a chat panel with a model of the player's choice over the Bridge. It reads Paperclip and proposes;
  every proposal becomes an outbox item the steward seals, and it never merges. Its text is plain text, treated as data,
  with True Sight flags.
- **Help: "Connect your model":** copyable instructions generated from the contract (like `REPORT_INSTRUCTIONS`), one
  block to give any agent and one to do by hand (MQTT commands, a `curl` webhook call), with credentials only as
  placeholders.
- **Also from the study:** "did you mean" paste errors and a hash-chained event log (both in the R5 contract).
- **Agents can connect and report on their own, opt-in** (user, 2026-10-03, "Yes, opt-in"): copy-paste on `/work`
  stays the default. Optionally an agent connects through the Bridge (Claude Code, Ollama, anything) or WebLLM acts as
  one in the browser, and gets work and sends reports with no paste. Its reports still pass `parseReport` and the same
  validation, Riddles still stop for the human, the Recall Bell stops everything, and merging is always a person's
  job.

## R2 playtest criteria (approved by the user, 2026-10-03)
The gate before R3. **Setup:** the sample Realm plus a scripted backlog that crosses the boss threshold with three
fake questions: one normal, one risk:high, one on the never-in-game list. The user plays it twice: once fresh, once a
day later with a heavier backlog. **R2 passes only if every line holds;** a miss means rethink before R3 (see Risks).
1. **Fun with no real work in it:** run once with only fake questions, the user still rates "I'd fight it again" at
   4/5 or higher, and never waits more than 5 seconds with nothing to do.
2. **Readable:** a three-question fight lasts 3 to 6 minutes. On every turn the options are clear, and the user can
   name which Works feed the Gloamwyrm and why it is the size it is.
3. **Questions feel welcome, not forced:** every pause shows the whole question (True Sight) with no timer, the user
   never feels rushed into an answer, and answers at least one question they would otherwise have left.
4. **Safety holds in combat:** mashing through a pause never picks an answer (input lock); the risk:high question
   pauses the fight and is answered in the Lodge; the never-list one only shows where to answer it; "Ask me later"
   lands the hit; no answer changes hit power.
5. **Retreat is a real choice:** it works from any turn, keeps every answer already given, and the Gloamwyrm comes
   back stronger in a way the user can explain.
6. **Clearing the backlog wins:** the Gloamwyrm falls only when its questions are resolved (answered or deferred), and
   winning visibly changes the world (the Beacon, the Haze).
7. **Wants to come back:** after the second session the user wants to play tomorrow and can name one thing they look
   forward to.
8. **Sound:** no console errors; playable at 375px width by touch and with reduced motion.

## R3 Lore quests (user, 2026-10-03)
The gap: every system that moves is fed by the ledger, so a player with no work can walk Ember Hollow but nothing
spawns, the Haze stays at 0 and the Gloamwyrm never comes (Context, "Core gameplay"). R3 adds a second source of
quests; the loop stays the same.
- **Two sources, one loop.** Work comes from the ledger as now. **Area lore** comes from local weather and real local
  happenings. Lore entries become a game-only Lore Hall, a Work per entry and a Riddle with
  `mark {source:'lore', real:false}` (add `'lore'` to the mark sources in `contract.js`). One helper, `isGameOnly`,
  keeps them out of `bossScore`, `shouldSummon`, `riddleWeight`, `realmStats` and `answerTimes`, so lore never feeds
  the Haze, the Gloamwyrm, the stats board or Renown. "Area lore" is not the lore files of PLAN-settlements §12;
  the code lives in `area-lore/` and `public/quest/area-lore.js` to keep the two apart.
- **Only some events, written in-world with a hint.** Allowed: festivals, markets, sports, music, seasonal, weather.
  Anything else is dropped, never filtered after the fact. "Bards gather at the Lodge tonight", with a tooltip naming
  the real event.
- **Shared per area.** An area is a geohash-4 cell (about 39x20 km). Each event is written once and reused by every
  player in the cell until it ends. Clients read their cell plus the 8 neighbours, so a player near an edge still
  sees what's over the line.
- **Where it's written (user):** a scheduled GitHub Action on a **self-hosted runner on the user's Mac, using Ollama**
  (no hosted API; the `askModel` pattern from `lib/story.js`). In-game lines keep the WebLLM-first storyteller of
  PLAN-settlements §11; only the shared area lore uses Ollama. A missed run while the Mac is off only makes lore late.
- **Three repos, because this one is public** and a self-hosted runner must never be attached to a public repo:
  `claude_quest` (public) holds the generator code and the client; a new **private** `claude-quest-lore-gen` holds
  the hand-kept `areas.json` (cells, and the iCal/RSS feed URLs for each), the workflow (schedule and manual triggers
  only) and a deploy key; a new public `claude-quest-lore` with no workflows holds only
  `lore/<cell>/<eventId>.json` and `lore/<cell>/index.json`, read by clients as static files.
- **The board (user):** the hub's `B` board gets two tabs, Town news (area lore) now and Quest boards when
  PLAN-settlements §16 lands. Wired like the Lodge: a box check in `riddleTick`, `quest:near {place:'board'}`,
  E sends `quest:board`, a panel copied from `stats-board.js`.
- **Never empty:** with no location, no network or nothing live, built-in clock and calendar entries (time of day,
  season, weekend) fill the board. A rough location is asked for once and kept as `quest.place`, as the weather
  already does in `atmosphere.js`.
- **Built 2026-10-03** (see HANDOFF.md): all four steps, plus `lore/cells.json` so clients only ask for cells that exist.
- **How R3 runs:** contract (the area-lore entry shape, a sample cell file, the mark source, `isGameOnly`) → side by
  side: (a) the client source, ledger mapping, filters and calendar fallback ∥ (b) the board ∥ (c) the generator
  (weather from Open-Meteo, feeds, Ollama writer with template fallback, `generate.js` writing to a folder) plus a
  setup README for the two repos and the runner → integration (scene.js wiring, safety tests: lore never moves the
  Haze or the stats; a browser check with a local lore folder through `?lore=`).
- **After R3, not yet placed in the order (user):** a hub built roughly from the real map. OpenStreetMap through
  Overpass, reduced to the 48x32 hub legend, the town on the densest built-up spot with the Lodge, board and Keeper
  spots around it. Cell scale is shared (`map.json` from the generator); a finer geohash-5 map is the player's choice,
  built in the browser and never published. Today's Ember Hollow stays as the fallback. First check scene.js and
  boot.js for hard-coded coordinates.

## Risks and gaps (2026-10-03)
Decided by the user on 2026-10-03, through the Quest Engine Council page (one pick per item).

**Risks and their mitigations:**
- *The fun is unproven:* releases, plus **written playtest criteria before R2**. If R2 misses them, rethink before R3.
- *Boss pressure could push hasty real decisions:* no timers on question pauses, "ask me later" always available,
  answers never affect combat power, **and risk:high Riddles never appear in combat**: they pause the fight and are
  answered in the Lodge.
- *Scope keeps growing:* **each release is time-boxed to one session**; whatever isn't done moves to the next release.
- *Prompt injection from task text and pasted results:* treat it as data, the NPC LLM gets no tools, real text is
  always shown as plain text (never HTML), **and True Sight flags suspicious lines** (text that addresses the reader
  or the AI) before sealing.
- *Local Ledger lost when browser data is cleared:* autosave plus a "download your save" nudge (kept as is).
- *Missing art (Tanglers, Gloamwyrm, Wardens, dungeon kits):* **Three.js placeholders for R0–R2, CC0 packs (Kenney,
  Quaternius) by R5.**
- *2D + 3D doubles view work:* **2D is frozen until R7.** It keeps working, but gets no new features.
- *Paperclip API drift:* read only the fields we need, **and validate each snapshot against the protocol**. On a
  mismatch, keep the last good world and light a warning on the Beacon.

**"Ask me later" counts as an answer** (user): in a boss fight or a Riddle, deferring is a valid response; it lands
the hit and clears the item for now, marked `deferred`. The item returns after a delay set in the lore rules, and its
weight keeps growing with age, so deferring everything can't dodge the next boss.

**Gaps, now designed:**
- *Agents claiming work (R4):* a **lease** (user picked "renewed by any poll or progress post"; with no server it
  starts when the player copies the prompt on `/work`, and pasting a progress report renews it). The length is set in
  the lore rules. When it lapses, the work goes back on the board and the Keeper shows as "wandered off".
- *Who accepts a milestone without Paperclip (R6):* **a council vote for big milestones (`quest:council`), the
  March's steward otherwise.** When every Work is done, a "Is this milestone shipped?" Riddle appears; sealing it
  breaks the Hall's seal.
- *Team conflicts (R1 field, used later):* **each March has a steward who seals its decisions, with the Realm owner as
  fallback.** Teammates' answers show as proposals (safety rule 10). Store `sealed_by` and `steward` from R1.
- *Notifications when the game is closed:* **only a "while you were away" digest on the Beacon when you open the game.**
  No push, desktop or email notifications for now.
- *Success measures:* **a local event log in the save** (Riddle raised, answered or deferred; agent blocked or
  unblocked; play session start and end), shown as a stats board in the Keeper's Lodge. It never leaves the machine.
  Starts in R1 with question-to-answer time.
- *Safety rule tests:* **`node:test`, one test per rule, added in the release that introduces the rule**, against a fake
  Paperclip fixture. No new dependency.

**Open questions, answered:**
- "No GitHub" means GitHub is not a work source. **GitHub Pages hosting is fine.**
- **The Marketplace stays on GitHub** (`thenewurbankid-web/claude-quest-marketplace`); **saves can push to any git
  host**, optionally.
- Pack licences vs open source: **decide when the Marketplace is built.**

## Milestones
Each is shippable and tested on its own. Reuse what exists; don't rebuild it.

- **M0 Shared core.**
  - Create `public/core/` as render-free ES modules: a state store, an event bus, grid rules, the input map and
    storage helpers.
  - Move these out of `world.js` (`blocked`, `bfs`) and `3d/scene.js` (`free`, `tryMove`, the key map).
  - Both views import the core, and the 2D page moves to modules.
  - Done when both views play exactly as before.
- **M1 Protocol + sources (read-only).** Local Ledger and Paperclip adapters; schema validation and
  repair-quest detection; agent registry (read-only); the Ledger panel.
  - A browser protocol module (types and marks) and a `source` plugin kind, both in `public/`.
  - `plugins/source/paperclip`, reading through the Paperclip connector (`snapshot`, goals, issues).
  - The protocol module computes weights, the backlog score and the Beacon in the page (no `/api/protocol`).
  - In both views: the Beacon chip and the in-game log (open items plus the last 5 resolved).
  - Nothing writes to Paperclip yet.
- **M2 Lore runtime.** Plus the LLM adapter additions (`usage`, `runs`, capabilities, job routing, templates).
  - inkjs in the core, after checking its licence.
  - `lore/default/` holds The Unwritten Realm: a rules file plus Ink scripts.
  - Hard-coded story text moves into lore. This covers Phase A of PLAN-settlements.
  - The storyteller (`lib/story.js`) adds flavour only, never decision text.
- **M3 Map from the protocol.**
  - Each project becomes a March with its own region.
  - The Haze (fog) clears as work reaches further.
  - A Sealed Hall per milestone, shown locked or open.
  - Fallen Bridges for cross-project dependencies.
  - Keepers shown free or busy.
  - 3D first, using `3d/scene.js` and `hub.js`; 2D reads the same core.
- **M4 Questions, decisions, safety.** Plus the `/work` relay page (register, queued prompts, pasted results) and the
  in-game agent controls.
  - Seal UI, True Sight and the outbox with recall.
  - Risk tiers and the never-in-game list.
  - Write-back to the Work in the ledger, and to Paperclip through the connector.
  - A teammate's existing answer is shown instead of overwritten; stale questions expire.
  - The Recall Bell, built from today's "send the guild home".
  - Ember as stamina from our own budget count.
  - Riddle batches answered through NPCs.
  - An Errand Trail generator.
  - Speaking Stones and Lumi for delivery.
  - An interruption scheduler with tiers, frequency, quiet hours and never mid-battle.
  - Reuse the 2D `ui.js` dialog flows.
- **M5 Starting work.** Plus the agent registry for play without Paperclip (no local runner: no server).
  - Talking to an NPC or summoning a Keeper creates a task or project, after a confirm and with a token readout.
  - Uses the studio chat providers (`public/studio/chat.js`, `lib/plugins.js`).
- **M6 Battle core, hybrid mode.**
  - One battle core in `public/core/`.
  - Real-time light combat for small foes.
  - A turn-based full-screen 3D scene for Tanglers and the Gloamwyrm.
  - Pauses for each question; the mash accent with an input lock; retreat.
- **M7 Sealed Halls as dungeons.**
  - Generated and themed from the milestone: rooms, puzzles, keys and a Hall Warden.
  - Locked until the goal is achieved; winning gives a Sigil, followed by an Embertale retrospective.
- **M8 Progression.**
  - Team-wide Renown from outcomes.
  - The pacing wall and difficulty scaling.
  - Play rewards, with items opening the map.
  - The Hall of Champions (Sigils and campaign trophies) and the Champions League standings, by season.
- **M9 More modes.**
  - Pure real-time and pure turn-based as settings.
  - 2D parity for everything above.
- **Later.**
  - More sources (e.g. Linear, Orbit), if wanted.
  - Multiplayer with shared team state (PLAN-settlements Phase F).
  - Task sizing by agents.

## Effort estimate (by release, parallel, 2026-10-03)
A round is one session long (3–4 h, from commit times on 2026-10-02/03). Work = sessions of effort across all
parallel slices, including the contract and integration steps (about one session per release).

| Release | Rounds | Work (sessions) | Built side by side | Main risk |
|---|---|---|---|---|
| R0 The Beacon lights up | 2 | 3 | ledger store ∥ Beacon/panel | the 3D view has no UI layer yet |
| R1 Riddles | 2 | 5 | conversation box ∥ Riddle logic ∥ outbox/write-back ∥ tests/log/digest | getting the safety flows exactly right |
| R2 The Gloamwyrm | 3 | 5 | boss ∥ weights ∥ placeholder art, then tuning, then **playtest (gate)** | combat feel; the fun itself |
| R3 Lore quests | 2 | 5 | area-lore client + filters ∥ Town news board ∥ generator on the self-hosted runner | events that feel local, not generic |
| R4 Bring your Keeper | 2 | 4 | `/work` + lease ∥ start work/Ember/Recall Bell ∥ Paperclip connector | relayed results passing validation |
| R5 The first Sealed Hall | 2 | 5 | layout ∥ puzzles ∥ Warden ∥ Sigil/Embertale | puzzles that are fun |
| R6 Your own Realm | 2 | 5 | planner NPC ∥ New Game/Load ∥ split save ∥ acceptance | save migrations |
| R7+ | ~6 | ~12 | shared core alone, then Ink/LLM ∥ progression/league ∥ modes/2D parity | `world.js` is 1,527 lines of globals |
| **Total** | **~21** | **~44** | | |

**ETA at 5 rounds a week from 2026-10-04** (redone 2026-10-03 with R3 Lore quests added): playtest (7 rounds)
2026-10-13; R6 Your own Realm (15) 2026-10-24; everything (~21) 2026-11-01. With the 30% tuning/art buffer: R6
2026-10-30, everything 2026-11-09.
**Hours** at 3–4 h a session: playtest 39–52 h, R0–R6 96–128 h, everything 132–176 h (170–230 h with the buffer).
Parallel finishes in about 60% of the calendar time of one-at-a-time (~36 sessions, 2026-11-23) but costs about
25% more work and tokens per day, and several streams to review at once. The Quest Engine Council artifact compares
both modes for any start date, cadence and session length.

## Open questions (ask when their milestone comes up)
- Towns inside a March: one per Sealed Hall, or per agent workplace? (M3)
- Can a player enter or practise in a locked hall, or is the door shut? (M7)
- Licences for inkjs and Tiled; whether Tiled maps are worth it over the code-built grid. (M2, M3)

## Verification
Per milestone, served as static files by a dev-only file server (a launch config; the game itself needs no server),
with a throwaway ledger in its own browser profile, never the real 4777 game, and checked in the browser pane with no
console errors:
- **M0:** both views behave as before (walk, NPCs, dialogue in 2D; weather and actors in 3D).
- **M1:** load the sample Realm; weights, the Beacon and the log match its Halls and Works.
- **M4:** use a throwaway ledger for write-back tests. Covers recall, the risk-tier confirm, and stale
  and teammate cases.
- **M6–M7:** script a boss with three fake questions. Check it pauses, the input lock works and retreat works.
