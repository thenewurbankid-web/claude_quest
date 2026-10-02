# Quest engine plan: a game that runs your agents' work

## Context
Quest turns agent work into a game, but today the game is a skin over a dashboard. The 2D game (Phaser,
`public/world.js`) has the systems (dialogue, quests, bosses, saves), while the 3D view (Three.js, `public/3d/`)
has the looks but no game data; the two share no code. The user (2026-10-03, dictated line by line) wants a
**customizable engine, driven by lore files**, where real project work becomes Zelda-balanced play: milestones
become dungeons you can only win once the work is done, blockers ambush you, backlogs become bosses, and the plot
writes itself from the tasks. It must be fun with no work running, and it must never put real work at risk.

This file is the agreed design plus the build order (approved 2026-10-03). It supersedes PLAN-adventure.md where they
disagree (creature collecting is out; gyms are Sealed Hall dungeons). Build each milestone in its own session,
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
- Play rewards are trinkets, gear, cosmetics, mounts and shortcuts. **No creature collecting.**
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
| Backlog boss | **a Gloamwyrm**: unanswered Riddles condense in the Haze into a beast whose size follows the weighted score |
| Retreat from a boss | fall back to the Lodge; the Gloamwyrm returns stronger |
| XP (team, work-only) | **Renown**, shared by the whole March |
| Play rewards | trinkets, gear, cosmetics, mounts, shortcuts |
| Budget = stamina | **Ember**: the Well's fuel. When it's out, Keepers rest |
| Capacity | Keepers at the Lodge benches: free vs at work |
| Unified status | **the Beacon** atop the Lodge: bright gold, amber flicker, or red |
| Cross-project dependency | **a Fallen Bridge** between Marches until the other side finishes |
| Retrospective / campaign ending | **an Embertale** around the campfire |
| Wins | Sigils and trophies in the **Hall of Champions**; the **Champions League** by season |
| Sealed decision / true view | **Warden's Seal** in wax; **True Sight** shows the plain words |
| Outbox recall | Lumi waits at the gate a moment before flying; call her back |
| Emergency stop | **ring the Recall Bell**: every Keeper comes home |
| Stale question | the Riddle "fades" with a note |
| Usage limit hit | **the Long Night** (already in the game) |

## Sources, schema and agents (2026-10-03)
**Two sources behind one protocol** (no GitHub, user 2026-10-03) (`source` plugins); the game never knows which one is running:
1. **Local Ledger** (default, free, offline, no account): tasks, milestones and questions stored in the browser
   (IndexedDB, as `public/net.js` already does for saves). Teammates sync with **Yjs** over WebRTC (multiplayer
   plan); **isomorphic-git** gives history and an optional push to any git host. Halls, Works and Riddles are made
   in game, through conversations and the planner NPC.
2. **Paperclip** (optional): company = world, project = March, goals = Halls, issues = Works (see Design).

**Schema enforcement.** Native fields first (goals/milestones, priority, status, parent). Then a small fixed label
set (`size:S|M|L`, `weight:<n>`, `risk:high`, `quest:council`) where the source has no field. The adapter validates
every snapshot against the protocol and never guesses: a task with no milestone or a milestone with no tasks
becomes a **repair quest** ("this Work belongs to no Hall, where should it go?"), answered as a sealed decision that
fixes it at the source. The schema goes into agent instructions, and an audit routine can check for gaps. Sizes
and weights are soft (derived when missing); only the structure (task → milestone → project) is required.

