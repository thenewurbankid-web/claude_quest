// R5 UI: the current mission on the HUD, and the briefing and debrief a Keeper speaks (PLAN-engine.md, "Missions,
// Keepers and the Bridge"). The text helpers are pure and read a Ledger snapshot; mountMissionHud draws and never
// touches a store; talk() runs a briefing or debrief through conversation.js and reports it heard to the caller.
// Safety: Work titles are real text and go in through textContent only. Styles are scoped under qmh-.
import { missionsOf } from './missions.js';

const STATE_LABEL = { briefing: 'Briefing', active: 'Under way', cliffhanger: 'A Riddle waits', debrief: 'Debrief due',
  done: 'Done', shelved: 'Set aside' };

/** One mission with its saga, or null. */
export function findMission(ledger, mp, id, now = new Date(), rules) {
  for (const saga of missionsOf(ledger, mp, now, rules)) {
    const mission = saga.missions.find(m => m.id === id);
    if (mission) return { saga, mission };
  }
  return null;
}

/** Who speaks for a mission: its Keeper if it has one, else the Hall's own voice. */
export function speakerFor(ledger, mission) {
  const k = (ledger.keepers || []).find(x => x.id === mission.keeperId);
  return { name: k?.name || 'The Hall steward' };
}

const days = n => `${Math.max(1, Math.ceil(n))} day${Math.ceil(n) === 1 ? '' : 's'}`;

/** The countdown to a saga's release date, in plain words. */
export function countdown(saga) {
  const d = saga.pressure.daysLeft;
  if (!saga.dueAt || d === null) return 'No release date';
  return saga.pressure.overdue ? 'Past its release date' : `${days(d)} to the release`;
}

/** A short line for the HUD, or null with no current mission. */
export function hudView(ledger, mp, now = new Date(), rules) {
  const run = mp?.current && mp.runs?.[mp.current];
  const found = run && findMission(ledger, mp, run.id, now, rules);
  if (!found) return null;
  const { saga, mission } = found;
  return { id: mission.id, title: mission.title, state: run.state, stateLabel: STATE_LABEL[run.state] || run.state,
    progress: `${mission.resolved} of ${mission.total} done`, countdown: countdown(saga) };
}

/** What the Keeper says when a mission begins. Real facts, in plain words. */
export function briefingLines(ledger, mp, id, now = new Date(), rules) {
  const f = findMission(ledger, mp, id, now, rules);
  if (!f) return [];
  const { saga, mission: m } = f;
  const lines = [m.side ? `A small errand: ${m.title}.` : `The mission is ${m.title}, in ${saga.hall}.`,
    m.side ? 'One piece of work, nothing more.' : `There are ${m.total} pieces of work in it; ${m.resolved} are already settled.`];
  if (saga.dueAt) lines.push(`${countdown(saga)}. ${saga.pressure.why}`);
  lines.push('Come back when you are ready, and I will tell you what is waiting.');
  return lines;
}

/** What the Keeper says when every Work in the mission is resolved. */
export function debriefLines(ledger, mp, id, now = new Date(), rules) {
  const f = findMission(ledger, mp, id, now, rules);
  if (!f) return [];
  const { saga, mission: m } = f;
  const left = saga.missions.filter(x => x.open > 0 && x.id !== id).length;
  return [`${m.title} is finished: ${m.resolved} of ${m.total} pieces of work settled.`,
    left ? `${saga.hall} still has ${left} other mission${left === 1 ? '' : 's'} open.` : `${saga.hall} has nothing left open. Its Sealed Hall can be opened.`];
}

/** Speak the briefing or debrief through conversation.js (say()), then resolve. */
export async function talk(conversation, kind, ledger, mp, id, now = new Date(), rules) {
  const lines = (kind === 'debrief' ? debriefLines : briefingLines)(ledger, mp, id, now, rules);
  const f = findMission(ledger, mp, id, now, rules);
  if (!lines.length || !f) return false;
  await conversation.say(lines, speakerFor(ledger, f.mission));
  return true;
}

const CSS = `
.qmh{position:fixed;top:64px;left:16px;z-index:900;max-width:min(300px,calc(100vw - 32px));padding:8px 12px;border-radius:10px;
  background:rgba(24,18,12,.88);border:1px solid rgba(201,162,74,.45);color:#f1ebe0;font:12px/1.4 system-ui,sans-serif}
.qmh[hidden]{display:none}
.qmh-t{font:600 14px Georgia,serif;color:#e8c77a;overflow-wrap:anywhere}
.qmh-s{color:#a89f8c}
.qmh-s b{color:#f6e7bf;font-weight:600}
`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/** @returns {{ update: (view: ReturnType<typeof hudView>) => void, unmount: () => void }} */
export function mountMissionHud(container) {
  if (!document.querySelector('style[data-qmh]')) { const s = el('style', null, CSS); s.dataset.qmh = ''; document.head.append(s); }
  const root = el('div', 'qmh');
  root.hidden = true;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', 'Current mission');
  container.append(root);
  return {
    update(view) {
      root.hidden = !view;
      if (!view) return;
      const s = el('div', 'qmh-s');
      s.append(el('b', null, view.stateLabel), document.createTextNode(` · ${view.progress} · ${view.countdown}`));
      root.replaceChildren(el('div', 'qmh-t', view.title), s);
    },
    unmount() { root.remove(); },
  };
}
