// The Quest layer on the 3D page. R0: opens the browser ledger, mounts the Ledger panel (folded) and the Beacon HUD,
// and tells the scene the Beacon's colour through a 'quest:beacon' window event (detail: 'gold' | 'amber' | 'red' |
// null for no Realm yet).
// R1: Riddles. Keepers on blocked or in-review Works carry their open Riddles ('quest:riddlers' to the scene); E next to
// one ('quest:talk') opens the conversation box; the answer goes through the Riddle rules into the outbox, which seals
// it after the recall window and writes it back to the Work. A slow tick returns deferred Riddles and fades stale ones.
// The session is logged locally, and "while you were away" shows what changed since the last one.
// R2: the Gloamwyrm. The weighted backlog sets the Haze over the world ('quest:haze', 0..1); past the threshold the
// Gloamwyrm cuts in after a short warning (battle.js). After a fight ends it stays calm for a while, so retreating is a
// real way out. The fight is play state, kept in localStorage ('quest-play'), never in the ledger.
// ?playtest (or ?playtest=heavier) swaps in the R2 playtest backlog, after a confirm.
// R3: Lore quests. Area lore for the player's geohash-4 cell and its neighbours (area-lore.js), or the built-in calendar,
// becomes game-only Riddles in a Town news March. They are taken on from the hub's notice board ('quest:board'), not
// carried by Keepers, and never feed the Beacon, the Haze, the boss or the stats.
// R4: Bring your Keeper. E next to a Keeper with no Riddle ('quest:keeper', { slot }) opens Start work for the ledger
// Keeper in that slot; the prompt then waits on the /work page (work.html). The Ember meter and the Recall Bell (B)
// sit in a dock at the bottom left. ?lore=<folder/> reads a lore folder
// (?lore alone: the sample cell, with &cell=gcpv to stand in it); with no folder yet, only the calendar is posted.
// R5: Missions. The current mission (play.missions in 'quest-play', checked by playFromSave) follows the ledger: briefing
// and debrief are spoken by the Work's Keeper, the HUD shows it, the notice board has a Missions tab. Past rules.pressureGate
// the pressure gate hides lore quests and the lore tab and keeps the player in the old town ('quest:explore'); /work,
// Riddles, the Lodge, the Recall Bell and saves are never gated. A summoned Keeper joins on its first approved Work.
// A finished saga opens its Sealed Hall by itself (status.js sealedHalls).
import { openLedger } from './ledger-idb.js';
import { mountLedgerPanel } from './ledger-panel.js';
import { mountBeaconHud } from './beacon-hud.js';
import { mountStatsBoard } from './stats-board.js';
import { beacon } from './status.js';
import { applyChanges, DEFAULT_RULES, isGameOnly, playFromSave } from './contract.js';
import { riddleNpcs, riddleContext, tickRiddles, trueSight, riddleStanding } from './riddles.js';
import { mountConversation } from './conversation.js';
import { startOutbox, mountOutbox } from './outbox.js';
import { mountDigest, trackSession, realmStats } from './digest.js';
import { mountBattle, applyTalk } from './battle.js';
import { bossScore, hazeLevel, shouldSummon, emptyBossPlay } from './boss.js';
import { playtestRealm } from './playtest.js';
import { geohash, cellAndNeighbours, fetchAreaLore, boardLore, loreChanges, riddleId as loreRiddleId, LORE_MARCH } from './area-lore.js';
import { mountTownBoard } from './town-board.js';
import { mountStartWork, mountEmberReadout, mountRecallBell } from './keeper-hud.js';
import { mountBridgePanel } from './bridge-client.js';
import { keepersMessage } from './work-queue.js';
import { missionsOf, begin, tickMission, hearBriefing, hearDebrief, gated } from './missions.js';
import { mountMissionHud, hudView, talk as missionTalk } from './mission-hud.js';
import { joinSummoned } from './keeper-controls.js';
import { place } from '../3d/clock.js';

