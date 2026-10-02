# Claude Quest

A GBA-style overworld (Phaser 3) that works as your interface to Claude Code. Each project is a town.
No Claude tokens are spent on communication: state comes from files, narration from a local Ollama model.

```
npm start            # http://localhost:4777
npm run install-hook # once; adds the delivery hook to ~/.claude/settings.json (backup kept)
```

## Controls
Arrows/WASD move · Z/Space talk · X back · Enter menu (quest log, mail, questions, fly, outbox).

## Who's who in each town
- **Sign**: the town's name and motto.
- **House door**: the journal (local-model story plus HANDOFF/WIP/README excerpt). You can ask for a fresh chapter here.
- **Scout** (green): what Claude is doing right now, its last words, the town news. Shows `!` when there's news.
- **Historian** (grey hair): recent commits, branch, uncommitted files.
- **Guide** (white cap): missions. Accepting one tells Claude to prioritize it. Shows `!` for new missions.
- **Messenger** (blue): Claude's open questions (from `AskUserQuestion` or a final message ending in `?`) and
  Oracle suggestions from the local model. Answer one, or write a free-form letter. Shows `?` while questions are open.
- **Claude Center** (hub): clerk summary, mailbox (all events), quest board.

## How data flows
- `lib/collect.js` reads git, the docs listed in `config.json`, and `~/.claude/projects/*.jsonl` transcripts.
  Sessions started in `~/Repositories` are credited to the project they spent most of their time in.
- `lib/story.js` asks `qwen3:4b` (thinking off, JSON schema) for the town name, story, NPC lines, missions and choices.
  It only re-runs when the facts change, at most once every 10 minutes per town, one model call at a time.
  If Ollama is down, it falls back to templates.
- Answers, letters and accepted missions go to `data/inbox.json`. `hook/deliver.js` (UserPromptSubmit) adds the
  pending ones to your next prompt in that project and marks them read. It prints nothing when the inbox is empty
  and skips automated Paperclip prompts.

## Config
Copy `config.example.json` to `config.json` (it's git-ignored) and edit it. `config.json` sets the project list (path, extra worktree paths, transcript folder prefixes, docs, roof colour),
the Ollama model, the scan interval and the story throttle.
