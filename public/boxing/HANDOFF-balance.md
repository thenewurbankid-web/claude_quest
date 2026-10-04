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