const store = await openLedger();
// An in-page prompt rather than confirm(): some embedded browsers block native dialogs and silently answer "no".
const askInPage = text => new Promise(resolve => {
  const box = document.createElement('div');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', text);
  Object.assign(box.style, { position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%, -50%)', zIndex: 1200,
    width: 'min(420px, calc(100vw - 32px))', padding: '16px', borderRadius: '12px', background: 'rgba(14,16,24,.95)',
    color: '#eef0f4', font: '14px/1.4 system-ui, sans-serif', border: '1px solid rgba(255,255,255,.2)' });
  const p = document.createElement('p');
  p.style.margin = '0 0 12px';
  p.textContent = text;
  box.append(p);
  for (const [label, yes] of [['Load it', true], ['Cancel', false]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, { minHeight: '40px', padding: '8px 14px', marginRight: '8px', borderRadius: '8px', cursor: 'pointer',
      border: '1px solid rgba(255,255,255,.25)', background: yes ? '#6b4fd8' : 'rgba(255,255,255,.08)', color: 'inherit', font: 'inherit' });
    b.onclick = () => { box.remove(); resolve(yes); };
    box.append(b);
  }
  document.body.append(box);
  box.querySelector('button').focus();
});
const pt = new URLSearchParams(location.search).get('playtest');
if (pt !== null && await askInPage(`Replace this browser's ledger with the R2 playtest backlog${pt === 'heavier' ? ' (heavier, a day later)' : ''}: the sample Realm plus three fake questions?`)) {
  const sample = await (await fetch(new URL('quest/sample-realm.json', document.baseURI))).json();
  await store.replace(playtestRealm(sample, new Date(), { heavier: pt === 'heavier' }));
  try { localStorage.removeItem('quest-play'); } catch {}
}
mountLedgerPanel(document.body, store, { sampleUrl: 'quest/sample-realm.json' });
// The panel opens by default on its dev page; in the game it starts folded behind its toggle.
const panel = document.querySelector('.qlp-panel'), toggle = document.querySelector('.qlp-toggle');
if (panel && toggle) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
mountBeaconHud(document.body, store);
mountDigest(document.body, store); // before trackSession, so the digest counts from the last session's end
trackSession(store);

let last;
const tell = l => {
  const color = l.marches.some(m => m.id !== LORE_MARCH.id) ? beacon(l).color : null; // dark until real work exists
  if (color === last) return;
  last = color;
  window.__questBeacon = color; // read by the scene if it builds after the first event
  dispatchEvent(new CustomEvent('quest:beacon', { detail: color }));
};
store.subscribe(tell);
tell(await store.snapshot());

// ---------- R1: Riddles ----------
const rules = DEFAULT_RULES;
const talk = mountConversation(document.body);
mountOutbox(document.body, store);
startOutbox(store);

let lastRiddlers = '';
const tellRiddlers = l => {
  const slots = new Map(l.keepers.map((k, i) => [k.id, i]));
  const list = riddleNpcs(l).filter(n => !isGameOnly(n.riddle)) // lore is taken on from the notice board
    .map(n => ({ riddleId: n.riddle.id, slot: n.keeper ? slots.get(n.keeper.id) ?? null : null }));
  const key = JSON.stringify(list);
  if (key === lastRiddlers) return;
  lastRiddlers = key;
  window.__questRiddlers = list; // read by the scene once its Keepers exist
  dispatchEvent(new CustomEvent('quest:riddlers', { detail: list }));
};
store.subscribe(tellRiddlers);
tellRiddlers(await store.snapshot());

const tick = async () => {
  const c = tickRiddles(await store.snapshot(), new Date(), rules);
  if (c.puts.length || c.events.length) await applyChanges(store, c);
};
await tick();
setInterval(tick, 30_000);

