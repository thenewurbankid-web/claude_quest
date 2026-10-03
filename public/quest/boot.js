// The Quest layer on the 3D page. R0: opens the browser ledger, mounts the Ledger panel (folded) and the Beacon HUD,
// and tells the scene the Beacon's colour through a 'quest:beacon' window event (detail: 'gold' | 'amber' | 'red' |
// null for no Realm yet).
// R1: Riddles. Keepers on blocked or in-review Works carry their open Riddles ('quest:riddlers' to the scene); E next to
// one ('quest:talk') opens the conversation box; the answer goes through the Riddle rules into the outbox, which seals
// it after the recall window and writes it back to the Work. A slow tick returns deferred Riddles and fades stale ones.
// The session is logged locally, and "while you were away" shows what changed since the last one.
import { openLedger } from './ledger-idb.js';
import { mountLedgerPanel } from './ledger-panel.js';
import { mountBeaconHud } from './beacon-hud.js';
import { beacon } from './status.js';
import { applyChanges, DEFAULT_RULES } from './contract.js';
import { riddleNpcs, riddleContext, answerRiddle, askBack, replyToAsk, tickRiddles, trueSight } from './riddles.js';
import { mountConversation } from './conversation.js';
import { startOutbox, mountOutbox } from './outbox.js';
import { mountDigest, trackSession } from './digest.js';

const store = await openLedger();
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
    const now = await store.snapshot(); // the ledger may have moved while the box was open
    const me = now.realm.owner, id = npc.riddle.id;
    if (res.askBack) {
      await applyChanges(store, askBack(now, id, { text: res.askBack, by: me }));
      await talk.say([`I'll ask about that and come back to you.`], speaker);
    } else if (res.reply) {
      await applyChanges(store, replyToAsk(now, id, { text: res.reply, by: agentName }));
    } else {
      await applyChanges(store, answerRiddle(now, id, { text: res.choice, by: me }, new Date(), rules));
    }
  } catch (err) {
    await talk.say([`That answer didn't take: ${err.message}`], { name: 'Lumi' });
  } finally {
    lock(false);
  }
});
