# Making the fight interesting: Keepers and heads (approved and built, 2026-10-03)

The user picked this direction on 2026-10-03, after fight 1 attempt 1 ("unclear what to do", "where are these questions
coming from?") and "it has to be interesting". Today a turn is: pick a question, answer it, optionally mash Space.
Nothing changes when you pick one question over another, and the agents behind the questions never show up.

## The idea in one line
The Gloamwyrm grows **one head per Work** that feeds it. Each head is a stuck Keeper's task, and it bites. Cutting a
head means resolving its questions, and **that Keeper is then free and fights beside you.** The choice each turn is
**which head to cut next**, not how hard you hit.

## What changes
1. **Heads.** One per Work in `bossScore().works`, labelled with the Work and the Keeper stuck on it ("Pricing page:
   Ada is stuck"). A head with several questions needs all of them resolved. A Lodge-tier head (risk:high or
   never-list) is marked as such before you pick it.
2. **The Lantern (your side).** You get a Lantern bar, which is new. During the Gloamwyrm's beat between turns, each
   living head bites it, and how hard depends on why that Work is heavy, so the "Why?" line becomes something you
   feel:
   - *waiting a long time* (age) → **Dim**: drains the Lantern.
   - *put off before* (deferrals) → **Echo**: bites harder each beat it's still alive.
   - *plain* → **Snap**: one small fixed bite.
   Bites happen only in the beat between turns, never while a question or the Lodge is open, and never against a
   clock. The Gloamwyrm acts once per turn, not once per second.
3. **Freed Keepers.** When a head's last question is resolved, its Keeper walks into the fight (placeholder figure
   beside you plus a line: "Ada is going again, and she stands with you"). Each freed Keeper **guards**: it takes
   one bite per beat off the Lantern. Keepers never deal damage (hits still come only from resolving questions).
4. **Gather light** keeps its role and also refills the Lantern during the beat. That makes Space a real decision:
   save light for a bigger hit (≤15%, unchanged), or keep the Lantern up.
5. **The order is the tactic.** Cut the heavy Echo head before it grows, or the cheap Snap head to get a guard sooner,
   or go to the Lodge head early because it's the heaviest. The questions stay the same; you choose the order.

## Safety rules, unchanged
No timers on questions; the input lock stays; confirm/never questions still pause for the Lodge; hits come only from
resolving questions and never depend on the answer; "Ask me later" still cuts the head, but an Echo head that comes
back next time is heavier; retreat works from any turn and keeps every answer.

## Decided (user, 2026-10-03)
- **Can you lose?** An empty Lantern pushes you back to the Lodge (`boss.pushed`, `pushed: true` on the battle) with
  every answer kept and **no strength penalty**. The stats board counts push-backs on their own row.
- Keepers only guard in this pass.

## As built (details settled while building)
- Heads bite only in the beat **after a turn that landed a hit** ("struck, it bites back"). Closing a question
  without answering, asking back, or leaving the Lodge pause costs nothing, so reading carefully is never punished.
- A guard takes `guardBlock` (1) off the beat's total bite, not a whole head's bite.
- Bites: snap 1; dim 1 + one per started day waiting (max 3, from 12 h); echo 1 + times put off, +1 per beat alive.
- Lantern = 3 + 1 per head (was 6 + 1; the user asked for losing to be reachable). "Tend the Lantern" spends the
  light meter for up to +2 instead of the hit bonus, which is how a bad order can still be rescued.
- The playtest backlog's ages are now 6, 18 and 30 h (one snap and two dim heads); the heavier one puts p1 off twice
  and p2 once (two echo heads, one dim). Simulated over every order with Lantern 6 (no tending): first session costs 2 to 5,
  so no order loses (the worst ends at 1 of 6); heavier session, three of six orders are pushed back (anything
  that leaves the twice-put-off plant head for last but one), the others win. Tune in the replay.

## Scope (if approved)
- Contract step: `contract.js` adds `heads`, `lantern` and `freed` to the Battle record, plus the head kinds and
  Lantern numbers in `DEFAULT_RULES`; `validateBattle` checks them.
- `boss.js`: `heads(battle, ledger)`, `beat(play)` (the bites after guards), `settle` frees Keepers. Pure, with tests,
  including a safety test that bites never happen in `question`/`lodge` phases.
- `battle.js`: a head list in place of the flat Face list, the Lantern bar, freed Keepers in a row, bite lines in the
  Gloamwyrm's beat.
- `gloamwyrm.js`: one placeholder head mesh per Work; a cut head drops away.
- Starting numbers: see "As built" above.
- Then replay fight 1 with `?playtest` against the R2 criteria (3–6 min, never 5 s with nothing to do).

Not touched: the Riddle rules, the outbox, the conversation box, `scene.js`. Lore quests (another session) may also
edit `boss.js` and `contract.js`: check `git log` before starting.