// A small "Talk (E)" prompt while the player stands next to a Riddle; tapping it works on touch screens.
const prompt = document.createElement('button');
prompt.type = 'button';
prompt.textContent = 'Talk (E)';
prompt.hidden = true;
Object.assign(prompt.style, { position: 'fixed', left: '50%', bottom: '120px', transform: 'translateX(-50%)', zIndex: 1001,
  padding: '8px 16px', borderRadius: '999px', border: '1px solid rgba(255,255,255,.3)', background: 'rgba(14,16,24,.85)',
  color: '#eef0f4', font: '600 14px system-ui, sans-serif', cursor: 'pointer' });
document.body.append(prompt);
// near: a Riddle id, 'lodge' (the stats board), 'board' (the notice board) or null
let near = null, talking = false, keeperCount = 0;
const PLACES = { lodge: 'Stats board (E)', board: 'Notice board (E)', keeper: 'Start work (E)' };
let nearSlot = null;
store.subscribe(l => { keeperCount = l.keepers.length; });
keeperCount = (await store.snapshot()).keepers.length;
addEventListener('quest:near', e => {
  nearSlot = e.detail?.keeper ?? null;
  near = e.detail?.riddleId || (PLACES[e.detail?.place] ? e.detail.place : null)
    || (nearSlot != null && nearSlot < keeperCount ? 'keeper' : null); // a scene Keeper with no ledger Keeper stays quiet
  prompt.textContent = PLACES[near] || 'Talk (E)';
  prompt.hidden = !near || talking;
});
prompt.addEventListener('click', () => near && dispatchEvent(near === 'keeper' ? new CustomEvent('quest:keeper', { detail: { slot: nearSlot } })
  : PLACES[near] ? new CustomEvent(`quest:${near}`) : new CustomEvent('quest:talk', { detail: { riddleId: near } })));

const lock = locked => { talking = locked; prompt.hidden = locked || !near; dispatchEvent(new CustomEvent('quest:input', { detail: { locked } })); };

// The stats board in the Keeper's Lodge (success measures, from the local event log)
const board = mountStatsBoard(document.body);
addEventListener('quest:lodge', async () => {
  if (talking || battle.open) return;
  lock(true);
  try { await board.show(realmStats(await store.snapshot())); } finally { lock(false); }
});
// ---------- R3: Lore quests ----------
const qs = new URLSearchParams(location.search);
// The published lore folder: the user's `lore` branch on GitHub (CLA-16). The game server can override it
// (config.json lore.base, a local folder or URL) and give a default cell for desktop use; ?lore=<folder/> wins over both.
const LORE_BASE = 'https://raw.githubusercontent.com/thenewurbankid-web/claude_quest/lore/lore/';
const serverLore = await fetch('/api/lore/config').then(r => (r.ok ? r.json() : null)).catch(() => null);
const loreBase = qs.has('lore') ? new URL((qs.get('lore') || 'quest/sample-lore/').replace(/\/?$/, '/'), document.baseURI)
  : new URL((serverLore?.base || LORE_BASE).replace(/\/?$/, '/'), document.baseURI);
const CELL = /^[0-9b-hjkmnp-z]{4}$/;
const loreCell = () => (CELL.test(qs.get('cell') || '') ? qs.get('cell')
  : place().guessed && CELL.test(serverLore?.cell || '') ? serverLore.cell : geohash(place().lat, place().lon));
let loreShown = { entries: [], calendar: true };
const refreshLore = async () => {
  const cell = loreCell(), p = place();
  const area = loreBase ? (await fetchAreaLore(loreBase, cellAndNeighbours(cell)).catch(() => ({ entries: [] }))).entries : [];
  const entries = boardLore(area, cell, new Date(), { lat: p.lat });
  loreShown = { entries, calendar: !area.length };
  const c = loreChanges(await store.snapshot(), entries, new Date());
  if (c.puts.length || c.events.length) await applyChanges(store, c);
};
await refreshLore().catch(err => console.warn('area lore:', err.message));
setInterval(() => refreshLore().catch(() => {}), 10 * 60e3);
// between fetches, close lore Works whose Riddle got sealed or whose entry ended
setInterval(async () => {
  const c = loreChanges(await store.snapshot(), loreShown.entries, new Date());
  if (c.puts.length || c.events.length) await applyChanges(store, c);
}, 30_000);

