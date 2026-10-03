// The in-game Bridge client (PLAN-engine.md R4.5). Optional: with it off nothing here runs and the game plays on the
// Local Ledger and /work copy-paste. MQTT over WebSocket to 127.0.0.1 as client id `game`; the Realm's login lives in
// the browser's settings only (never a save, ledger, prompt or Bridge message). Everything received is data: plain
// text with True Sight, never obeyed. Rules are in contract.js; reports go through pasteResult's rules.
import { BRIDGE_HOST, BRIDGE_VERSION, bridgeTopic, parseBridgeTopic, validateRegistration, credentialPlaceholder, keeperList,
  applyChanges, noChanges, DEFAULT_RULES } from './contract.js';
import { pasteResult } from './work-queue.js';
import { trueSight } from './riddles.js';
import { markPieces } from './conversation.js';

export const BRIDGE_PORT = 4779;
export const bridgeUrl = (port = BRIDGE_PORT) => `ws://${BRIDGE_HOST}:${port}`;
const SETTINGS_KEY = realmId => `quest.bridge.${realmId}`;

/** The browser-only settings: { on, port, username, password }. Off, with no login, until the player sets them. */
export function loadBridgeSettings(storage, realmId) {
  let s = null;
  try { s = JSON.parse(storage?.getItem(SETTINGS_KEY(realmId)) || 'null'); } catch { /* unreadable: start fresh */ }
  const port = Number.isInteger(s?.port) && s.port > 0 && s.port < 65536 ? s.port : BRIDGE_PORT;
  return { on: s?.on === true, port, username: typeof s?.username === 'string' ? s.username : '',
    password: typeof s?.password === 'string' ? s.password : '' };
}
export function saveBridgeSettings(storage, realmId, settings) {
  const { on, port, username, password } = settings;
  storage.setItem(SETTINGS_KEY(realmId), JSON.stringify({ on: on === true, port, username, password }));
}

/**
 * A report the Bridge republished ({ queueId, keeperId, report }) as Changes on the queue, by pasteResult's rules (the
 * report's block text goes through parseReport again), then marked relayed: 'bridge'. A message that does not name its
 * item's Keeper, or an item that is not in the ledger, changes nothing.
 * @returns {{ changes: object, problems: object[], refused: string|null }}
 */
export function reportToQueue(ledger, message, now = new Date(), rules = DEFAULT_RULES) {
  const none = refused => ({ changes: noChanges(), problems: [], refused });
  const item = (ledger.queue || []).find(q => q.id === message?.queueId);
  if (!item) return none('no such queue item');
  if (message.keeperId !== item.keeperId) return none('not this Keeper\'s item');
  const text = message?.report?.text;
  if (typeof text !== 'string') return none('no report');
  const res = pasteResult(ledger, item.id, text, {}, now, rules);
  if (res.refused || res.problems.length) return res;
  for (const p of res.changes.puts) if (p.kind === 'queue') {
    const reports = p.record.reports || [];
    const last = reports[reports.length - 1];
    if (last) reports[reports.length - 1] = { ...last, relayed: 'bridge', manual: false };
  }
  return res;
}

const parse = payload => { try { return JSON.parse(String(payload)); } catch { return null; } };

/**
 * The client. connect is mqtt's `connect(url, options)` (the browser bundle, passed in by integration so this stays
 * testable). Subscribes to status and, per Keeper, register and report. Calls on({kind, ...}) for 'status', 'refused',
 * 'registered', 'report' and 'link' events; never throws on a bad message.
 */
