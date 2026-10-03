# R2 playtest: the Gloamwyrm

The gate before R3 (criteria in PLAN-engine.md, "R2 playtest criteria"). R2 passes only if every line holds.
Run the static server (`node dev/static.js 4791`, or the `quest-static-2` preview), never the real 4777 game.

## Session 1 (date: 2026-10-03)
Open http://localhost:4791/?playtest and accept the confirm. Walk around for about 10 s; the Gloamwyrm cuts in.

### Fight 1: play it straight (criteria 1, 2, 3, 6)
- Attempt 1 (2026-10-03, on 4793, read from the event log; not a pass): cut in 06:18:19, 10 s after the session
  started. Plant catalogue (p1) answered 06:19:49 and sealed 10 s later. Payment provider (p2) put off with "Ask me
  later" at 06:20:14 instead of answered in the Lodge. Staging server (p3) never resolved. Retreated 06:20:16 with
  15/49 hp left, about 2 min in. The player first said "all lines held"; the log disagreed and the player confirmed
  this run as fight 1. Replay with `?playtest` (it resets the backlog and the retreat count).
  Why (player): unclear what to do, so the Payment provider was put off and the fight abandoned. Possible miss against
  criteria 1 and 3: check that the fight says how to land a hit and what the Lodge pause asks of you.
- [ ] Time at cut-in: ______
- [ ] Before facing anything, open "Why?" under the hp bar. I can name which Works feed it and why it's that size.
- [ ] Plant catalogue (asked in the fight): picked a real answer.
- [ ] Payment provider (risk:high): the fight paused, and I answered it in the Lodge.
- [ ] Staging server (never list): it only showed where to answer it. "Ask me later" landed the hit.
- [ ] Mashed Space / "Gather light" while the Gloamwyrm moved.
- [ ] Time when it fell: ______ (target 3–6 min)
- [ ] The Haze visibly lifted afterwards.
- [ ] Never waited more than 5 s with nothing to do.
- [ ] No pause felt rushed. I answered at least one question I'd otherwise have left.

### Fight 2: try to break it (criteria 4, 5)
Reload with `?playtest` to reset.
- Note (2026-10-03): user played fight 2 and reported "working fine"; individual lines not yet confirmed.
- [ ] Mashing Enter/Space as a question opens never picked an answer.
- [ ] On Payment provider, mashing Enter on the confirm screen never sealed.
- [ ] Answered one, then retreated mid-fight. Reload WITHOUT `?playtest` (it would reset the retreat count) and wait out
      the 10-minute calm: it came back stronger, I can explain how, and my earlier answer wasn't asked again.
- [ ] Answered one, then hit Recall on the outbox strip within 10 s: the Gloamwyrm got those hp back.

### Phone (criterion 8)
- [ ] Viewport menu → Mobile: played one question by touch, with nothing overflowing or hard to tap.
- [ ] Reduced motion on (OS setting): still playable.
- [ ] No console errors.

### Rating (criterion 1)
- "I'd fight it again": __ / 5 (pass at 4+)
- Notes:

## Session 2, a day later (date: ______)
Open http://localhost:4791/?playtest=heavier.
- [ ] It's bigger, and I can say why (the "Why?" line).
- [ ] Time to win: ______ (target 3–6 min)
- [ ] I want to play tomorrow (criterion 7). One thing I look forward to: ______
- Notes:

## Result
- [ ] Every line holds: R2 passes, R3 may start.
- Misses (rethink before R3, see PLAN-engine.md "Risks"):
  - Possible: fight 1 attempt 1 was abandoned because it was unclear what to do (wording of the fight and the Lodge pause).
