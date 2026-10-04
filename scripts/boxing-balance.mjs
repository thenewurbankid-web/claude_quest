// Headless balance batch: seeded fights for every tactic pair. Usage:
//   node scripts/boxing-balance.mjs [--engine path] [--n 200] [--rounds 6] [--seconds 180] [--ruleset street|sanctioned] [--stats 50,50,50,50] [--tactics pressure,counter] [--moves]
// --set pressure.crowdMs=20,counter.moves.feint=0.2 overrides tactic fields for this run (no engine copy needed).
// --moves also prints how often each move was thrown or used per fight (all pairs pooled).
// --engine points at an alternate physics-engine.js (used to compare tuning proposals).
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const enginePath = path.resolve(arg('engine', 'public/boxing/physics-engine.js'));
const N = +arg('n', 200), ROUNDS = +arg('rounds', 6), SECONDS = +arg('seconds', 180), RULESET = arg('ruleset', 'street');
const SHOW_MOVES = process.argv.includes('--moves');
const moveCounts = {};
const [sp, pw, st, iq] = arg('stats', '50,50,50,50').split(',').map(Number);
const { CombatSimulation, FighterModel, TACTICS } = await import(pathToFileURL(enginePath).href);
const keys = arg('tactics', '') ? arg('tactics').split(',') : Object.keys(TACTICS);
for (const kv of arg('set', '').split(',').filter(Boolean)) {
  const [pathStr, val] = kv.split('=');
  const parts = pathStr.split('.'), last = parts.pop();
  let o = TACTICS;
  for (const k of parts) o = o[k] ??= {};
  o[last] = +val;
}
const stats = { speed: sp, power: pw, stamina: st, ringIQ: iq };

function fight(a, b, seed) {
  const sim = new CombatSimulation({
    red: new FighterModel({ corner: 'red', name: 'R', stats }),
    blue: new FighterModel({ corner: 'blue', name: 'B', stats }), seed, rounds: ROUNDS, roundSeconds: SECONDS, ruleset: RULESET });
  const landed = { red: 0, blue: 0 }, thrown = { red: 0, blue: 0 };
  sim.on('impact', (p) => { thrown[p.attacker]++; if (p.outcome === 'landed') landed[p.attacker]++; moveCounts[p.move ?? p.type] = (moveCounts[p.move ?? p.type] ?? 0) + 1; });
  sim.on('action', (e) => { moveCounts[e.kind] = (moveCounts[e.kind] ?? 0) + 1; });
  while (sim.phase !== 'fight_over') { sim.startRound({ red: a, blue: b }); sim.runRoundToEnd(); }
  const r = sim.result;
  return { winner: r.winner, ko: r.method.startsWith('KO'), koRound: r.rounds, landed, thrown };
}

const out = {};
for (const a of keys) for (const b of keys) {
  const s = { redWin: 0, blueWin: 0, draw: 0, ko: 0, koRounds: 0, lr: 0, lb: 0, tr: 0, tb: 0 };
  for (let i = 0; i < N; i++) {
    const f = fight(a, b, 1000 + i);
    if (f.winner === 'red') s.redWin++; else if (f.winner === 'blue') s.blueWin++; else s.draw++;
    if (f.ko) { s.ko++; s.koRounds += f.koRound; }
    s.lr += f.landed.red; s.lb += f.landed.blue; s.tr += f.thrown.red; s.tb += f.thrown.blue;
  }
  out[`${a} v ${b}`] = {
    winA: +(s.redWin / N).toFixed(2), winB: +(s.blueWin / N).toFixed(2), ko: +(s.ko / N).toFixed(2),
    koRd: s.ko ? +(s.koRounds / s.ko).toFixed(1) : null,
    landedA: +(s.lr / N).toFixed(1), landedB: +(s.lb / N).toFixed(1),
    rateA: +(s.lr / Math.max(1, s.tr)).toFixed(2), rateB: +(s.lb / Math.max(1, s.tb)).toFixed(2),
  };
}
console.table(out);
// Tactic strength: mean win share across all opponents (red side, plus blue side).
const strength = {};
for (const a of keys) {
  let w = 0, n = 0;
  for (const b of keys) {
    w += out[`${a} v ${b}`].winA + out[`${b} v ${a}`].winB; n += 2;
  }
  strength[a] = +(w / n).toFixed(2);
}
console.log('mean win share per tactic:', strength);
const matrix = {};   // row beats column: win share over both corners, draws count half
for (const a of keys) { matrix[a] = {}; for (const b of keys) { const x = out[`${a} v ${b}`], y = out[`${b} v ${a}`]; matrix[a][b] = +((x.winA + y.winB + (x.winB === undefined ? 0 : 0) + (1 - x.winA - x.winB) / 2 + (1 - y.winA - y.winB) / 2) / 2).toFixed(2); } }
console.log('win share, row v column (both corners):'); console.table(matrix);
const kos = Object.values(out);
console.log('overall KO rate:', +(kos.reduce((s, r) => s + r.ko, 0) / kos.length).toFixed(2));
if (SHOW_MOVES) {
  const fights = keys.length * keys.length * N;
  console.log('moves per fight:', Object.fromEntries(Object.entries(moveCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / fights).toFixed(2)])));
}
