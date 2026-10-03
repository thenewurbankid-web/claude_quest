// The R2 playtest backlog (PLAN-engine.md, "R2 playtest criteria"): the sample Realm with its open Riddles swapped for
// three fake questions (ids p1-p3, nothing real in them), one normal, one risk:high, one on the never-in-game list, which together with the sample's
// deferred Riddle cross the boss threshold. Times are set from `now`, so the backlog never fades before it is played.
// heavier: the second session's backlog, "a day later": every question a day older, the first put off twice and the
// second once (the third is on the never list and only waits).
// Their ages (6, 18 and 30 hours) give the fight one plain head and two dim ones (PLAN-fight.md); heavier makes two of them echo.
const HOUR = 3600e3;
const clone = v => JSON.parse(JSON.stringify(v));

export const PLAYTEST_RIDDLES = [
  { id: 'p1', workId: 'w6', marchId: 'orchard', risk: 'normal',
    text: 'The seed list has 40 entries with two spellings of the same plant. Combine the spellings or keep both?',
    line: 'Some seed packets carry two names for one plant. Shall we call them one?',
    options: ['Keep both', 'Use the first spelling', 'Ask me later'] },
  { id: 'p2', workId: 'w4', marchId: 'ferry', risk: 'high',
    text: 'Charge the first customers monthly or yearly by default?',
    line: 'The ferryman asks how passengers should pay their fare.',
    options: ['Monthly', 'Yearly', 'Ask me later'] },
  { id: 'p3', workId: 'w11', marchId: 'ferry', risk: 'normal',
    text: 'The staging server needs the admin password to finish the setup. What is it?',
    line: 'A locked gate, and the Keeper wants the word that opens it.',
    options: ['Ask me later'] },
];

/** A whole ledger for the playtest, from the sample Realm. */
export function playtestRealm(sample, now = new Date(), { heavier = false } = {}) {
  const l = clone(sample), t = now.getTime();
  const iso = ms => new Date(ms).toISOString();
  const age = heavier ? 24 : 0;
  // The sample's open Riddles leave; its sealed and deferred ones stay as history and weight.
  l.riddles = l.riddles.filter(r => r.state !== 'open').map(r => r.state === 'deferred'
    ? { ...r, raisedAt: iso(t - (48 + age) * HOUR), deferredUntil: iso(t + 20 * HOUR), deferCount: (r.deferCount || 0) + (heavier ? 1 : 0) }
    : r);
  if (!l.works.some(w => w.id === 'w11')) {
    l.works.push({ id: 'w11', marchId: 'ferry', hallId: 'ferry-b',
      title: 'Staging server setup', status: 'blocked', priority: 'medium', size: 'S', keeperId: 'k4',
      createdAt: iso(t - 72 * HOUR), updatedAt: iso(t - 6 * HOUR) });
    const k4 = l.keepers.find(k => k.id === 'k4');
    if (k4) k4.status = 'busy';
  }
  PLAYTEST_RIDDLES.forEach((p, i) => {
    l.riddles.push({ ...clone(p), state: 'open', steward: null, raisedAt: iso(t - (6 + i * 12 + age) * HOUR),
      deferCount: heavier ? [2, 1, 0][i] : 0 });
  });
  l.events = [...(l.events || []), ...PLAYTEST_RIDDLES.map((p, i) =>
    ({ at: iso(t - (6 + i * 12 + age) * HOUR), kind: 'riddle.raised', ref: p.id }))];
  return l;
}
