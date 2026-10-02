# Claude Quest: handoff (2026-10-02, evening)

**New session, start here.** Run with `npm start` (http://localhost:4777) or the `claude-quest` preview config.
Git repo: github.com/thenewurbankid-web/claude_quest (public). `config.json` is git-ignored; copy `config.example.json`.

## Next up, in the order the user gave them
1. **Hosted game, local poller (new phase, plan it first).**
   - Hard rule from the user: **no incoming connections to the Mac.** The local server only makes outgoing requests:
     it pushes a trimmed snapshot to the hosted game and pulls the player's actions (answers, quests, STOP, settings)
     on each poll. The browser only talks to the hosted game, so it works from anywhere, including a phone.
   - Open decisions for the user: where the hosted part lives (needs storage, e.g. Cloudflare Workers + KV, Supabase,
     a small Node app); what data leaves the Mac (suggest lore text + short subtext, not raw transcripts); login for the
     page and a secret token for the poller.
   - A claude.ai Artifact probably can't be the host for a localhost bridge; with this outgoing-only design it might, if
     the poller can reach its data API. Check before choosing.
2. **Editable names + project-aware lore.** Rename towns, Claudes, NPCs and events in game and on `/settings` (player
   names win). The storyteller (Ollama qwen3:4b) generates names and lines for each Claude, boss, NPC and event from the
   real project and situation, cached by id so they stay stable, with the real fact as grey subtext (the plan's
   cross-cutting "standalone game, real data as subtext" item). No Claude tokens.
3. Older backlog: battles phase (proposed), spread Claudes out (Phase 3), parallax/RS feel (3b), mounts (5), plugin.

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