const townBoard = mountTownBoard(document.body);
const boardRows = async () => {
  const byId = new Map((await store.snapshot()).riddles.map(r => [r.id, r]));
  return loreShown.entries.map(entry => {
    const r = byId.get(loreRiddleId(entry));
    return { entry, riddleId: r?.id ?? null, state: r?.state ?? null };
  });
};
// Asked once, only from the board's button: a rough location (about 10 km), kept as quest.place like the weather's.
const usePlace = () => new Promise((ok, no) => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition(g => ok({ lat: +g.coords.latitude.toFixed(1), lon: +g.coords.longitude.toFixed(1) }), no, { timeout: 15000, maximumAge: 36e5 })
  : no(new Error('no geolocation')))
  .then(async p => { try { localStorage.setItem('quest.place', JSON.stringify(p)); } catch {} await refreshLore(); return boardRows(); });
addEventListener('quest:board', async () => {
  if (talking || battle.open) return;
  lock(true);
  let pick = null;
  try {
    const l = await store.snapshot(), now = new Date();
    pick = await townBoard.show(await boardRows(), { guessed: !!place().guessed && !qs.get('cell') && !CELL.test(serverLore?.cell || ''), calendar: loreShown.calendar,
      onUsePlace: usePlace, missions: missionsOf(l, mp, now, rules), gated: gated(l, now, rules), gate: rules.pressureGate,
      current: mp.current, onBegin: async id => { const r = begin(mp, await store.snapshot(), id, new Date()); if (!r.problem) await commitMp(r); } });
  } finally { lock(false); }
  settleMission();
  if (pick && !gated(await store.snapshot(), new Date(), rules).gated) dispatchEvent(new CustomEvent('quest:talk', { detail: { riddleId: pick } }));
});

// ---------- R4: Bring your Keeper ----------
const startWork = mountStartWork(document.body, store, { workUrl: 'work.html' });
mountEmberReadout(document.body, store);
// R4.5: the Bridge. Off by default; with it off nothing connects and the game runs on its own ledger and /work.
const bridgeBox = document.createElement('div');
Object.assign(bridgeBox.style, { position: 'fixed', top: '88px', left: '8px', right: '8px', maxWidth: '560px', maxHeight: 'calc(100vh - 104px)',
  overflow: 'auto', zIndex: 1001, background: 'rgba(14,16,24,.95)', borderRadius: '12px', border: '1px solid rgba(255,255,255,.2)' });
bridgeBox.hidden = true;
const bridgeBtn = document.createElement('button');
bridgeBtn.type = 'button'; bridgeBtn.textContent = 'Bridge'; bridgeBtn.setAttribute('aria-expanded', 'false');
Object.assign(bridgeBtn.style, { position: 'fixed', top: '44px', left: '8px', zIndex: 1001, minHeight: '40px', padding: '8px 14px', borderRadius: '8px',
  border: '1px solid rgba(255,255,255,.25)', background: 'rgba(14,16,24,.82)', color: '#f3e6c8', font: '600 13px system-ui, sans-serif', cursor: 'pointer' });
