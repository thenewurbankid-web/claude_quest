# Claude Quest: handoff (2026-10-02)

**New session, start here.** Run with `npm start` (http://localhost:4777) or the `claude-quest` preview config.

## What exists and works
- `app.js`: the server. It scans every 15s, narrates with Ollama `qwen3:4b`, and runs the control channel.
  `server.js` is the OLD server and is superseded. Delete it once you've confirmed nothing needs it.
- `lib/collect.js` reads transcripts, git, docs and worktrees (`git worktree list` plus their transcript dirs).
  It also detects test/build failures, loops, stalls and the folder each session started in.
- `lib/lore.js`: game rules.
  - The Long Night: the usage limit, but only if no other transcript moved after the notice.
  - Camps and hamlets: worktrees.
  - Claude states.
  - Bosses: Sphinx (question), Red Golem (2+ failing checks), Ouroboros Wyrm (loop), Stalling Fog (stall).
- `hook/live.js`: installed in `~/.claude/settings.json` for UserPromptSubmit, PreToolUse and PostToolUse.
  - prompt/post: delivers inbox messages, mid-turn when posting.
  - pre: denies tool calls while the STOP banner is up for the project.
  - Skips Paperclip prompts. Backup is at `settings.json.bak-claude-quest`. `hook/deliver.js` is old and unused.
- `public/world.js`: the current client. `public/game.js` is old and unused.
  - Areas, camps, a walking Claude per live session, bosses with HP and step missions.
  - Courier and Claude run to you with news and replies.
  - Waystones (attune, then warp; dark at night), Rifts to camps, world map, trainer card, badges.
  - Flowers per commit, statues per victory, rain over boss towns, night veil.
  - Autoplay after 60s idle, which never answers anything.
- Wake: `claude -p --resume <sid>` from the session's origin folder. Only from an explicit in-game confirm. It spends Claude tokens.
- Auto-answer was built, then removed at the user's request.

## v2 progress (plan: `~/.claude/plans/deep-yawning-mountain.md`)
- **Phase 1, server side: done 2026-10-02.**
  - `lib/paperclip.js`: loopback-only client, `snapshot()` (fails soft), and idempotent `ensureGuild`/`ensureArea`.
  - Paperclip now has a company "Claude Quest" with one agent "Quest Dev". Settings per the owner's choice, mirroring
    Line's agents: claude-sonnet-5, skip permissions, `project_primary` (claude-quest isn't a git repo), 200 turns /
    1h, heartbeat off. Instructions are in `paperclip/AGENTS.md`.
  - The project "Claude Quest" has workspace = this folder.
  - `data/world.json` is the new save file: `paperclip.{companyId,agentId}` and `areas[]`. Only claude-quest so far.
  - `app.js` polls `guild` (the snapshot) every scan into `world.guild`.
  - Routes: `POST /api/guild/mission` (createIssue, assigned to the agent with status todo, so it wakes and SPENDS
    TOKENS), `/api/guild/send` (comment + wakeup, spends tokens), `/api/guild/stop` (`{on}` pauses/resumes the agent;
    `{issueId}` cancels its run and the issue).
  - Tested: snapshot up and down, validation, pause/resume. Mission and send weren't tested live, to avoid spending tokens.
- **Not yet:** the client doesn't call the guild routes. The game still reads the 5 `config.json` projects. Phase 2 swaps
  areas to `data/world.json` and wires the UI (accept mission, send Claude, STOP → guild routes). `startRun` is still there.

## Open requests, not started (in the order the user gave them)
1. **Use Paperclip for management and orchestration.** It lives at `~/Repositories/construct/packages/tools/paperclip`
   with a local API at 127.0.0.1:3100. Investigate first. Decide which of wake/stop/command/missions it replaces.
2. **Start over with one project: this game (claude-quest) itself.** It's a NEW GAME where the user sets up projects
   *through gameplay and lore*, instead of the current fixed 5-project `config.json`. This conflicts with the earlier
   "fixed list" answer; the newest instruction wins.
3. **Management/settings page.** Configure projects and directories, manage instructions, load a project into the game,
   game settings. Suggested mechanism: markdown/JSON files in the repo the game reads.
4. **Minimap in the HUD** (the big map exists: menu → Map).
5. **Stop projects and tasks.** A project-level STOP banner exists. Per-task/session stop and "retire a project" don't yet.
6. **Battles phase (proposed, not approved).**
   - Turn-based boss fights where each move is a real action.
   - Collectible "Sprites" hatched from merged branches and cleared bosses.
   - Gyms as project milestones.
   - Note: the user's first message said "not monster and battle"; they later asked for battles.
7. Maybe ship it as a Claude Code plugin later.

## Known rough edges
- Claudes crowd near the house door: town home spots all sort toward one anchor. Spread them across the plaza.
- Autoplay and couriers are only lightly tested. Night mode is untested live (no real night happened during the session).
- The 15 answers in `data/inbox.json` are real answers the user gave in-game. Don't clear `data/`.
