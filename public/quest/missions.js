// R5, missions (PLAN-engine.md, "Missions, Keepers and the Bridge"): the player goes on one mission at a time. A
// mission is a parent Work and its child Works (Work.parentId); a Work with neither is a side mission. Its saga is
// their Hall, whose release date (Hall.dueAt) sets the clock. Pure functions, like boss.js: they read a Ledger
// snapshot and take and return MissionPlay (the save's play.missions, never ledger data) plus the events to log.
// Real work still moves only through the /work queue and the Riddle rules; a mission only reads where it stands.
// Backlog pressure is a saga's open Work weight against the days left to its release date. At rules.pressureGate it
// locks side content (GATED), never real work: /work, Riddles, the Lodge, the Recall Bell and saves are never gated.
import { DEFAULT_RULES, MISSION_MOVES, WORK_RESOLVED, canMove, isGameOnly, emptyMissionPlay } from './contract.js';

const DAY = 24 * 3600e3;
const clone = v => JSON.parse(JSON.stringify(v));
const round2 = n => Math.round(n * 100) / 100;
const real = w => w && !isGameOnly(w);
const resolved = w => WORK_RESOLVED.includes(w.status);

/** The only things pressure ever locks. Everything else, real work above all, stays open. */
export const GATED = ['lore-quests', 'lore-tab', 'explore'];

// ---------- missions ----------
/** A mission's Works: the parent (or the lone Work of a side mission) first, then its children. Game-only left out. */
export function missionWorks(ledger, id) {
  const works = (ledger.works || []).filter(real);
  const head = works.find(w => w.id === id && !w.parentId);
  if (!head) return [];
  return [head, ...works.filter(w => w.parentId === id)];
}

/** What a Work weighs for pressure: its own weight if set, else priority × size, plus one per failure. */
export function workWeight(w, rules = DEFAULT_RULES) {
  if (typeof w.weight === 'number') return w.weight;
  return (rules.pressurePriority[w.priority] || 1) * (rules.pressureSize[w.size] || 1) + rules.pressureFailure * (w.failures || 0);
}

/**
 * Every saga and its missions, the sagas under the most pressure first. Works with no Hall are repair quests and
 * belong to no saga; game-only Works never become missions.
 * @returns {{ hallId: string, hall: string, marchId: string, march: string, dueAt: string|null,
 *             pressure: ReturnType<typeof pressure>, missions: { id: string, title: string, workIds: string[],
 *             keeperId: string|null, total: number, resolved: number, open: number, side: boolean,
 *             state: string|null, dueAt: string|null }[] }[]}
 */
export function missionsOf(ledger, mp = emptyMissionPlay(), now = new Date(), rules = DEFAULT_RULES) {
  const marches = new Map((ledger.marches || []).map(m => [m.id, m]));
  const works = (ledger.works || []).filter(real);
  return (ledger.halls || []).map(h => {
    const heads = works.filter(w => w.hallId === h.id && !w.parentId);
    const missions = heads.map(head => {
      const ws = missionWorks(ledger, head.id);
      const done = ws.filter(resolved).length;
      return {
        id: head.id, title: head.title, workIds: ws.map(w => w.id),
        keeperId: head.keeperId || ws.find(w => w.keeperId)?.keeperId || null,
        total: ws.length, resolved: done, open: ws.length - done, side: ws.length === 1,
        state: mp.runs?.[head.id]?.state || null, dueAt: head.dueAt || h.dueAt || null,
      };
    });
    return { hallId: h.id, hall: h.name, marchId: h.marchId, march: marches.get(h.marchId)?.name || h.marchId,
      dueAt: h.dueAt || null, pressure: pressure(ledger, h.id, now, rules), missions };
  }).sort((a, b) => b.pressure.level - a.pressure.level || a.hallId.localeCompare(b.hallId));
}

const ev = (now, kind, ref) => ({ at: new Date(now).toISOString(), kind, ref });
const move = (run, to) => { if (!canMove(MISSION_MOVES, run.state, to)) throw new Error(`mission ${run.id}: ${run.state} → ${to}`); run.state = to; };

/**
 * Go on a mission. The current one (if any) is shelved; a shelved mission picks up where it was (active), a new one
 * starts with its briefing. problem is set, and nothing changes, for a mission that doesn't exist or is done.
 */
