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
