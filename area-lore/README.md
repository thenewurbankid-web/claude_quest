# Area lore (R3 Lore quests)

Players with no work still get quests: local weather and real local happenings become game-only Riddles on the hub's
notice board. They never feed the Haze, the Gloamwyrm, the Beacon or the stats (`isGameOnly` in
`public/quest/contract.js`). Design: PLAN-engine.md, "R3 Lore quests". Not the lore files of PLAN-settlements §12.

- `sources.mjs`: Open-Meteo weather, iCal and RSS feeds, and `classify`, which keeps only festivals, markets, sports,
  music and seasonal events and drops anything about politics or harm.
- `writer.mjs`: Ollama writes the in-world line and question; a template when Ollama is down or answers badly. The
  hint (the tooltip naming the real event) is built from the feed, never by the model.
- `generate.mjs`: writes `lore/cells.json`, `lore/<cell>/index.json` and `lore/<cell>/<id>.json`. Each entry is
  written once and reused until it ends, then removed.

Try it locally (templates only without `OLLAMA_MODEL`):

```bash
node area-lore/generate.mjs --areas area-lore/areas.example.json --out /tmp/lore
```

## Three repos

`claude_quest` is public, so a self-hosted runner must never be attached to it.

| repo | visibility | holds |
| --- | --- | --- |
| `claude_quest` | public | this generator and the game client |
| `claude-quest-lore-gen` | **private** | `areas.json` (cells and feed URLs), the workflow, the deploy key secret |
| `claude-quest-lore` | public, no workflows | only `lore/…`, read by clients as static files |

## Setup (once, by hand)

1. Create the public `claude-quest-lore` repo with a README, and turn off Actions for it (Settings → Actions →
   Disable). It only ever receives commits.
2. Make a deploy key: `ssh-keygen -t ed25519 -N '' -f lore_key`. Add `lore_key.pub` to `claude-quest-lore` as a deploy
   key **with write access**. Delete the local files once step 4 is done.
3. Create the private `claude-quest-lore-gen` repo. Add `areas.json` (shape: `areas.example.json`; a cell is a
   geohash-4, about 39x20 km; look yours up at geohash.org and keep the first 4 characters) and copy
   `lore-gen.workflow.yml` to `.github/workflows/lore.yml`.
4. In `claude-quest-lore-gen`: Settings → Secrets → Actions → `LORE_DEPLOY_KEY` = the contents of `lore_key`.
5. Self-hosted runner on the Mac, attached **only** to `claude-quest-lore-gen` (Settings → Actions → Runners → New
   self-hosted runner, macOS). Give it the label `lore`. Run it as a service (`./svc.sh install && ./svc.sh start`) so
   it starts with the Mac. Ollama must be running with the model the workflow names (`ollama pull qwen3:4b`).
6. Run the workflow once by hand (Actions → area lore → Run workflow) and check `lore/cells.json` appears in
   `claude-quest-lore`.
7. Point the game at it: `LORE_BASE` in `public/quest/boot.js`, e.g.
   `https://raw.githubusercontent.com/thenewurbankid-web/claude-quest-lore/main/lore/`. Until then the board shows the
   built-in calendar, and `?lore=<folder/>` reads any lore folder (`?lore&cell=gcpv` reads the sample).

## Safety

- The workflow has only `schedule` and `workflow_dispatch` triggers, so nobody else can start a job on your Mac.
- The generator code is checked out read-only from `claude_quest` with no credentials kept.
- The deploy key can write to `claude-quest-lore` and nothing else.
- Feed text is clipped plain text; the client shows it only through `textContent`.