**Agents are external workers** (user): an agent can run anywhere (the local server's `claude` CLI, a cloud
runner, a teammate's machine). Each one **registers** with the protocol (name, skills) and polls the Quest server for its work (below); the game
invokes an agent by queueing work for it. Messages are signed
with a key per agent, and only registered agents are ever invoked. Agent controls in game (summon = wake, rest = pause, call back =
resume, recall one run = cancel, the Recall Bell = pause all) are protocol actions, so every source offers them;
each one is a sealed decision with a token readout. 

**How agents connect: a polling endpoint, nothing to install** (user, 2026-10-03). The Quest server exposes
`GET /api/agents/work?agent=<id>` (pending tasks and sealed decisions) and `POST /api/agents/progress` (progress,
results, new questions). Each agent gets a token when it registers. Any script, `curl` or agent framework can use it;
connections are outgoing-only, so it works behind routers. No connector package, no webhooks, no WebRTC for agents.
Work waits for the next poll (10–30 s), which is fine for agent work. Without the server, the player relays work by hand
through the `/work` page below.
Push delivery (Socket.IO or WebRTC) can be added later behind the same endpoints if polling ever feels slow.
**Manual relay page for browser-only play** (user, 2026-10-03): a `/work` route on the game site (works on GitHub
Pages, no server) lists queued work per agent as ready-to-copy prompts. The player pastes a prompt into their own
agent (e.g. Claude Code), then pastes the result back on the page, and it enters the protocol like any other
progress report (marked as relayed by the player). Results still pass the same validation and safety rules.

**LLM adapter (the game's own voice).** Separate from agents: agents do the work; the game's LLM writes NPC lines,
recaps, plans, the Cartographer chat and lore. It is the studio's `provider` plugin (`plugins/provider/<name>/`,
`lib/plugins.js`), extended with: `usage` (token counts per reply, for the token readout), `runs: server | browser`
(WebLLM on the static site), and per-model capabilities (structured JSON, context size, vision). The lore rules route
each job to a model with fallbacks: flavour lines and recaps → small local model → WebLLM → **templates** (0 tokens);
planner → bigger local model or Claude (asks first); Cartographer and lore → the chat panel's picker; Errand Trails,
weights and boss triggers → **plain rules, no LLM**. Guardrails: never writes or rewords decision text; structured
output is schema-checked before saving (fall back to templates); a filter keeps real product names out of lore;
timeouts; cached per item. Providers: Ollama (done), WebLLM, Claude via the `claude` CLI, a cloud-connector slot.

**Without Paperclip.** The Local Ledger holds Marches, Halls and Works (made in game). A small **agent registry** in
the ledger (name, role, skills, status) fills in for Paperclip's org chart; agents join by registering on the polling
endpoint. Work runs on the **built-in local runner** (the Quest server starts Claude Code through the `claude` CLI, as
wake does today) or on outside agents (polling, or the `/work` page). Controls become flags agents see on their next
poll: wake = queue work, pause = resting, cancel = run stopped; the Recall Bell rests everyone. Budget is our own
count from agents' reported usage plus the LLM adapter's `usage`, spent as Ember. Trade-offs: outside agents stop
only on their next poll (10–30 s; the local runner stops at once), and budgets are as accurate as agents' reports.

**Seeing the source in game.** A Ledger panel in the Keeper's Lodge shows the protocol view (Marches, Halls, Works,
Riddles, agents, the Beacon) for any source. With Paperclip present, the panel can switch to Paperclip's own page in
a frame (localhost only; it doesn't block framing).

## Safety (all accepted)
1. Only sealed choices reach the project.
2. True Sight shows the real text, verbatim.
3. Risk tiers: merge, deploy, delete and budget changes leave the game for a plain confirm; a never-in-game list.
4. An outbox with a recall window.
5. The budget is stamina: when it's empty, work pauses.
6. No XP for saying yes.
7. Autoplay never decides.
8. Stale questions expire.
9. Each sealed decision is written back to the issue as a comment.
10. Teammates' answers are shown, never overwritten.
11. The Recall Bell stops all work, from anywhere.
12. Agents work on branches, and merging always takes a human.

## Milestones
Each is shippable and tested on its own. Reuse what exists; don't rebuild it.

- **M0 Shared core.**
  - Create `public/core/` as render-free ES modules: a state store, an event bus, grid rules, the input map and
    storage helpers.
  - Move these out of `world.js` (`blocked`, `bfs`) and `3d/scene.js` (`free`, `tryMove`, the key map).
  - Both views import the core, and the 2D page moves to modules.
  - Done when both views play exactly as before.
- **M1 Protocol + sources (read-only).** Local Ledger and Paperclip adapters; schema validation and
  repair-quest detection; agent registry (read-only); the Ledger panel and the Paperclip frame.
  - `lib/protocol.js` (types and marks) and a `source` plugin kind in `lib/plugins.js`.
  - `plugins/source/paperclip`, built on `lib/paperclip.js` (`snapshot`, goals, issues).
  - `GET /api/protocol` plus the existing SSE stream; it computes weights, the backlog score and the Beacon.
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
- **M4 Questions, decisions, safety.** Plus the agent polling endpoint (register, work, progress) and the in-game
  agent controls.
  - Seal UI, True Sight and the outbox with recall.
  - Risk tiers and the never-in-game list.
  - Paperclip write-back (`comment`, `patchIssue`).
  - A teammate's existing answer is shown instead of overwritten; stale questions expire.
  - The Recall Bell, built from today's "send the guild home".
  - Ember as stamina from the company budget.
  - Riddle batches answered through NPCs.
  - An Errand Trail generator.
  - Speaking Stones and Lumi for delivery.
  - An interruption scheduler with tiers, frequency, quiet hours and never mid-battle.
  - Reuse the 2D `ui.js` dialog flows.
- **M5 Starting work.** Plus the built-in local runner and the agent registry for play without Paperclip.
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

## Effort estimate
In working sessions like today's (one focused build-and-test session each). Rough, with the risky parts named.

| Milestone | Sessions | Main risk |
|---|---|---|
| M0 Shared core | 1–2 | `world.js` is 1,527 lines of globals; moving it to modules without breaking 2D |
| M1 Protocol + two sources | 2–3 | two adapters (Local Ledger, Paperclip) mapping cleanly onto one schema |
| M2 Lore runtime (Ink) | 2 | moving all hard-coded text without changing what players see |
| M3 Map from protocol | 2–3 | laying out regions that grow and unfog nicely |
| M4 Questions + safety + agents | 4–5 | the largest: many flows, write-back, scheduler, agent link; must be bulletproof |
| M5 Starting work | 1 | small; reuses the studio chat |
| M6 Battle core, hybrid | 3–4 | combat feel needs tuning; boss and foe art (Blender plugin helps) |
| M7 Sealed Halls as dungeons | 3–4 | generating puzzles that are actually fun |
| M8 Progression | 2 | balancing difficulty against real work pace |
| M9 More modes + 2D parity | 2–3 | doing everything twice in 2D |
| **Total** | **~22–30** | |

The first playable version of the full loop (work → questions → boss → hall) is M0–M6: about 15–21 sessions.
Art for bosses and halls, and how much tuning the fun needs, are the biggest unknowns; feel tuning can add 20–30%.

## Open questions (ask when their milestone comes up)
- Towns inside a March: one per Sealed Hall, or per agent workplace? (M3)
- Can a player enter or practise in a locked hall, or is the door shut? (M7)
- Licences for inkjs and Tiled; whether Tiled maps are worth it over the code-built grid. (M2, M3)

## Verification
Per milestone, on the side server (a `claude-quest-studio`-style launch config with a scratchpad copy of `data/`,
never the real 4777 game), checked in the browser pane with no console errors:
- **M0:** both views behave as before (walk, NPCs, dialogue in 2D; weather and actors in 3D).
- **M1:** compare `/api/protocol` against MAX FE in Paperclip. Weights, the Beacon and the log match the issues
  and goals.
- **M4:** use a throwaway Paperclip company for write-back tests. Covers recall, the risk-tier confirm, and stale
  and teammate cases.
- **M6–M7:** script a boss with three fake questions. Check it pauses, the input lock works and retreat works.