bridgeBtn.onclick = () => { bridgeBox.hidden = !bridgeBox.hidden; bridgeBtn.setAttribute('aria-expanded', String(!bridgeBox.hidden)); };
document.body.append(bridgeBtn, bridgeBox);
let bridge = { ring() {}, refresh: async () => {} };
try { bridge = mountBridgePanel(bridgeBox, { store, realmId: (await store.snapshot()).realm.id, storage: localStorage, rules,
  connect: (url, opts) => globalThis.mqtt.connect(url, opts),
  keepersOf: (l, now) => keepersMessage(l, l.keepers.map(k => k.id), now, rules) }); // the Bridge on is the opt-in: every Keeper is listed
} catch (err) { console.warn('The Bridge panel did not mount:', err.message); }
let bridgeKeepers = '';
store.subscribe(l => { const k = JSON.stringify([l.keepers.map(x => [x.id, x.status]), l.queue.map(q => [q.id, q.state])]); if (k !== bridgeKeepers) { bridgeKeepers = k; bridge.refresh().catch(() => {}); } });
mountRecallBell(document.body, store, { onRing: () => bridge.ring(), onKeepers: () => { if (!talking && !battle.open) openKeeper(null); } });
const openKeeper = async keeperId => {
  lock(true);
  try { await startWork.open(keeperId ?? undefined); } finally { lock(false); }
};
addEventListener('quest:keeper', async e => {
  if (talking || battle.open) return;
  const k = (await store.snapshot()).keepers[e.detail?.slot];
  if (k) await openKeeper(k.id);
});

addEventListener('quest:talk', async e => {
  if (talking || battle.open) return; // a log click during a fight is ignored
  const l = await store.snapshot();
  const npc = riddleNpcs(l).find(n => n.riddle.id === e.detail?.riddleId);
  if (npc && isGameOnly(npc.riddle) && gated(l, new Date(), rules).gated) return; // lore quests are locked under pressure
  if (!npc) {
    // picked from the Beacon log but not answerable now: say where it stands instead
    if (e.detail?.from !== 'log' || !l.riddles.some(r => r.id === e.detail.riddleId)) return;
    lock(true);
    try { await talk.say(riddleStanding(l, e.detail.riddleId), { name: 'Lumi' }); } finally { lock(false); }
    return;
  }
  lock(true);
  try {
    const speaker = { name: npc.keeper?.name || 'A villager' };
    const agentName = npc.keeper?.name || 'the Keeper';
    const res = await talk.ask(npc.riddle, { speaker, tier: npc.tier, flags: trueSight(npc.riddle.text),
      workTitle: npc.work.title, agentName, context: riddleContext(l, npc.riddle.id) });
    if (!res) return;
    await applyTalk(store, npc.riddle.id, res, { rules, agentName }); // the ledger may have moved while the box was open
    if (res.askBack) await talk.say([`I'll ask about that and come back to you.`], speaker);
  } catch (err) {
    await talk.say([`That answer didn't take: ${err.message}`], { name: 'Lumi' });
  } finally {
    lock(false);
  }
});

// ---------- R2: the Gloamwyrm ----------
const CALM_MINUTES = 10; // after a fight ends, how long before it may cut in again
const loadPlay = () => { try { return JSON.parse(localStorage.getItem('quest-play')) || {}; } catch { return {}; } };
const keep = patch => { try { localStorage.setItem('quest-play', JSON.stringify({ ...loadPlay(), ...patch })); } catch {} };
const battle = mountBattle(document.body, { store, talk, rules, play: loadPlay().boss || emptyBossPlay(),
  savePlay: boss => keep({ boss }),
  onEnd: () => keep({ calmUntil: Date.now() + CALM_MINUTES * 60e3 }) });
addEventListener('quest:battle', e => lock(!!e.detail?.open));

// The scene's fog only reaches the far edge of the view, so the Haze also shows as a soft violet vignette over it.
const veil = document.createElement('div');
veil.setAttribute('aria-hidden', 'true');
Object.assign(veil.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 5, opacity: '0',
  transition: 'opacity 3s ease', background: 'radial-gradient(ellipse at 50% 55%, rgba(170,150,235,0) 35%, rgba(170,150,235,.35) 75%, rgba(150,128,225,.55) 100%)' });
