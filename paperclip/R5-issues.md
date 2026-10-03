# R5 issues for Quest Dev

Create these in Paperclip (company "Claude Quest", project "Claude Quest"), as a parent with three children in this
order, all assigned to Quest Dev. Already built: the R5 contract (`0e54f1d`, `d8c5270`) and `missions.js` with pressure
and the gate (`6b83994`).

## Parent: R5 Missions and the first Sealed Hall
Release R5 (PLAN-engine.md "Releases" and "Missions, Keepers and the Bridge"; HANDOFF.md "R5 checklist"). The children
are the rest, in order. Done when all children are.

## 1. R5 Keepers: summon with Ember, join on the first approved Work, release to the Hall of Champions
R5 checklist item 4. Pure logic and tests in `public/quest/keeper-controls.js`:
- summoning spends `rules.summonCost` Ember through `emberLeft`;
- a summoned Keeper joins (`joinedAt`, then free) when its first Work is approved;
- release sets `released`/`releasedAt` and never deletes.

Also Summon and Release buttons, each with an in-page confirm, in `keeper-hud.js`. The R4 controls already respect
these states (`f08151c`). No `boot.js`/`scene.js` edits. This issue comes first.

## 2. R5 UI: Missions tab on the notice board, mission HUD, briefing and debrief
R5 checklist item 5, without integration. Uses `missions.js` (`missionsOf`, `begin`, `tickMission`, `hearBriefing`,
`hearDebrief`, `pressure`, `gated`).
- `town-board.js`: a Missions tab grouped by saga, showing the countdown to `dueAt` and the pressure with its "why"
  line. When `gated()`, the lore tab and lore quests show the Haze line instead.
- A new `public/quest/mission-hud.js` showing the current mission and its state.
- The briefing and debrief run through `conversation.js`, spoken by the Work's Keeper.
- `public/quest/dev-missions.html` running on the sample Realm.

No `boot.js`/`scene.js` edits. Do this after issue 1.

## 3. R5 integration: wire missions, the pressure gate and Keepers into the game
Edits `boot.js` and `public/3d/scene.js`:
- Load play with `playFromSave` (warn, never refuse).
- Call `tickMission` on every ledger change.
- Mount the Missions tab and the mission HUD.
- The gate hides lore quests and the lore tab, but never `/work`, Riddles, the Lodge, the Recall Bell or saves.
- A finished saga opens its Sealed Hall (`status.js` `sealedHalls`).
- `npm test` must pass.
- List everything untested in the browser in `HANDOFF.md`.

Do this after issue 2.
