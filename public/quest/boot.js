// R0 in the 3D view: opens the browser ledger, mounts the Ledger panel (folded) and the Beacon HUD, and tells the scene
// the Beacon's colour through a 'quest:beacon' window event (detail: 'gold' | 'amber' | 'red' | null for no Realm yet).
import { openLedger } from './ledger-idb.js';
import { mountLedgerPanel } from './ledger-panel.js';
import { mountBeaconHud } from './beacon-hud.js';
import { beacon } from './status.js';

const store = await openLedger();
mountLedgerPanel(document.body, store, { sampleUrl: 'quest/sample-realm.json' });
// The panel opens by default on its dev page; in the game it starts folded behind its toggle.
const panel = document.querySelector('.qlp-panel'), toggle = document.querySelector('.qlp-toggle');
if (panel && toggle) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
mountBeaconHud(document.body, store);

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
