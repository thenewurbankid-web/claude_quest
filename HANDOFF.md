# Quest (formerly Claude Quest): handoff (2026-10-02, evening)

**New session, start here.** Run with `npm start` (http://localhost:4777) or the `claude-quest` preview config.
Git repo: github.com/thenewurbankid-web/claude_quest (public). `config.json` is git-ignored; copy `config.example.json`.

## NEXT SESSION START HERE: the Quest engine (user, 2026-10-03)
**R4.5 in-game Bridge client built (CLA-8, 2026-10-04, `038fc85`):** `public/quest/bridge-client.js`: `loadBridgeSettings`/`saveBridgeSettings` (localStorage only), `reportToQueue` (via `pasteResult`, marked relayed 'bridge'), `createBridgeClient` (client id `game`, takes `connect` = the mqtt browser build, injected), `mountBridgePanel` (on/off, status, login, placeholders, registrations/refusals with True Sight; returns `ring()`/`open()` for the Bell). `npm test` 196 pass; client tested against the real Bridge over WebSocket. **Untested in the browser:** the whole panel, 375px, and the mqtt browser bundle (`node_modules/mqtt/dist/mqtt.min.js` is not served by `app.js`/`dev/static.js` yet). **For CLA-9:** serve/load the bundle and pass `connect`, mount the panel, call `ring()` when the Recall Bell rings, call `refresh()` when Keepers change, and give the Bridge a ledger snapshot (open item 1 above).
**R4.5 Bridge process built (CLA-7, 2026-10-04):** `bridge/` (`node bridge/index.js`; `bridge/bridge.js` is `createBridge`): aedes over TCP (4780) and WebSocket+HTTP (4779) on 127.0.0.1, `topicAllowed` on every publish/subscribe, bad agent reports and registrations are replaced by a `refused` message on the status topic, good reports republished with `{queueId, keeperId, report}`, Bell/open via `bridgeHalt`, offers only through `bridgeMayOffer`. Paperclip: `GET /paperclip/api/...` passthrough and `POST /paperclip/comment {issueId, kind: decision|report, body}` (comments only, needs header `x-quest-token` = webhook token). Own git-ignored files `bridge/credential.json` and `bridge/ledger.json`. Deps: `aedes`, `websocket-stream`. `npm test` 189 pass, tested over loopback only; not tried against the real Paperclip or a browser. **Open for CLA-8/9:** (1) the Bridge holds no ledger: it reads a snapshot from `bridge/ledger.json`; the game must write or send one (no topic for it exists yet). (2) The credential has one MQTT login, so roles come from the client id (`game`, `agent-<keeperId>`): an agent holding the password could claim `game`. Separate game/agent logins would need a contract change; user's call. (3) Agents also see the unused `status` refusals. **Next:** CLA-8 in-game client and settings.
**R4.5 contract done (CLA-6, 2026-10-04, `152c47e`):** `contract.js` "R4.5: the Bridge" (topics `quest/<realm>/...`, `topicAllowed`, `Registration`, `bridgeMayOffer`/`bridgeHalt`, `reportFromBridge` via `parseReport`, `Credential`, `bridgeBindHost`/`isOwnMachine`), `sample-bridge.json`, four Bridge safety tests; `npm test` 181 pass. Slices: CLA-7 Bridge process (`bridge/`), CLA-8 in-game client and settings, CLA-9 integration (`boot.js`), in that order. Nothing here touches the browser. **Next:** CLA-7 (needs `aedes`, `mqtt` and its WebSocket adapter only). `PLAN-engine.md` has the user's 2026-10-04 decisions uncommitted; commit it with the next change.
**Worktree mode fixed (2026-10-04 ~01:00, user asked).** The cause: with no project workspace policy, Paperclip ran every issue in the shared main checkout. The project now has `executionWorkspacePolicy` set to `{enabled, defaultMode: isolated_workspace, workspaceStrategy: git_worktree from 3d-world, quest-dev/{{issue.identifier}}}`, and CLA-7/8/9 were detached from their old main-checkout workspaces. Paperclip cuts branches from `origin/3d-world`, so AGENTS.md now has each run fast-forward to the local `3d-world` (`002e8f9`). CLA-7 and CLA-8 are running in `.paperclip/worktrees/quest-dev/`; CLA-9 stays blocked, waiting on CLA-8. Open review asks: CLA-7 needs the safety fixes (login on every connection, an Origin check on WebSocket upgrades, start halted, and `POST /paperclip/comment` guarded by the login and the game Origin). CLA-8 (`038fc85`, already on 3d-world, 196 tests pass) needs `publishKeepers`: the retained Keeper-list topic in the contract, with a test that only `game` may publish it. The monitor is stopped; restart it in the next session. CLA-10 is unassigned until CLA-9 is done.
**Main session duty (2026-10-04, user): monitor and review Quest Dev, merge its branches.**
- Quest Dev now runs up to 2 issues in parallel, each in a worktree `.paperclip/worktrees/quest-dev/<CLA-n>` on branch
  `quest-dev/<CLA-n>` cut from `3d-world` (agent config `git_worktree`, `paperclip/AGENTS.md`). It never merges.
- On each finished branch: review the diff against the plan's safety lines, run `npm test`, merge into `3d-world` with
  `--no-ff`, and comment on the issue. CLA-8's first run started before the switch and commits straight to `3d-world`.
- Just in time: assign the next issue when the one it follows is done. CLA-10 (Paperclip plugin) is unassigned until
  CLA-9 is done. Paperclip's recovery reassigns an unassigned issue that another issue waits on, so CLA-9 stays
  assigned and its run only comments "waiting".
- Answer Quest Dev's questions on the issue only when PLAN-engine.md already settles them, citing it; take real design
  choices to the user.
- State on 2026-10-04 22:41: CLA-6 is done. CLA-7 (Bridge process, `83edeaf`) was reopened for the review fixes: login on
  every connection, Origin check, start halted, guarded `POST /paperclip/comment`, game-published Keeper list. CLA-8 is
  in progress; CLA-9 and CLA-10 are todo.

**Done (2026-10-04): Quest Pulse, a local Paperclip dashboard (user).** `node dev/dashboard.js` (launch config
`quest-pulse`, port 4795) serves `dev/dashboard/index.html`, refreshing every 5 s:
- Quest Dev's pulse, releases R0 to R9+ (matched to Paperclip issues by title prefix), issues with their latest comment,
  runs, and the latest `3d-world` commits.
- `/pc/*` is a GET-only proxy to Paperclip, because Paperclip sends no CORS header.
- The Sprite Lab is kept at `dev/dashboard/local/sprite-lab.html`, which is git-ignored because its sprite pack's
  licence forbids sharing it.
- The three Quest artifacts are republished as "retired" pages that point here.
- The public name is now **A Vibe Called Quest** (`8ba453d`); code names are unchanged.
- Open: Paperclip's parent issue CLA-1 is still `todo` although CLA-2..4 are done.

**R5 integration done (CLA-4, 2026-10-04):** `boot.js` loads missions with `playFromSave` (warns, never refuses), runs `tickMission`/`joinSummoned`/the gate on every ledger change and every 30 s, mounts the HUD and the board's Missions tab (Go on it → briefing by the Keeper; debrief when all Works resolve). Gated: lore riddles refuse `quest:talk`, Town news shows the Haze line, and `scene.js` keeps the player inside the old town (`quest:explore`). A finished saga opens its Sealed Hall through `sealedHalls` (no extra wiring). `npm test` 170 pass. **Untested in the browser:** everything here: the Missions tab, Go on it → briefing, debrief, HUD position (top-left, may overlap other HUDs), the explore lock at the town edge (set a Hall `dueAt` soon so pressure >= 0.75), summoned Keeper joining, 375px. **Next:** R5 browser check on `quest-static` (4790), then R4.5 The Bridge.
**R5 UI built (CLA-3, 2026-10-04):** `mission-hud.js` (HUD, `briefingLines`/`debriefLines` spoken by the Work's Keeper through `conversation.say`, `talk`), a Missions tab in `town-board.js` (opts `missions`, `gated`, `onBegin`; gated Town news shows the Haze line), and `dev-missions.html`. No `boot.js`/`scene.js` edits. `npm test` 170 pass. **Untested in the browser:** the whole Missions tab, HUD position (top-left, may sit near other HUDs), briefing/debrief boxes, 375px. **Next:** CLA-4, R5 integration (also: the gated Town news must hide lore quests too; open the Sealed Hall on a finished saga).
**R5 Keepers built (CLA-2, `f637232`, 2026-10-04):** `keeper-controls.js` adds `summon` (spends `summonCost` Ember, refuses a poor Well, empty or taken name), `joinSummoned` (a summoned Keeper joins when a Work it holds is `done`; integration must call it on every ledger change) and `release` (never deletes; refused while a live run exists). `keeper-hud.js` has Summon (form, then a confirm naming the Ember) and Release (press twice) in the Keepers dialog. `npm test` 168 pass. **Untested in the browser:** the Summon form and Release buttons (`dev-keepers.html`), 375px layout. **Next:** CLA-3, R5 UI (Missions tab, mission HUD).
**Latest (2026-10-03, end of R4 session):** R4 tidy committed (`f08151c`); a parallel session merged its plan
(`2b00dc3`: R4.5 The Bridge, R5 Missions, R6 Drama, R7 Own Realm, R8 The Source, R9+) and committed the R5 contract
(`0e54f1d`). **User: build R5 Missions next, before R4.5** (after their R4 play notes). R5 plan: PLAN-engine.md
"Missions, Keepers and the Bridge" and ~/.claude/plans/study-this-and-see-calm-giraffe.md ("Step 2").

**R5 checklist (from the planning session, 2026-10-03).** Already in the contract (`0e54f1d`): `Work.parentId` (a
mission is a parent Work and its children; the saga is their Hall), `MISSION_STATE`/`MISSION_MOVES`,
`validateMissionPlay` (`play.missions`, one mission at a time), `Hall.dueAt`/`Work.dueAt`, `summonCost` in
`emberLeft`, `summoned`/`released`, `suggest` in `parseReport`, the event hash chain (`chainEvent`/`verifyEvents`,
stamped by both stores). To build:
1. Contract: `rules.pressureGate` (start 0.75) and pressure weights; `play.missions` in `makeSave`, checked on load.
2. `public/quest/missions.js`, pure, returning `{ play, events }` like `boss.js`: `missionsOf` (grouped by Hall, game-only
   Works left out), `missionWorks`, `begin` (shelves the current one), `tickMission` (active ↔ cliffhanger on an open
   real Riddle, → debrief when every Work is resolved), `hearBriefing`, `hearDebrief`.
3. `pressure(ledger, hallId, now, rules)` (open Work weight against days left to `dueAt`, with a "Why?" line) and
   `gated()`: locks lore quests, the lore tab and exploring past the hub; never `/work`, Riddles, the Lodge, the Bell
   or saves (safety test).
4. Keepers: summon (spends Ember), join on the first approved Work, release to the Hall of Champions; R4 controls
   already respect the statuses (`f08151c`).
5. UI: a Missions tab on `town-board.js` (by saga, countdown, pressure), briefing/debrief through `conversation.js`
   spoken by the Work's Keeper, the current mission on the HUD; a finished saga opens its Sealed Hall (`status.js`).
6. Tests: `test/missions.test.js` plus the gate's safety test; browser check on `quest-static` (4790), never 4777.

**Latest (2026-10-03, R4 session, later): R4 Bring your Keeper is built and integrated.** Slices (a) `/work` page
(`public/work.html`, `quest/work-queue.js`, `quest/work-page.js`; `work.html?sample` loads the sample) and (b) Keeper
controls (`quest/keeper-controls.js`, `quest/keeper-hud.js`, `dev-keepers.html`) merged into 3d-world. Wiring: E next to
a Keeper with no Riddle → 'quest:keeper' {slot} → Start work dialog; Ember meter + Keepers + Recall Bell (key B) dock
bottom left. User chose: a lapsed lease sends only an in-progress Work back to todo (blocked/in-review stay). `npm test`
147 pass. Checked on 4791: wake, copy, done paste → in review, Ember 94→91, bell confirm, 375px, no console errors.
**Open:** walking up to a Keeper and pressing E untested by walking (event dispatched); `startable` offers in-review
Works (ask whether that's wanted); the dock sits close to the bottom key hint on desktop; contract follow-ups from the
slices (`manualReport` helper, `LIVE_QUEUE` shared constant, optional `cancelledAt`, the bell comment in contract.js
says "every leased item" but it cancels queued/leased/lapsed). **Next:** the Paperclip connector release, or R5.

**Earlier (2026-10-03, R4 session): R4 contract done.** User decisions: pastes are read from one fenced `quest-report`
block (manual kind pick as fallback, paste kept verbatim); the Paperclip connector moves to its own release after R4.
`contract.js` adds `REPORT_KIND`, `REPORT_INSTRUCTIONS`, `parseReport` (last block wins, never repairs), `branchFor`,
`KEEPER_CONTROL`, `emberLeft` (rolling-window Ember from reported tokens), Keeper status `wandered`, late pastes on a
lapsed lease, `work.*`/`keeper.*`/`bell.rung` events, rules `leaseHours`/`emberMax`/`tokensPerEmber`/
`emberWindowHours`; validation refuses game-only Works in the queue and returned items without a result. Sample:
`public/quest/sample-work.json`. `npm test` 123 pass. **Next:** the R4 slices side by side: (a) the `/work` page + lease
(lapse → `wandered`) ∥ (b) start work from an NPC, the Ember readout, Keeper controls and the Recall Bell; then
integration.

**Latest (2026-10-03, R3 session): R3 Lore quests is built; what is left is the user's one-time setup.** Contract
(`'lore'` mark source, `isGameOnly`, area-lore entry/index/`cells.json` shapes, Work `endsAt`), client
(`public/quest/area-lore.js`: geohash-4 cell + 8 neighbours, reads `cells.json` first so no 404s, calendar fallback,
Town news March/Lore Hall mapping), board (`public/quest/town-board.js`, `B` in the hub, E or tap; lore Riddles are taken
on there, never carried by Keepers), generator (`area-lore/`: Open-Meteo, iCal/RSS, allowed kinds only, Ollama with
template fallback, checked for real with qwen3:4b). `isGameOnly` filters bossScore, shouldSummon, riddleWeight,
realmStats, answerTimes, digest and the Beacon (the last two beyond the plan's list, so errands never turn it amber).
`npm test` 117 pass; checked on 4793 with `?lore&cell=gcpv` (take on, answer, seal, Work done, Beacon/Haze unchanged,
375px, no failed requests) and on the plain URL (calendar). The fight's Battle fields and tests are untouched.
**Open:** (1) the user creates the two repos, deploy key and runner (area-lore/README.md, steps 1-6), then sets
`LORE_BASE` in boot.js (step 7); until then the board shows the calendar. (2) Walking to the board and pressing E was
not tested by walking (the event was dispatched). (3) When the Paperclip connector posts Decisions, it must skip Works
where `isGameOnly` is true. (4) Resolved lore Works stay in the ledger; prune them when saves get archiving.
**Next after that: R4 (Bring your Keeper),** per PLAN-engine.md's order.

**Latest (user, 2026-10-03, end of the fight session): the R2 playtest no longer blocks R3.** "Don't stop for
playtest, we tweak numbers later." **Next: build R3 Lore quests** (PLAN-engine.md, "R3 Lore quests"; contract step
first). The user plays PLAYTEST-R2.md whenever they like, and fight numbers (`DEFAULT_RULES` Lantern/bites) get tuned
from that later. The fight now has heads and a Lantern (PLAN-fight.md); R3 touches boss.js/contract.js, so keep the
Battle fields `heads`, `lantern`, `lanternMax`, `pushed`, `bitten` and their tests intact.
**Read `PLAN-engine.md` first.** Approved plan: a customizable engine driven by lore files, where Paperclip work
becomes Zelda-balanced play. Paperclip company = Realm (world); project = team = March (region); milestone = Sealed
Hall (dungeon, locked until the work is done, then won through play); blockers ambush; a weighted backlog summons a
boss that pauses for each real question. A Quest protocol sits between the game and the work (Paperclip is the
first `source` plugin). One render-free shared core for the 2D and 3D views. Ink for lore files. 12 safety rules.
Each project is a campaign win; Sigils, trophies and the Champions League live in the save file. No creature
collecting (PLAN-adventure §5 rewritten).
- **No server except a Paperclip connector** (user, 2026-10-03; see "No server" in PLAN-engine.md): the game becomes
  browser-only (static files + IndexedDB). Paperclip goes through a small optional Node connector that only passes
  reads through and posts sealed comments (Paperclip sends no CORS header), built in R4 or later. Agents come in only through the `/work`
  copy-paste page,
  and `app.js` keeps running today's game until the browser version replaces it. No new features go into `app.js`.
- **Releases run in parallel** (see "How a release runs" in PLAN-engine.md): contract step first, then each slice in
  its own worktree side by side, then integration with the safety tests. Only integration edits `public/3d/scene.js`.
- **Next: R0 "The Beacon lights up"** (see Releases in PLAN-engine.md): in the 3D view, browser only, from the Local
  Ledger: a minimal ledger in IndexedDB, a Ledger panel to add Halls and Works, a sample Realm, then the Beacon, the
  in-game log (open + last 5 resolved), a Sealed Hall per Hall (locked/open), Keepers busy/free. Serve the static
  files with a dev-only file server and a throwaway ledger, never the real 4777 game. Then R1 Riddles, R2 the
  Gloamwyrm (playtest against the written criteria).
- **R0 "The Beacon lights up" is done (2026-10-03):** contract (`public/quest/contract.js`, sample Realm), the
  IndexedDB ledger (`ledger-idb.js`, DB `quest-ledger`) with the Ledger panel (`ledger-panel.js`), the rules
  (`status.js`: Beacon red = blocked critical/high or failed Work, amber = open/deferred Riddles, other blocked or in
  review, else gold; worst March wins; a Hall opens when achieved or all its Works are resolved) and the HUD
  (`beacon-hud.js`). `quest/boot.js` mounts both on the 3D page and lights a Beacon above the Keeper's Lodge.
  `npm test` 20 pass; checked on `quest-static` (4790) with no console errors. Small follow-ups: `remove('events')`
  needs the hidden autoIncrement key, and loading the sample over a non-empty ledger takes a second click.
  **Next: R1 "Riddles"** (contract step first: anything R1 needs that the contract lacks).
- **R1 contract step is done (2026-10-03):** `contract.js` now has `outboxUntil` (the recall window), `fadeNote`,
  `Decision` on Works (a sealed Riddle written back, rule 9; `sent` for the later Paperclip comment), True Sight's
  `Flag` shape (computed, never stored), the `Digest` shape, `stewardOf` (only the steward, or the Realm owner, seals;
  others propose), `DEFAULT_RULES` (outbox seconds, defer/fade delays, confirm words, never-in-game list) and the
  Riddle events (recalled, sealed, returned, faded, proposed). The sample adds a deferred Riddle (r4) and w2's
  decision. `npm test` 24 pass.
- **R1 "Riddles" is done (2026-10-03):** four slices built side by side and merged: `riddles.js` (risk tiers, True
  Sight flags, Riddle NPCs, answer/propose/defer, return and fade, boss weight), `conversation.js` (the docked box),
  `outbox.js` (Lumi's recall window, sealing, write-back, unblocking), `digest.js` (session log, "while you were
  away", question-to-answer time), each with a dev page. Integration: `boot.js` wires them; `scene.js` makes Keepers
  carrying an open Riddle stop and show a "!", with a placeholder villager by the Lodge for Riddles with no Keeper;
  E (or the Talk button) opens the Riddle, movement is locked while the box is open. A never-tier Riddle can still be
  deferred. `test/safety.test.js` covers rules 1, 2, 3, 4, 8, 9, 10. `npm test` 70 pass; checked on 4790: answer →
  outbox → sealed → decision on the Work, and the confirm view for the high-risk Riddle; no console errors.
  Gaps: nothing raises new Riddles yet (the Ledger panel can't add one; the sample's come preloaded), the Keepers'
  stats board in the Lodge isn't built (answerTimes exists), and the Beacon log's Riddle rows aren't clickable.
- **R2 playtest criteria approved** (PLAN-engine.md, "R2 playtest criteria"), and **the R2 contract step is done
  (2026-10-03):** `contract.js` has `BATTLE_PHASE`/`BATTLE_MOVES` (fighting, question, lodge, won, retreated; retreat
  from any turn), the `Battle` record (play state in the save's `play.boss`, never ledger data), `validateBattle` (it
  can't fall or be won while a Riddle is unresolved; confirm/never Riddles only pause for the Lodge), the boss rules
  (threshold 3 on the sum of `riddleWeight` over open and deferred Riddles, hp per weight, +0.25 strength per retreat,
  mash bonus at most 15% of a hit) and the boss events. `npm test` 72 pass. The sample Realm already crosses the
  threshold. **Next: R2's parallel round** (boss ∥ weights ∥ placeholder art), then tuning, then the playtest (gate).
- **User feedback on R1, done (2026-10-03):** the conversation box shows where a Riddle comes from (March › Hall ›
  Work, plus "More about this task": status, priority, Keeper, blockers, age, earlier decisions; `riddleContext`),
  **Other…** for your own answer, and **Ask back…**: a question to the agent on the Work (`asks` on the Riddle,
  `askBack`/`replyToAsk`, events `riddle.asked`/`riddle.replied`); the Riddle stays open and shows "Waiting on
  <Keeper>", and the reply is pasted by hand until R4's /work page delivers it. The Beacon panel and the "While you
  were away" card both start folded to small chips with counts (the user found the open panel too invasive).
  `npm test` 74 pass.
- **R2 parallel round + integration done (2026-10-03, built in one session, not in worktrees, user's choice):**
  `boss.js` (bossScore with per-Work/per-Riddle reasons, bossSize, hazeLevel, summon/face/settle/retreat; hits are each
  Riddle's weight share of maxHp, so deferred Riddles add hp but are never faced), `playtest.js` (the R2 backlog:
  sample + p1 normal, p2 risk:high, p3 never, times relative to now; `heavier` for session two), `battle.js` (the
  full-screen box: Face / Gather light (Space, ≤15%) / Retreat, Lodge pauses for confirm/never, a 1.1 s Gloamwyrm beat
  between turns, `applyTalk` shared with boot), `gloamwyrm.js` (Three.js placeholder serpent + Haze motes),
  `dev-battle.html`. The conversation box takes `lockMs` (input lock, extended while keys keep coming; the plain
  confirm is locked afresh and focuses Back). Integration: `boot.js` sends `quest:haze`, cuts in after a 2.5 s warning,
  keeps play in localStorage `quest-play`, 10 min calm after a fight; `?playtest` / `?playtest=heavier` loads the
  backlog after a confirm. `scene.js` fog closes in and turns violet with the Haze. `npm test` 82 pass. Checked on
  4791 (`quest-static-2`; 4790 belonged to another chat): win, retreat (returns ×1.25), 375px, no console errors.
  Known gaps for tuning: light drains fast (0.18/s), a recalled answer keeps the hit it landed, the Haze is faint at
  night, the Lodge is the plain box rather than a place. **Next: tuning, then the playtest (gate).**
- **R2 tuning pass (2026-10-03):** the Haze follows only OPEN Riddles (`bossScore().openScore`), so a fight won by
  putting everything off still clears the sky (put-off ones keep summoning the next one); it also shows as a violet
  vignette from `boot.js`, since the fog never reaches the close camera. A recalled answer takes its hit back
  (`battle.dealt`, `settle().healed`), and answers sealed, recalled or put off mid-fight are picked up on your turn.
  Light drains at 0.06/s only on your turn and can be gathered during the Gloamwyrm's beat. The "fed by" line names
  the top Works. `npm test` 84 pass. Open: a fake three-question fight probably runs 1.5–3 min, under the 3–6 min
  target; measure it in the playtest before padding anything. The Lodge stays the plain confirm (rule 3).
  **Next: the playtest (gate):** `/?playtest` on a static server, then `/?playtest=heavier` a day later.
  Checklist: `PLAYTEST-R2.md` (fill it in during both sessions).
- **Bigger world (user, 2026-10-03):** the 3D hub is 48x32 (was 24x16). The old town sits in the middle (`hub.js`
  `TOWN` offset) with its tree wall opened into a hedge; roads run to every edge; a wood and hamlet north, a lake west,
  an orchard and fields east, a meadow south. `START` and `KEEPER_SPOTS` come from `hub.js`; `scene.js` reads the
  width from the map. 6 animals, 12 open-grass trees. Paused for it: the pre-R3 gaps (raise Riddles from the Ledger
  panel, clickable Beacon log rows, the Keepers' stats board), next in line.
- **Pre-R3 gap 1 of 3 done (2026-10-03): raise Riddles from the Ledger panel.** `raiseRiddle` in `riddles.js` (text
  verbatim, choices trimmed and de-duplicated, "Ask me later" always last, optional high risk, event `riddle.raised`);
  a todo/in-progress Work becomes blocked, the mirror of sealing unblocking it, so the Riddle stands in the world.
  "Raise a Riddle" form in `ledger-panel.js`; a failed save keeps the typed question. `npm test` 86 pass. Checked on
  `quest-static-3` (4793; 4790 and 4791 belonged to other chats): raised on Pricing page, Work blocked, no console
  errors; typing into an open fight question by accident answered nothing. Next: clickable Beacon log rows, then the
  Keepers' stats board.
- **Pre-R3 gap 2 of 3 done (2026-10-03): the Beacon log's Riddle rows are buttons.** A click sends `quest:talk`
  (`from: 'log'`); an answerable Riddle opens in the conversation box as if you'd walked up to its Keeper, and any other
  one gets a short Lumi note on where it stands (`riddleStanding` in `riddles.js`: put off and when it returns, in the
  outbox and when it seals, sealed by whom with what, faded with its note, or open on a Work no one waits on). Clicks
  are ignored during a fight. `npm test` 87 pass; checked on 4793 (open, deferred, sealed rows; no console errors).
  Next: the Keepers' stats board.
- **Pre-R3 gap 3 of 3 done (2026-10-03): the stats board in the Keeper's Lodge.** Stand at the Lodge door (the
  prompt says "Stats board (E)"; a Riddle beside the Lodge comes first) and press E or tap. `realmStats` in
  `digest.js`: last 7 days and all time (Riddles raised, answered, put off, sealed, faded; Keepers stuck and going
  again; Gloamwyrms beaten and retreats; play sessions and time played; median question-to-answer time), plus "Who
  waits on you" per Keeper. `stats-board.js` draws it (Escape, Close or a click outside). Raising a Riddle now also
  logs `agent.blocked`. The door area is wider than the 2x2 plot because the house draws larger than its cells.
  `npm test` 89 pass; checked on 4793 by walking there, at 375px, no console errors. **All three pre-R3 gaps are
  closed; R3 waits only on the R2 playtest gate.**
- **Playtest session 1, fight 1 attempt 1 failed (2026-10-03):** the player retreated at 15/49 because it was unclear
  what to do, and asked "where are these questions coming from?" (see PLAYTEST-R2.md). **Next: the fight wording fix
  in `battle.js`, fake data kept (user's choice):** the opening line says the questions are the Keepers' (agents')
  work waiting on you; each Face button names who asks and on which Work instead of "asked here · weight 1"; the Lodge
  pause says why it pauses (money, deploys and the like are answered calmly, not mid-fight). Then replay fight 1 on a
  static server with `?playtest`.
  **Done (2026-10-03):** the three lines are in `battle.js` and checked in a fight on 4793. Next: the player replays
  fight 1. The player also said the fight "has to be interesting"; that's a bigger design question, not scoped yet.
- **The fight has heads and a Lantern (2026-10-03, PLAN-fight.md, approved and built):** one Gloamwyrm head per stuck
  Work, named with its Keeper; after a turn that lands a hit, living heads bite your Lantern (snap / dim / echo from
  why the Work is heavy); a cut head frees its Keeper, who guards. The order you cut is the tactic. An empty Lantern
  pushes you back to the Lodge with no strength penalty (`boss.pushed`). "Tend the Lantern" spends light. `boss.js`
  `beat`/`tend`/`headsOf`; `battle.js` Lantern bar and head lines; `gloamwyrm.js` extra heads drop when cut. Playtest
  ages changed (6/18/30 h; heavier defers p1 twice, p2 once). `npm test` 96 pass; checked on 4793 (dev-battle: a
  full fight, 375px, no console errors). Then Claude played `?playtest` (fixed: a recall gives the bite's Lantern
  back; a put-off question no longer says its Keeper is going again) and tuned the Lantern to 3 + 1 per head so a
  careless order in `?playtest=heavier` is pushed back (checked in the browser). 98 tests. **Next: the player replays fight 1
  with `?playtest`** (PLAYTEST-R2.md), then tune the numbers. R3 (Lore quests): the Battle record now carries
  `heads`, `lantern`, `lanternMax`, `pushed`.
- **R3 is now "Lore quests" (user, 2026-10-03):** players with no work get game-only quests from shared area lore
  (local weather and happenings, written once per geohash-4 cell by Ollama on a self-hosted runner). Design and run
  order in PLAN-engine.md, "R3 Lore quests"; Bring your Keeper and everything after it moved down one (R4–R7+).
  It starts after the R2 playtest gate, like any R3. It touches contract.js, boss.js, riddles.js, digest.js, scene.js
  and boot.js.
- Later decisions in PLAN-engine.md: gaps, risks and open questions decided 2026-10-03 (see Risks and gaps), True
  Sight's two-line bubbles at the bottom of the screen, saves carry the full ledger, split into parts with archiving,
  LLM adapter routing.
- The game-studio plugin work below continues alongside (step 2, the Blender plugin, is scoped but not started).
- The real game on 4777 was restarted from this session on 2026-10-03 and now runs the studio code.

## NEXT SESSION START HERE: game studio as plugins (user, 2026-10-02, latest)
Goal: players can **fully customize their game** (art and lore) from inside it, through inline chats. The whole
thing is **open source and user-customizable**: every tool and every AI provider is a **plugin**, so users can bring
Blender or any other 3D tool, any 2D/tile editor, and any model.
- **Plugin kinds** (one folder each, e.g. `plugins/<kind>/<name>/` with a small manifest + JS module; the core only
  knows the interface):
  - `tool3d`: a request becomes a model file (.glb). First plugin: **Blender** (installed at
    /Applications/Blender.app/Contents/MacOS/Blender, not on PATH). The server runs it headless
    (`Blender -b --python <script>`); the AI writes the bpy script; the output goes into public/assets/imported and
    shows in the 3D viewer. Aim for KayKit's style: low poly, flat colours or a gradient atlas.
  - `tool2d`: sprites **and tiles**. First plugin: a **pixel editor built into the asset editor** (pencil, fill,
    palette, layers, frames, 16 px tile grid; works on the real sheets; the chat can draw and edit directly). Later
    plugins: Aseprite, LibreSprite, Pixelorama.
  - `provider`: chat models. Ship **all three** and let the user pick per chat, with a model dropdown: **Ollama**
    (local, free; list models from /api/tags; installed: qwen3:4b, qwen2.5-coder:7b/1.5b, qwen2.5vl), **in-browser
    WebLLM** (free), and **Claude via the `claude` CLI** (Opus/Sonnet/Haiku; spends the user's usage, so it asks
    before each request). Leave a slot for cloud connectors.
  - **Lore generator** (asked 2026-10-02): a chat that writes and edits the lore files (`areas/<id>.md`, `lore/`),
    using the same provider picker. It shows a preview or diff before saving. Fantasy tone; no real product names.
- **Chat panel** (shared): inline beside the canvas, viewer or lore text, with the provider + model picker. A reply
  can produce an asset or lore, refine it ("taller chimney"), keep it, or place it in the world.
- **Step 1 done (2026-10-02): plugin interface + chat panel + Ollama.** `plugins/<kind>/<name>/{plugin.json,index.js}`
  (spec in `plugins/README.md`), loaded by `lib/plugins.js`; local-only endpoints `GET /api/studio/plugins`,
  `GET /api/studio/models?provider=`, `POST /api/studio/chat` (NDJSON stream; JSON + same-host Origin required).
  `plugins/provider/ollama` lists chat models and streams replies. qwen3 on Ollama 0.34 reasons even with
  `think: false`, so thinking models get `think: true` and the reasoning shows only as "thinking… (n chars)".
  Shared panel `public/studio/chat.js` (`mountChat(el, { system, key, placeholder })`): provider + model picker
  (remembered), streaming, Stop, Clear, history per surface in localStorage, asks before `cost: "paid"` providers.
  Mounted in the asset editor in place of the Generate placeholder. Tested on a side server (port 4781): models list,
  a full reply, Stop mid-stream, wrong-origin and wrong-type rejected. **The real game on 4777 needs a restart.**
  Replies don't produce assets yet; that comes with the Blender plugin (step 2). Browser-side providers (WebLLM)
  will need a `runs: "browser"` manifest field and a client loader; not designed in yet.
- **Build order:** plugin interface + chat panel + Ollama provider → Blender plugin until one house comes out end to
  end → Claude + WebLLM providers → lore generator → built-in pixel/tile editor with chat drawing → placing assets
  in the world. Scope each step before building it; the user adds ideas quickly, so re-scope instead of building
  everything at once.
- **Installs:** the user said "you can install whatever you want" (2026-10-02). That covers the KayKit Medieval
  Hexagon Pack (free, CC0, 33 MB, kaylousberg.itch.io) for the smooth houses, Lodge and well.
- **Licence conflict to raise:** open source vs the Sunnyside / zedpxl / ToffeeCraft / Humble Pixel licences, which
  forbid redistribution. Packs as user-installed plugins (git-ignored, like public/packs today) fit this; CC0
  KayKit can ship. Confirm with the user before publishing.
- Server note: the editor's "Save into the game folder" needs the server restarted (another session runs it on 4777).

## smooth buildings + an asset editor (user, 2026-10-02 late night)
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

## Asset editor (2026-10-02, steps 1 and 2 of 4 done)
`/editor.html` (linked as "Editor" in the 3D view's nav). Files: `public/editor.html`, `public/editor/{main,sheet,model,store,zip}.js`,
`lib/editor-assets.js` (+2 lines in app.js).
- **Browse:** library of every pack PNG (grouped by pack and folder; friendly empty state when `public/packs/` is missing),
  every .glb in `public/assets/3d`, and imports. Sheets open in a crisp pixel viewer: wheel zoom, right/Space/Pan-drag,
  8–64 px grid, hover pixel and cell, drag-select (snap optional) → `[x, y, w, h]` with copy and "download selection".
  Models open in an orbit viewer with mesh/triangle/bone stats; KayKit rig clips (manifest.animations) are offered
  for any skinned model whose bones match, Idle_A autoplays, speed and loop controls.
- **Import:** drag-drop or picker (.png/.glb/self-contained .gltf) into IndexedDB (`quest-editor`); optional
  "save into the game folder" POSTs to `/api/editor/import` → `public/assets/imported/` + its `manifest.json`.
  The endpoints live outside the `routes` table (not reachable over the hosted link), need octet-stream and a
  same-host Origin. **The server must be restarted to get them**; until then the page falls back (main tileset +
  manifest models only, checkbox disabled).
- **Export:** download one asset, or "Export library" as a store-only zip (manifest.json with credits + files).
  Licensed pack art is excluded unless ticked.
- **Next:** step 3, place assets in the world (feed a selected rect or imported model into the 3D scene / manifest
  roles); step 4, generation. The Generate panel is a disabled placeholder; ask the user how generation should fit
  (saved preference: real assets first, minimal AI generation) before calling any model or paid API.