export function begin(mp, ledger, id, now = new Date()) {
  const out = clone(mp || emptyMissionPlay());
  const none = problem => ({ mp: clone(mp || emptyMissionPlay()), events: [], problem });
  if (!missionWorks(ledger, id).length) return none(`there is no mission ${id}`);
  const run = out.runs[id];
  if (run?.state === 'done') return none('that mission is already done');
  if (out.current === id) return none(null);
  const events = [];
  const cur = out.current && out.runs[out.current];
  if (cur && !['done', 'shelved'].includes(cur.state)) { move(cur, 'shelved'); events.push(ev(now, 'mission.shelved', cur.id)); }
  if (run) { move(run, 'active'); events.push(ev(now, 'mission.resumed', id)); }
  else { out.runs[id] = { id, state: 'briefing', startedAt: new Date(now).toISOString() }; events.push(ev(now, 'mission.begun', id)); }
  out.current = id;
  return { mp: out, events, problem: null };
}

/**
 * Follows the current mission's Works: a Riddle waiting on the player makes a cliffhanger, its answer clears it, and
 * once every Work is resolved the debrief is due. A mission still in its briefing waits for it to be heard.
 */
export function tickMission(mp, ledger, now = new Date()) {
  const out = clone(mp || emptyMissionPlay());
  const run = out.current && out.runs[out.current];
  if (!run || !['active', 'cliffhanger'].includes(run.state)) return { mp: out, events: [] };
  const ws = missionWorks(ledger, run.id);
  const ids = new Set(ws.map(w => w.id));
  const waiting = (ledger.riddles || []).some(r => ids.has(r.workId) && r.state === 'open' && !isGameOnly(r));
  const events = [];
  if (ws.length && ws.every(resolved)) move(run, 'debrief');
  else if (waiting && run.state === 'active') { move(run, 'cliffhanger'); events.push(ev(now, 'mission.cliffhanger', run.id)); }
  else if (!waiting && run.state === 'cliffhanger') move(run, 'active');
  return { mp: out, events };
}

/** The briefing has been heard: the mission is under way. */
export function hearBriefing(mp, now = new Date()) {
  const out = clone(mp || emptyMissionPlay());
  const run = out.current && out.runs[out.current];
  if (run?.state !== 'briefing') return { mp: out, events: [] };
  move(run, 'active');
  return { mp: out, events: [] };
}

/** The debrief has been heard: the mission is done, and the player is free to choose the next one. */
export function hearDebrief(mp, now = new Date()) {
  const out = clone(mp || emptyMissionPlay());
  const run = out.current && out.runs[out.current];
  if (run?.state !== 'debrief') return { mp: out, events: [] };
  move(run, 'done');
  run.endedAt = new Date(now).toISOString();
  out.current = null;
  return { mp: out, events: [ev(now, 'mission.debriefed', run.id), ev(now, 'mission.done', run.id)] };
}

// ---------- pressure ----------
/**
 * A saga's backlog pressure, 0..1: its open Work weight against what it can clear before the release date
 * (rules.pressurePerDay a day). Past the date with work open it is 1; with no date, rules.pressureFull is full.
 * why: one plain line saying where the number comes from.
 */
export function pressure(ledger, hallId, now = new Date(), rules = DEFAULT_RULES) {
  const h = (ledger.halls || []).find(x => x.id === hallId);
  const open = (ledger.works || []).filter(w => real(w) && w.hallId === hallId && !resolved(w));
  const openWeight = round2(open.reduce((s, w) => s + workWeight(w, rules), 0));
  const name = h?.name || hallId;
  if (!h?.dueAt) {
    const level = round2(Math.min(1, openWeight / rules.pressureFull));
    return { level, openWeight, daysLeft: null, overdue: false,
      why: `${openWeight} weight of open work in ${name}, which has no release date (${rules.pressureFull} is full pressure).` };
  }
  const daysLeft = round2((Date.parse(h.dueAt) - new Date(now).getTime()) / DAY);
  const overdue = daysLeft <= 0;
  const level = !openWeight ? 0 : overdue ? 1 : round2(Math.min(1, openWeight / (rules.pressurePerDay * daysLeft)));
  const why = !openWeight ? `Nothing is open in ${name}.`
    : overdue ? `${name}'s release date has passed with ${openWeight} weight of work still open.`
    : `${openWeight} weight of open work in ${name}, ${daysLeft} days to the release; about ${round2(rules.pressurePerDay * daysLeft)} can be cleared by then.`;
  return { level, openWeight, daysLeft, overdue, why };
}

/**
 * Whether side content is locked: by the saga under the most pressure, at or above rules.pressureGate. Only the
 * things in GATED ever lock; real work never does.
 */
export function gated(ledger, now = new Date(), rules = DEFAULT_RULES) {
  let top = { level: 0, hallId: null, why: 'No saga is under pressure.' };
  for (const h of ledger.halls || []) {
    const p = pressure(ledger, h.id, now, rules);
    if (p.level > top.level) top = { level: p.level, hallId: h.id, why: p.why };
  }
  return { gated: top.level >= rules.pressureGate, ...top };
}
