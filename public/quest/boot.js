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
import { openLedger } from './ledger-idb.js';
import { mountLedgerPanel } from './ledger-panel.js';
import { mountBeaconHud } from './beacon-hud.js';
import { beacon } from './status.js';
import { applyChanges, DEFAULT_RULES } from './contract.js';
import { riddleNpcs, riddleContext, tickRiddles, trueSight } from './riddles.js';
import { mountConversation } from './conversation.js';
import { startOutbox, mountOutbox } from './outbox.js';
import { mountDigest, trackSession } from './digest.js';
import { mountBattle, applyTalk } from './battle.js';
import { bossScore, hazeLevel, shouldSummon, emptyBossPlay } from './boss.js';
import { playtestRealm } from './playtest.js';

const store = await openLedger();
const pt = new URLSearchParams(location.search).get('playtest');
if (pt !== null && confirm('Replace this browser\'s ledger with the R2 playtest backlog (sample Realm + three fake questions)?')) {
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
  const color = l.marches.length ? beacon(l).color : null;
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
  const list = riddleNpcs(l).map(n => ({ riddleId: n.riddle.id, slot: n.keeper ? slots.get(n.keeper.id) ?? null : null }));
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
let near = null, talking = false;
addEventListener('quest:near', e => { near = e.detail?.riddleId || null; prompt.hidden = !near || talking; });
prompt.addEventListener('click', () => near && dispatchEvent(new CustomEvent('quest:talk', { detail: { riddleId: near } })));

const lock = locked => { talking = locked; prompt.hidden = locked || !near; dispatchEvent(new CustomEvent('quest:input', { detail: { locked } })); };
addEventListener('quest:talk', async e => {
  if (talking) return;
  const l = await store.snapshot();
  const npc = riddleNpcs(l).find(n => n.riddle.id === e.detail?.riddleId);
  if (!npc) return;
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
