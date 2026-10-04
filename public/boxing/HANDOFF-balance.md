# Balance notes (Boxing Sim Dev, worktree `boxing-balance`)

## BOX-4: counter-punching vs pressure (2026-10-04) — step 1 done, step 2 waiting on the user

No tuning is committed. `physics-engine.js` is unchanged.

Batch: `node scripts/boxing-balance.mjs [--n 200] [--rounds 6] [--stats 50,50,50,50] [--tactics a,b] [--engine path]`.
Every ordered tactic pair, N seeded fights (seeds 1000+i), both fighters at 50/50/50/50, same tactic all 6 rounds.
Slow (about 160 s for n=40, all 25 pairs). `--engine` loads a patched copy of the engine, which is how proposals are compared.

### Baseline (n=40, all stats 50)
- Mean win share per tactic: counter 0.82, outbox 0.49, pressure 0.47, body_attack 0.29, recover 0.17. Overall KO rate 0.34.
- Pressure loses 100% to both counter and outbox (n=40). Landed per fight: pressure 118 vs counter 341 (land rate 0.24 vs 0.76); vs outbox 113 vs 355 (0.25 vs 0.67). Those fights end in a KO 100% of the time, in round 4.6–5.0.
- Pressure beats body_attack (95%) and recover (100%). Body_attack vs outbox/counter ends in KO about 95% of the time, round 5.3–5.8.
- recover vs recover: 0 punches thrown (range 1.7 m exceeds every punch's reach), so those fights are draws.

### Why (pressure v counter, 20 fights, per punch type)
- Pressure's cross lands 6% (margin −53 ms), jab 45%, body 27%. Counter's own plain punches land 38–81%.
- Counter's counter-punches land 97–100% (margin +58 to +92 ms) and make up most of its landed shots (about 3500 of 5700 thrown). Every slip opens a window of 120+280·ringIQ ms (260 ms at IQ 50), `TACTICS.counter.counter` is 1.0, and the counter's wind-up is x0.7. So each of pressure's many whiffs feeds a near-certain hit.
- Pressure at rangeM 0.95 never throws hooks or uppercuts: gap 0.55 m x pathFactor 1.45 = 0.80 m > hook reach 0.72 m. Its weights for hook 3 and uppercut 2 are dead, so it is mostly crosses, the worst-landing punch.
- KO pace: damage is `joules/400`. At 340 landed hits in 6 rounds that is lethal by round 5 whenever one side lands 3x more.

### Variants tried (scratch copies, not committed). Counter-fight columns are pressure v counter
| id | change | pressure v counter landed | pressure v counter win (P/C) | mean win share P / C | KO rate |
|---|---|---|---|---|---|
| base | none | 119 v 341 | 0 / 100 % | 0.47 / 0.82 | 0.34 |
| v1 | damage divisor 400 → 600 | 148 v 470 | 0 / 100 % | 0.47 / 0.82 | 0.06 |
| v2 | counter wind-up x0.7 → x0.9; TACTICS.counter.counter 1.0 → 0.6; window 120+280·IQ → 80+200·IQ | 122 v 338 | 0 / 100 % | 0.48 / 0.83 | 0.29 |
| v3 | v2 + pressure rangeM 0.95 → 0.85 (hooks and uppercuts now reach) | 167 v 338 | 0 / 100 % | 0.48 / 0.83 | 0.37 |
| v4 | v3 + divisor 600 | 205 v 443 | 0 / 100 % | 0.47 / 0.83 | 0.06 |
| v5 | v4 + counter wind-up x1.0 (no bonus) | 202 v 428 | 0 / 100 % | 0.34 / 0.80 (4 tactics) | 0.07 |
| v7 | v5 + pressure adds +30 ms to the defender's reaction window (new `crowdMs` on the tactic, in `computePunch`) | 420 v 336 | 3 / 73 % | 0.36 / 0.75 (4 tactics) | 0.00 |
| v8 | as v7 with +15 ms | 304 v 381 | 0 / 100 % | 0.34 / 0.80 | 0.00 |

(v6 had the `crowdMs` sign wrong: pressure landed 9 %.) Only a pressure-specific accuracy edge (v7) moves pressure toward parity; the divisor only controls KO rate; counter-window tuning alone doesn't help. Even v7 leaves counter ahead on the scorecards (landed 336 v 420 but the 10-point scoring weights joules), and body_attack falls to 0.10 in v5–v8 because it also lost its easy prey: not examined further.

### Proposal (for the user to pick; none applied)
1. KO pace: divisor 400 → 600 (v1/v4). Fights go the distance (KO rate 0.34 → 0.06). Pick 500 for about 15–20 % KO; not tested.
2. Pressure range 0.95 → 0.85 so its hook/uppercut weights work (v3).
3. Counter nerf: wind-up bonus x0.7 → x0.9, `counter` 1.0 → 0.6, window 120+280·IQ → 80+200·IQ (v2). Alone it changes little; it matters only with 2 and 4.
4. A pressure-specific edge, `crowdMs` 15–30 ms (v7/v8), so that closing the distance costs the defender reaction time. This needs a small new field and a one-line change in `computePunch`; it stays deterministic. This is the only change that closes the gap.
5. Leave recover v recover (0 punches) as is, or give recover a jab-reach range. Not part of this issue.

Not tested: other stat mixes (all runs at 50/50/50/50), fights where tactics change by round, the browser. n=30–40 per pair, so single-pair percentages near 0 or 100 are stable but 0.2–0.6 values carry roughly ±0.1 noise.

### The user's decisions (balance)
- 2026-10-04: The game targets phones. Batch scripts stay headless (node only, no DOM/Babylon); balance work changes nothing in rendering. `scripts/boxing-balance.mjs` already complies. Still waiting on which of A/B/C/D to apply.

### BOX-4 applied (2026-10-04): A475 + B + D + pressure-mirror
Committed in `physics-engine.js`: damage divisor 400 → 475 (`DAMAGE_DIVISOR`), pressure `rangeM` 0.95 → 0.85, new pressure `crowdMs: 30` added to the defender reaction window in `computePunch`, but only when the defender's tactic is not pressure. Deterministic (no new rng). Test added: crowd applies vs outbox, not vs pressure. `npm test`: 97 pass.

Batch (n=40/pair, stats 50 all): win share pressure .48, outbox .45, counter .79, body_attack .28, recover .17; pressure v counter landed 399 v 351, win 5 / 85 %; pressure v outbox 0 / 88 %; pressure v pressure 483 v 483 (land rate 0.78). Overall KO rate 0.19 (in the 0.10-0.25 band).

Follow-ups (not blockers):
- **KO cliff:** divisor 500 gives KO 0.09, 475 gives 0.19, 450 gives 0.32. KOs are nearly all round-6 stoppages in lopsided pairs, so small divisor changes flip whole pairs. Re-measure after any tuning of damage or tactics.
- **Counter still leads on scorecards:** counter wins about 85 % of decisions v pressure and 100 % v outbox even with landed counts near parity. Needs a later pass (counter window / `counter` weight / scoring weights).
- Not tested: other stat mixes, per-round tactic changes, the browser.

### BOX-15 sim side (2026-10-04): contact data in impact events
User decision (2026-10-04, via the main session): BOX-15 option (a). The visual parts (contact, hit reactions, knockdown falls, footwork, fatigue visuals in `arena-babylon.js` / `boxer-model.js`) go to Boxing Dev after BOX-14. This issue is the sim side only, in `physics-engine.js`.

Added to every `impact` event record (read-only; no state or rng change):
- `contact: { region, x, y, heightM, dirX, dirY }`. `region` is the target (`head`/`body`) when landed, `guard` when blocked, `air` when slipped. `x`/`y` are ring metres on the defender's surface, `TARGET_DEPTH_M` (0.15) toward the attacker (guard +0.1; air offset sideways past the head, more for hooks). `heightM` is 1.6 for head shots, 1.15 for body (`HEAD_HEIGHT_M`, `BODY_HEIGHT_M`). `dirX`/`dirY` is the unit direction of travel, attacker to defender, at the arrival tick.
- `energy01 = min(1, transferredJoules / 170)`. 170 J (`ENERGY_REF_J`) is about p95 of landed punches (landed range 44-225 J, median 101 J, n=9903), so a median hit reads about 0.6.
- `knockout`: this hit took the defender to 0 health. The fight ends the same tick (`round_end` with reason `ko`), so a renderer should start the fall from this impact. There is no get-up in the sim; a KO ends the fight.
`serializePunch` is unchanged, so `bm.exchange.v1` telemetry is identical.

Spacing and ring bounds: both already existed (`_move` clamps to the ring minus `BODY_RADIUS_M`; `_separate` keeps centres at least 0.55 m apart). One gap closed: `_separate` now re-clamps both fighters to the ring, so a push can't carry anyone past the ropes. It never fired in 9.1M ticks (24 seeds x 3 tactic pairs x 3 stat mixes), and the full-run digest is identical before and after (4304305d...). Closest approach in that run was 0.78 m; ring excursion 0.

Tests (`npm test`: 105 pass, was 101): impact events carry contact/energy/knockout and are consistent with outcome and health; the contact point lies 0.15 m from the defender centre on the attacker side; fighters stay inside the ropes and at least 0.55 m apart on every tick across 3 tactic pairs x 6 seeds; the sim is pinned: a seed-11 full-fight hash (rounds, result, positions every tick) equals the hash from the engine before this change, and a listener that mutates the event (`contact.x`, `energy01`) leaves the output unchanged.

Not covered here (Boxing Dev, after BOX-14): all rendering of contact, reactions, falls and footwork; "contact timing matches sim events within a frame" can only be tested once the renderer reads `contact`. Untested in the browser: nothing was changed in rendering. Open question for the visual side: the sim has no get-up and no knockdown short of KO, so "get up or stay down" would need a sim design decision (user's call).

- 2026-10-04 (BOX-15, user): fights move to photoreal 2D projection. The sim-side events (contact point and region, `energy01`, `knockout`, ring bounds, body distance) stay and now drive which rendered clip plays and when. The 3D visual items (contact, reactions, falls, footwork, fatigue) become clip selection and timing in the 2D renderer, owned by Boxing Dev under a new issue. Suggested mapping for that renderer: `contact.region` picks the clip family (head / body / guard / air), `energy01` picks light vs heavy, `contact.dir*` picks the facing, `knockout` picks the fall, and `arriveTick` is the timing anchor.

## BOX-22: street-fight moveset in the sim (2026-10-04)
Commit ff459d4 on `worktree-boxing-balance`. Files: `physics-engine.js`, `scripts/boxing-balance.mjs`, `test/boxing.test.js` (122 pass, was 105). All deterministic (same rng, +-*/ and sqrt only); no rendering touched.

### What exists
- **Strikes** (`PUNCHES`): haymaker, overhand, hook_body, shovel, short_upper, check_hook (counter-only, thrown off a slip), cheap_shot (only after a clinch break, foul, x1.5 damage). `double_jab` and `flurry` (2-4 chained punches) are weight keys, not PUNCHES entries.
- **Dirty boxing / defence / movement** as `action` events: circle_off, shove, clinch, forearm_frame, push_off (street, then a queued punch), ref_break (sanctioned), shell, pivot, feint (type shoulder|step), taunt, foul. Slip, roll, pull_back, parry, block and shell are the `defense` label on impacts.
- **Rulesets** (`RULESETS`, constructor option `ruleset`, default `street`, unknown names fall back to street): street = 1.4 s clinch, shoves and full cheap shots, no ref; sanctioned = 0.7 s clinch ended by the ref, no shoves, cheap shots x0.25 as often, each foul costs 1 card point (`summarizeRound.fouls`).
- **Tactics**: new `brawl` and `dirty_boxing`; the four old tactics got move rates, `defendMs` and per-style counter weights.
- **Composure**: taunt drains it, the victim reads slower; taunter is exposed (+45 ms window). Feints widen the next punch's window (less for high Ring IQ). Shell halves landed damage.

### Event contract (for BOX-17 / BOX-18)
- `impact` (unchanged shape) gains `move`, `hand` (lead|rear), `combo {id,index,length}` (id unique per fight), `defense`, `foul`. `type` stays the legacy family (jab/cross/hook/uppercut/body) so `PUNCH_CLIP[type]` and `HAND` keep working; use `move`+`hand` for the specific clip.
- `action`: `{kind, type, corner, against, hand (lead|rear|both), target, energy01, dir, contact:{region,x,y,heightM,dirX,dirY}, round, tick, startTick, endTick}` plus `points` on foul. Tick resets each round.
- `snapshot()` adds `ruleset` and per fighter `composure`, `action`, `clinch`, `shell`.

### Numbers
- `damageDivisorFor(roundSeconds)`: linear 54 at <=35 s to 475 at 180 s (replaces `DAMAGE_DIVISOR`). 35 s x 3 rounds: overall KO rate 0.16 (band 0.10-0.25), mean win share pressure .67, outbox .59, counter .56, body_attack .55, dirty_boxing .61, brawl .39, recover .05 (n=20). Old 180 s x 6 default (n=10): KO 0.25, counter .75, dirty .70, brawl .18, pressure .37.
- Pairwise results are still rock-paper-scissors with extremes (reaction-window model makes close range decisive). Recover almost never wins. Check hook is rare (about 0.04 a fight), cheap shot about 0.3 a fight.
- Pin test re-pinned (seed 11) since the sim changed; it now also mutates `action` events to prove they are read-only.
- Batch: `node scripts/boxing-balance.mjs --n 40 --rounds 3 --seconds 35 --moves [--ruleset sanctioned] [--set a.b.c=v]`.

### Open / for others
- `index.html` has no venue concept and builds the sim without `ruleset` or `roundSeconds`; both peers must send and use the same `ruleset` in the P2P `start` message (normalize it against `RULESETS`). Default is street.
- Untested: anything in the browser (no renderer reads `action` events or `move` yet), other stat mixes, per-round tactic changes, `--ruleset sanctioned` balance (only unit-tested).
- Tactic rebalance beyond the KO band and 0.37-0.66 mean shares is not attempted; user call if pairwise extremes matter.

## BOX-20: shorter fights (2026-10-04, sim side)
`physics-engine.js`, `test/boxing.test.js` (126 pass, was 122), `scripts/boxing-balance.mjs` (defaults now 3 rounds x 35 s). Deterministic, no rendering touched.

### What exists
- Defaults: `DEFAULT_ROUNDS` 3, `DEFAULT_ROUND_SECONDS` 35, `DEFAULT_BREAK_SECONDS` 10 (constructor option `breakSeconds`). `FIGHT_FORMATS`: `street_early` (2 rounds, 1-2 allowed), `street` (3), `title` (5, 3-5 allowed). Nothing in `index.html` reads them yet.
- Break: recovery between rounds is `break / (break + 15)` of the missing gas and composure (40 % at 10 s, the old fixed value). The sim does not simulate the break itself; the UI shows the 10 s corner timer and calls `startRound` after it.
- `sim.runToEnd(pick?)`: sim to result. `pick(sim)` returns `{red, blue}` per round; without it each corner keeps its last tactic. Same output as stepping round by round (tested).
- Fast-forward is a UI job: step the sim more ticks per frame (it is deterministic, so any rate gives the same fight). `runRoundToEnd()` skips a single round.
- `damageDivisorFor(roundSeconds, rounds = 3)` now scales with total fight seconds (54 at 105 s, 475 at 1080 s, floor 12), so a 5-round title fight no longer KOs 69 % of the time. Before: 3 x 35 s unchanged (54).
- Scorecards: when cards are level (usual over 1, 2 or 4 rounds), the fighter with clearly more landed score (joules + 25 per landed shot, over 5 %) wins; within 5 % is a draw. Method label stays `Decision`.

### Numbers (294 fights per row: every tactic pair x 6 seeds, stats 50, 35 s rounds)
| rounds | KO | decision | draw |
|---|---|---|---|
| 1 | .06 | .92 | .02 |
| 2 | .14 | .77 | .09 |
| 3 | .17 | .81 | .02 |
| 4 | .17 | .73 | .11 |
| 5 | .17 | .81 | .02 |
Before: KO 0 / 0 / .17 / - / .69 at 1 / 2 / 3 / - / 5 rounds, 2-round draws 31 %. The remaining draws are mostly recover v recover (no punches thrown). 1-round fights rarely KO; raise their damage if you want more.

### Open
- Untested in the browser: nothing here touches the UI. `index.html` still passes `rounds` from its select and no `roundSeconds`/`breakSeconds`, so it now runs 35 s rounds with the old round counts (option values 1-6). Wiring the format picker, corner timer, fast-forward and a sim-to-result button belongs to Boxing Dev. Both P2P peers must send the same `rounds`, `roundSeconds`, `breakSeconds`.
- Not tried: other stat mixes, the sanctioned ruleset, tactic pair extremes (unchanged from BOX-22).

## BOX-27: shipped to main (2026-10-04)
Rebased BOX-20/22 onto origin/main (BOX-15 was already there). Conflict was test-only: both sides appended tests to `test/boxing.test.js`; kept both. One fix beyond the merge: Boxing Dev's BOX-17 test requires every `PUNCHES` key to have an `ATTACK_CLIP`, so `public/boxing/clips2d.js` now maps the seven BOX-22 punches onto existing clips (haymaker/check_hook -> hook, overhand -> cross, hook_body/shovel -> body, short_upper -> uppercut, cheap_shot -> jab). Placeholders: Boxing Dev should author or pick proper clips. `npm test` 302 pass. Untested in the browser.

## BOX-31: sim locomotion, fewer purposeful moves (2026-10-04)
`physics-engine.js` (`_move`, `_push-off`), `test/boxing.test.js` (335 pass, was 334; new locomotion test, shell test now pressure v counter, hash re-pinned). Deterministic, no rendering touched.

### What changed in `_move`
- **Held intent**: radial and lateral intent are re-decided every 400-900 ms (seeded, `MOVE_HOLD_*`), not every tick. After a burst the fighter holds for one interval unless more than `MOVE_FORCE_M` (0.6 m) out of range, so two fighters with different ranges can't dance back and forth.
- **Dead zone with hysteresis**: a stride starts when 0.14 m too far or 0.3 m too close (`MOVE_START_FAR_M` / `MOVE_START_NEAR_M`; closing is cheap, backing off needs more) and ends inside 0.06 m (`MOVE_STOP_M`).
- **Lateral circling** is a burst or a hold (probability `0.4 x tactic.lateral`, max 0.3), at 0.4 of foot speed (`MOVE_SPEED_SCALE`). The direction flip and `circle_off` event are now decided at the same cadence.
- **Acceleration limit** 5 m/s^2 on a separate `footVel` (shoves and pivots still add on top, so they stay snappy). Velocity into the ropes is dropped (no running on the spot at the ropes; before, `vel` stayed high while the position was clamped).
- Mobility while punching 0.2 (unchanged). Push-off shoves 0.45 m, was 0.7 (the queued punch otherwise fell out of reach, since fighters no longer snap back in).

### Numbers
`node scripts/motion-metrics.mjs 11` (35 s round, pressure v outbox; the round ends at 27.7 s now): steps/s red 3.65 -> 2.67, blue 4.07 -> 2.93. Other pairs (`measureRound`, seeds 11/12): counter v body_attack 3.1-3.7 -> 1.1-2.8; brawl v dirty 2.5 -> 1.2-2.0; outbox v outbox 3.3-3.9 -> 2.5-3.0. Sim path per fighter is about 0.25 m/s (was ~0.7) and the fighter is still about 65 % of the time. Idle test unchanged (0 steps, 0 foot reversals). Hip/head reversals/s in a round went UP (2.35/3.32 -> 3.68/4.66) because still fighters now show the render's idle sway (idle test: 5.08/4.42); I read it as sway, not shiver, but it is not "no regression" on that raw number.

**The target (<= 2.2 steps/s) is not met by the sim alone, and the rest is a render bug.** While the sim position is exactly still (checked: x/y constant for 4 s), the feet keep marching, a step every 0.3 s. Cause in `footwork.js`: a step lands past its spot (`overshoot`), so the other foot's lag is now on the far side, and the step-drag rule (`follow`, threshold `followFrac` 0.3 x stance width) fires from that overshoot, which makes the first foot follow, and so on. Any one genuine step starts a perpetual march. A static-body unit test doesn't show it because it never starts. Experiment (not committed, `footwork.js` is Boxing Dev's): `const follow = vd && this.stepped && ...` (follow only while the body is travelling) gives, with this sim, pressure v outbox seed 11 1.91 / 2.24, counter v body_attack 1.0 / 0.6, brawl v dirty 0.8 / 1.0, outbox v outbox 1.2 / 1.5. Boxing Dev should apply that or an equivalent (overshoot shouldn't count toward follow lag) under a new issue.

### Balance (3 x 35 s, 40 seeds a pair, stats 50)
| | pressure | outbox | counter | body_attack | recover | brawl | dirty |
|---|---|---|---|---|---|---|---|
| before | .66 | .60 | .55 | .58 | .03 | .37 | .64 |
| after | .68 | .49 | .55 | .49 | .40 | .23 | .65 |
Overall KO rate .16 -> .21 (band .10-.25). Recover stops being a dead tactic (.03 -> .40, it is now slower to chase); brawl drops from .37 to .23 (it can no longer snap back to range, and it eats 60-90 % KOs from pressure/outbox/counter). Brawl below the earlier 0.37-0.66 band is a user call (e.g. raise its damage or reach).

### Pin test
`PINNED_SEED_11` re-pinned: the sim now moves differently by design (positions are in the hash). Shell test now uses pressure v counter (shell is rope-only and fighters are no longer pinned to the ropes in counter v counter). Clinch test passes with the shorter shove.

### Untested
Anything in a browser; other stat mixes; sanctioned ruleset balance; the `--moves` rates (clinch/shove counts) before/after.

Shipped: claude-quest main 369e8c1 (rebased on 93047f0, 335 tests pass), bring-the-ruckus 1f70c6b (live: https://thenewurbankid-web.github.io/bring-the-ruckus/). demo-e2e not run.

## BOX-34: brawl buffed back into the band (2026-10-04)
`physics-engine.js`, `test/boxing.test.js` (335 pass; `PINNED_SEED_11` re-pinned). Board decision on BOX-31: brawl must be viable.

### What changed
- Brawl `defendMs` -20 -> -34. Note the sign: `guardMs` is ADDED to the defender's reaction window, so negative means brawl needs LESS time to defend, i.e. it is a tougher defender (chin / shrugging shots off), not an open guard as the doc comment says. Positive values made brawl worse in tests.
- Haymaker: `massFactor` 1.55 -> 1.8, `gasCost` 2.8 -> 2.0. Overhand `gasCost` 2.1 -> 1.7 (pressure also throws it).
- Bug fix exposed by this tuning: `_separate` could leave fighters overlapping when one was clamped on the ropes (the rope clamp undid the push). The other fighter now takes the remaining push, along the wall in corners. The existing "never overlap" test caught it on one seed.

### Numbers (3 x 35 s, stats 50; mean win share per tactic, KO overall)
| | pressure | outbox | counter | body_attack | recover | brawl | dirty | KO |
|---|---|---|---|---|---|---|---|---|
| before (n=40/pair) | .68 | .49 | .55 | .49 | .40 | .23 | .65 | .21 |
| after (n=60/pair) | .68 | .40 | .52 | .42 | .37 | .45 | .66 | .18 |
Outbox, body_attack and recover paid for it (still inside .37-.66, recover on the edge). Rows tried: defendMs -38 gave brawl .49 but recover .36; -40 alone .49; haymaker/overhand changes alone moved brawl only .23 -> .28, so the damage/gas changes are small helpers and the tougher defence does the work.

### Recover (.40 now .37): does it win by doing nothing?
No. It throws about a third of the punches outbox does and still lands 0.66 of them (outbox v recover, n=60: recover 38.5 landed at .66 rate, outbox 10.5 at .12). It stands at 1.45 m with `counter: 0.5` and jab-heavy weights, so a fighter who walks in (outbox at 1.25 m, pressure, dirty) eats counters and loses the scorecard; recover v recover and v counter throw almost nothing (~12 landed) and win on the few exchanges. Proposed fix (not applied): drop recover `counter` 0.5 -> 0.3 and `gasRegen` 1.7 -> 1.4, or widen the scorecard's penalty for fighters who barely engage. User call.

### Untested
Browser; other stat mixes; sanctioned ruleset. Not changed: `defendMs` doc comment (wrong sign wording).