export function createBridgeClient({ connect, realmId, settings, on = () => {} }) {
  if (!settings?.on) throw new Error('the Bridge is off');
  const topic = (kind, keeperId) => bridgeTopic(kind, realmId, keeperId);
  const keepers = new Set();
  let client = null, up = false;
  const subscribe = t => { if (up) client.subscribe(t, { qos: 1 }); };
  const say = e => { try { on(e); } catch { /* a listener's fault is not the link's */ } };

  function onMessage(t, payload) {
    const p = parseBridgeTopic(t);
    const body = parse(payload);
    if (!p || p.realmId !== realmId || !body || typeof body !== 'object') return;
    if (p.kind === 'status') {
      if (body.kind === 'refused') say({ kind: 'refused', what: String(body.what ?? ''), keeperId: body.keeperId ?? null,
        problems: Array.isArray(body.problems) ? body.problems : [] });
      else say({ kind: 'status', halted: body.halted === true, state: String(body.kind ?? '') });
    } else if (p.kind === 'register') {
      if (!validateRegistration(body).length && body.keeperId === p.keeperId) say({ kind: 'registered', registration: body });
    } else if (p.kind === 'report') {
      if (body.keeperId === p.keeperId && body.report && typeof body.queueId === 'string') say({ kind: 'report', message: body });
    }
  }

  return {
    start() {
      client = connect(bridgeUrl(settings.port), { clientId: 'game', username: settings.username, password: settings.password,
        reconnectPeriod: 5000, protocolVersion: 4 });
      client.on('connect', () => {
        up = true; client.subscribe(topic('status'), { qos: 1 });
        for (const id of keepers) { subscribe(topic('register', id)); subscribe(topic('report', id)); }
        say({ kind: 'link', up: true });
      });
      client.on('close', () => { up = false; say({ kind: 'link', up: false }); });
      client.on('error', e => say({ kind: 'link', up: false, error: String(e?.message ?? e) }));
      client.on('message', onMessage);
    },
    /** The Keepers to listen for (ids from the ledger); call again when the ledger's Keepers change. */
    setKeepers(ids) {
      for (const id of ids) if (!keepers.has(id)) { keepers.add(id); subscribe(topic('register', id)); subscribe(topic('report', id)); }
    },
    bell() { if (up) client.publish(topic('bell'), JSON.stringify({ v: BRIDGE_VERSION }), { qos: 1 }); return up; },
    /** Publish the opted-in Keepers (retained, so the Bridge has them when it starts). Nothing else of the ledger. */
    publishKeepers(list) {
      if (up) client.publish(topic('keepers'), JSON.stringify(keeperList(list)), { qos: 1, retain: true });
      return up;
    },
    open() { if (up) client.publish(topic('open'), JSON.stringify({ v: BRIDGE_VERSION }), { qos: 1 }); return up; },
    stop() { if (client) client.end(true); up = false; client = null; },
    get up() { return up; },
  };
}

// ---------- the settings panel ----------
const STYLE_ID = 'qbr-styles';
const CSS = `
.qbr-root { box-sizing: border-box; width: 100%; max-width: 560px; margin: 0 auto; padding: 16px; color: #eef0f4;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.qbr-root *, .qbr-root *::before, .qbr-root *::after { box-sizing: border-box; }
.qbr-title { margin: 0 0 8px; font-size: 18px; }
.qbr-status { margin: 8px 0; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: rgba(14,16,24,.86); }
.qbr-status[data-s="up"] { border-color: #6fd08c; } .qbr-status[data-s="halted"] { border-color: #f2c14e; }
.qbr-label { display: block; margin-top: 8px; font-size: 13px; color: #a3a9b6; }
.qbr-input { display: block; width: 100%; min-height: 40px; margin-top: 4px; padding: 8px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.35); color: #eef0f4; font: inherit; }
.qbr-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.qbr-btn { min-height: 40px; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.08); color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.qbr-btn[aria-pressed="true"] { border-color: #f2c14e; background: rgba(242,193,78,.3); }
.qbr-btn:focus-visible, .qbr-input:focus-visible { outline: 2px solid #f2c14e; outline-offset: 2px; }
.qbr-help { margin: 8px 0 0; padding: 8px; border-radius: 8px; background: rgba(0,0,0,.35); font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; }
.qbr-list { margin: 8px 0 0; padding-left: 20px; }
.qbr-list:empty { display: none; }
.qbr-flag { background: rgba(242,193,78,.35); border-bottom: 2px solid #f2c14e; }
.qbr-note { margin-top: 8px; font-size: 13px; color: #f2c14e; } .qbr-note:empty { display: none; }
`;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const btn = text => { const b = el('button', 'qbr-btn', text); b.type = 'button'; return b; };

/** Plain text with True Sight marks, built from text nodes and spans only. */
export function sightText(text, tag = 'span') {
  const out = el(tag);
  const s = String(text ?? '');
  for (const p of markPieces(s, 0, s.length, trueSight(s))) {
    const n = el('span', p.flag ? 'qbr-flag' : '', p.text);
    if (p.flag) n.title = `True Sight flag: ${p.flag}`;
    out.append(n);
  }
  return out;
}

/**
 * The Bridge settings panel: on/off, link status, the Realm login (kept in storage only), placeholders for the help
 * text, registrations and refusals as plain text with True Sight. With the Bridge off no client exists and nothing is
 * read or sent. Reports arrive as queue changes on the store. Returns { ring(), open(), destroy() } so integration can
 * pass the Recall Bell on.
 * @param {{ store: object, realmId: string, storage: Storage, connect: Function, now?: () => Date, rules?: object }} o
 */
