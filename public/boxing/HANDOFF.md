# Boxing Manager AI: handoff

Worktree `.claude/worktrees/boxing-manager-ai`, branch `worktree-boxing-manager-ai`, based on `3d-world`.
Nothing is committed yet. Live tracker: https://claude.ai/artifact/PRsPyaXBu4g9UpCFbPwP3K (its `db` holds `tasks/t01..t12`,
`log/l01..l12`, `meta/status` and `meta/balance`; update them with ArtifactData and pin each write with `if_version`).

## Next job: realistic 3D boxing match in Babylon.js

The user's decisions (2026-10-03):
- **Renderer: Babylon.js**, not three.js and not Phaser. It should look like a real televised boxing match.
- **Physics stays as it is.** `CombatSimulation` is the single source of truth. The 3D layer only reads `sim.snapshot()`
  and listens to `impact` / `exchange` / `round_end` events. It must never write to the simulation, or P2P lockstep breaks.
- **Boxer models:** find the best free resources available. Check the licence of every asset and record it in
  `public/boxing/models/CREDITS.md`.

Leads to verify (I haven't checked them; confirm licences and availability first):
- Mixamo: free rigged humans plus boxing animations (jab, cross, hook, block, idle stance, hit reaction, knockdown).
  Needs an Adobe login, so the user downloads the FBX files, which you then convert to GLB.
- Quaternius: CC0 humanoid rigs and an animation library.
- Poly Haven: CC0 HDRIs (an indoor arena) and PBR textures for the canvas, ropes and turnbuckles.
- Sketchfab: some CC-BY boxing rings and gloves. Attribution is required.
- Babylon.js's own asset library and playground examples for retargeting animations.

Suggested shape:
- `public/boxing/arena-babylon.js`, the counterpart of the Phaser layer. Map the sim's 2D ring (metres, origin at the
  centre, x/y) onto the Babylon ground plane (x/z). Pick each animation from `activePunch.type` and blend it by
  `(tick − launchTick) / (arriveTick − launchTick)`. Play a hit reaction on landed impacts, scaled by joules. Add
  ropes, corner posts, lit canvas, crowd, and a broadcast camera.
- Serve Babylon from npm the way Phaser and Dexie are served: add `'@babylonjs/core'` and `'@babylonjs/loaders'` to
  `VENDOR` in `dev/static.js`, or use the UMD `babylon.js` from `node_modules/babylonjs`.
- Keep `createPhysicsGame` (Phaser) as the headless/2D fallback toggle, or drop it if the user agrees.

## Current state (all verified)

- `public/boxing/physics-engine.js`: 240 Hz deterministic core (`FighterModel`, `CombatSimulation`, `computePunch`,
  serializers `bm.exchange.v1` / `bm.round.v1`), plus a lazy Phaser layer (`getPhaserClasses`, `createPhysicsGame`).
- `public/boxing/game-db.js`: Dexie `fight_logs` / `matches` / `fighters`, `retrieveTacticalPrecedents()` (top 3,
  Gaussian similarity × success score), and `toLLMContext()`.
- `public/boxing/index.html`: stats, training camp, single-player (AI corner), and P2P (WebRTC, manual offer/answer
  strings using `LinkCrypto.pack`/`unpack`, plus `#offer=` links for QR codes).
- Shared changes: `dev/static.js` (generic `/vendor/<name>/` routes), `public/linkcrypto.js` (`pack`/`unpack`),
  `package.json` (adds `dexie`), `.claude/launch.json` (`boxing-static` on port 4792).
- `test/boxing.test.js`: 8 tests. `npm test` passes 92 of 92.
- Browser check: a single-player fight ran to the end, IndexedDB logging and RAG intel worked, and the P2P loopback in
  two tabs gave identical results on both peers.

Run it with `npm run static -- 4792` (or `preview_start boxing-static`), then open http://localhost:4792/boxing/.

## Open issues

- Balance: counter-punching beats pressure heavily (by round 4, 88 landed vs 25), and fights often end by KO around
  round 5. The tuning constants are at the top of `physics-engine.js` (`PUNCHES`, `TACTICS`, the `deriveAttributes`
  maps, and the damage divisor `/ 400` in `_resolveArrivals`).
- `boxing-manager/` is a leftover empty folder at the worktree root. Delete it by hand.
- WebLLM worker is not started yet. `toLLMContext()` already produces the prompt block.