document.body.append(veil);
let lastHaze = null;
const tellHaze = l => {
  const h = hazeLevel(bossScore(l, new Date(), rules).openScore, rules);
  if (h === lastHaze) return;
  lastHaze = h;
  veil.style.opacity = String(h * 0.8);
  window.__questHaze = h;
  dispatchEvent(new CustomEvent('quest:haze', { detail: h }));
};
store.subscribe(tellHaze);
tellHaze(await store.snapshot());

// A warning line first, then the fight. Never while a conversation is open, and never inside the calm window.
const warn = document.createElement('div');
warn.setAttribute('role', 'status');
warn.hidden = true;
Object.assign(warn.style, { position: 'fixed', left: '50%', top: '30%', transform: 'translateX(-50%)', zIndex: 1040,
  padding: '12px 20px', borderRadius: '12px', background: 'rgba(26,21,48,.9)', color: '#eadcff', textAlign: 'center',
  font: '600 16px Georgia, serif', boxShadow: '0 0 40px rgba(143,107,255,.45)', maxWidth: 'calc(100vw - 32px)' });
warn.textContent = 'The Haze gathers. Something stirs in it…';
document.body.append(warn);
let summoning = false;
const maybeSummon = async () => {
  if (summoning || talking || battle.open || Date.now() < (loadPlay().calmUntil || 0)) return;
  const l = await store.snapshot();
  const play = battle.play;
  const midFight = play.battle && !['won', 'retreated'].includes(play.battle.phase);
  if (!midFight && !shouldSummon(l, play, new Date(), rules)) return;
  summoning = true;
  warn.hidden = false;
  setTimeout(async () => {
    warn.hidden = true;
    summoning = false;
    if (talking || battle.open) return;
    try { await battle.fight(); } catch (err) { console.warn('the Gloamwyrm stayed in the Haze:', err.message); }
  }, 2500);
};
setTimeout(maybeSummon, 8000);
setInterval(maybeSummon, 15_000);

// ---------- R5: Missions ----------
const loaded = playFromSave({ play: loadPlay() });
if (loaded.problems.length) {
  console.warn('quest-play: the saved missions were unsound and start empty:', loaded.problems.map(p => `${p.path} ${p.problem}`).join('; '));
  keep({ missions: loaded.play.missions });
}
let mp = loaded.play.missions;
const missionHud = mountMissionHud(document.body);
async function commitMp(r) {
  mp = r.mp;
  keep({ missions: mp });
  if (r.events.length) await applyChanges(store, { puts: [], events: r.events });
}
let missionBusy = false;
async function settleMission() {
  if (missionBusy) return;
  missionBusy = true;
  try {
    const l = await store.snapshot();
    await commitMp(tickMission(mp, l, new Date()));
    const run = mp.current && mp.runs[mp.current];
    if (run && ['briefing', 'debrief'].includes(run.state) && !talking && !battle.open) {
      lock(true);
      try {
        await missionTalk(talk, run.state, l, mp, run.id, new Date(), rules);
        await commitMp(run.state === 'briefing' ? hearBriefing(mp, new Date()) : hearDebrief(mp, new Date()));
      } finally { lock(false); }
    }
    missionHud.update(hudView(await store.snapshot(), mp, new Date(), rules));
  } catch (err) { console.warn('mission:', err.message); } finally { missionBusy = false; }
}
let lastGate = null;
async function tellGate() {
  const l = await store.snapshot();
  const locked = gated(l, new Date(), rules).gated;
  if (locked === lastGate) return;
  lastGate = locked;
  window.__questExploreLocked = locked; // read by the scene if it builds after the first event
  dispatchEvent(new CustomEvent('quest:explore', { detail: { locked } }));
}
let joining = false;
async function joinKeepers() {
  if (joining) return;
  joining = true;
  try { const c = joinSummoned(await store.snapshot(), new Date()); if (c.puts.length || c.events.length) await applyChanges(store, c); } finally { joining = false; }
}
const onLedger = () => { joinKeepers(); settleMission(); tellGate(); };
store.subscribe(onLedger);
onLedger();
setInterval(onLedger, 30_000);