export function mountBridgePanel(container, { store, realmId, storage, connect, now = () => new Date(), rules = DEFAULT_RULES }) {
  if (!document.getElementById(STYLE_ID)) { const s = el('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.append(s); }
  let settings = loadBridgeSettings(storage, realmId), client = null, halted = false, link = 'off';
  const root = el('section', 'qbr-root');
  root.setAttribute('aria-label', 'The Bridge');
  const status = el('div', 'qbr-status'); status.setAttribute('role', 'status');
  const toggle = btn('Bridge: off');
  const userIn = el('input', 'qbr-input'); userIn.autocomplete = 'off';
  const passIn = el('input', 'qbr-input'); passIn.type = 'password'; passIn.autocomplete = 'off';
  const portIn = el('input', 'qbr-input'); portIn.inputMode = 'numeric';
  const labelled = (text, input) => { const l = el('label', 'qbr-label', text); l.append(input); return l; };
  const save = btn('Save settings'), open = btn('Open the Bridge');
  const note = el('div', 'qbr-note'); note.setAttribute('role', 'status');
  const help = el('pre', 'qbr-help');
  const regs = el('ul', 'qbr-list'), refusals = el('ul', 'qbr-list');
  const row = el('div', 'qbr-row'); row.append(toggle, save, open);
  root.append(el('h2', 'qbr-title', 'The Bridge'), status, row, labelled('Login name', userIn), labelled('Password (kept in this browser only)', passIn),
    labelled('Port', portIn), note, help, el('h3', 'qbr-label', 'Registered agents'), regs, el('h3', 'qbr-label', 'Refused messages'), refusals);
  container.append(root);

  const regMap = new Map();
  const draw = () => {
    toggle.textContent = `Bridge: ${settings.on ? 'on' : 'off'}`; toggle.setAttribute('aria-pressed', String(settings.on));
    status.dataset.s = !settings.on ? 'off' : halted ? 'halted' : link === 'up' ? 'up' : 'down';
    status.textContent = !settings.on ? 'The Bridge is off. The game runs on its own ledger and /work.'
      : halted ? 'Connected. The Recall Bell halted the Bridge: no work is handed out.'
      : link === 'up' ? 'Connected to the Bridge.' : 'Waiting for the Bridge on 127.0.0.1.';
    open.hidden = !(settings.on && halted);
    help.textContent = JSON.stringify(credentialPlaceholder({ v: BRIDGE_VERSION, realmId,
      mqtt: { username: settings.username || '<mqtt login>', password: '' } }), null, 2);
    regs.replaceChildren(...[...regMap.values()].map(r => { const li = el('li'); li.append(sightText(`${r.name} (${r.keeperId})${r.skills.length ? ': ' + r.skills.join(', ') : ''}`)); return li; }));
  };

  async function onEvent(e) {
    if (e.kind === 'link') link = e.up ? 'up' : 'down';
    else if (e.kind === 'status') halted = e.halted;
    else if (e.kind === 'registered') regMap.set(e.registration.keeperId, e.registration);
    else if (e.kind === 'refused') {
      const li = el('li'); li.append(sightText(`${e.what}${e.keeperId ? ` from ${e.keeperId}` : ''}: ${e.problems.map(p => `${p.field} ${p.problem}`).join('; ')}`));
      refusals.prepend(li); while (refusals.children.length > 10) refusals.lastChild.remove();
    } else if (e.kind === 'report') {
      const res = reportToQueue(await store.snapshot(), e.message, now(), rules);
      if (res.refused || res.problems.length) note.textContent = `A report was set aside: ${res.refused || res.problems.map(p => `${p.field} ${p.problem}`).join('; ')}`;
      else await applyChanges(store, res.changes);
    }
    draw();
  }
  async function connectNow() {
    stop();
    if (!settings.on) return draw();
    client = createBridgeClient({ connect, realmId, settings, on: ev => { onEvent(ev).catch(() => {}); } });
    client.start();
    client.setKeepers(((await store.snapshot()).keepers || []).map(k => k.id));
    draw();
  }
  function stop() { client?.stop(); client = null; link = 'off'; halted = false; regMap.clear(); }

  toggle.onclick = () => { settings = { ...settings, on: !settings.on }; saveBridgeSettings(storage, realmId, settings); connectNow(); };
  save.onclick = () => {
    const port = Number(portIn.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { note.textContent = 'The port is a number from 1 to 65535.'; return; }
    settings = { ...settings, port, username: userIn.value, password: passIn.value };
    saveBridgeSettings(storage, realmId, settings); note.textContent = 'Saved in this browser.'; connectNow();
  };
  open.onclick = () => { client?.open(); };
  userIn.value = settings.username; passIn.value = settings.password; portIn.value = String(settings.port);
  draw();
  if (settings.on) connectNow();

  return {
    ring: () => (client?.bell() ?? false), open: () => (client?.open() ?? false),
    refresh: async () => client?.setKeepers(((await store.snapshot()).keepers || []).map(k => k.id)),
    destroy() { stop(); root.remove(); },
  };
}
