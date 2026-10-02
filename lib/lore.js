// Game rules derived from real state: the Long Night (usage limits), bosses (blockers),
// where each Keeper lives (town or worktree camp). Pure functions over collected facts.
const crypto = require('crypto');

const hash = (...xs) => crypto.createHash('sha1').update(xs.join('\u0000')).digest('hex').slice(0, 12);
const LIMIT_RE = /hit your .*limit|limit · resets/i;
const RESET_RE = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;
const WT_RE = /^(.*?\/(?:\.claude\/worktrees|[^/]*worktrees)\/[^/]+)/;
const DAY = 24 * 3600e3;

// ---------- the Long Night ----------
const resetCache = new Map();
function resetTime(text, fromIso) {
  const key = `${text}|${fromIso}`;
  if (resetCache.has(key)) return resetCache.get(key);
  const m = RESET_RE.exec(text);
  let out = null;
  if (m) {
    const hour = (+m[1] % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    const min = +(m[2] || 0);
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: m[4], hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
      let t = Math.ceil(Date.parse(fromIso) / 60e3) * 60e3;
      for (let i = 0; i < 60 * 24 * 8 && !out; i++, t += 60e3) {
        const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
        if (+p.hour === hour && +p.minute === min) out = new Date(t).toISOString();
      }
    } catch {}
  }
  resetCache.set(key, out);
  return out;
}

// Night falls when the newest thing any Keeper said was a usage-limit notice, until its reset time.
function computeNight(allFacts, latestActivity) {
  let limit = null, latestOther = 0;
  const limited = new Set();
  for (const f of Object.values(allFacts)) for (const s of f.sessions) {
    if (s.blocked) limited.add(s.file);
    for (const r of s.recent) {
      const ts = Date.parse(r.ts || 0);
      if (LIMIT_RE.test(r.text)) { if (!limit || ts > Date.parse(limit.ts)) limit = r; }
      else latestOther = Math.max(latestOther, ts);
    }
  }
  if (!limit) return null;
  // Any other transcript written after the notice means Keeper is still awake somewhere.
  const elsewhere = latestActivity ? latestActivity(limited) : 0;
  if (latestOther > Date.parse(limit.ts) || elsewhere > Date.parse(limit.ts) + 60e3) return null;
  const until = resetTime(limit.text, limit.ts) || new Date(Date.parse(limit.ts) + 5 * 3600e3).toISOString();
  if (Date.parse(until) <= Date.now()) return null;
  return { since: limit.ts, until, text: limit.text.slice(0, 160) };
}

// ---------- places ----------
function locationOf(p, s) {
  const roots = [p.path, ...(p.extraPaths || [])];
  const under = c => roots.some(r => c === r || c.startsWith(r + '/'));
  const top = Object.entries(s.cwdHits).filter(([c]) => under(c)).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const m = WT_RE.exec(top[0]);
  return m ? m[1] : null; // null = the town itself
}

function campsFor(p, sessions, worktrees = []) {
  const by = new Map();
  for (const w of worktrees) by.set(w.root, { id: `c-${hash(w.root)}`, root: w.root, name: w.root.split('/').pop(), branch: w.branch, sessions: 0, lastTs: w.lastTs });
  for (const s of sessions) {
    const root = locationOf(p, s);
    if (!root) continue;
    const c = by.get(root) || { id: `c-${hash(root)}`, root, name: root.split('/').pop(), branch: s.branch, sessions: 0, lastTs: s.lastTs };
    c.sessions++;
    if (Date.parse(s.lastTs || 0) > Date.parse(c.lastTs || 0)) { c.lastTs = s.lastTs; c.branch = s.branch; }
    by.set(root, c);
  }
  return [...by.values()]
    .sort((a, b) => Date.parse(b.lastTs || 0) - Date.parse(a.lastTs || 0))
    .slice(0, 4)
    .map(c => ({ ...c, kind: c.sessions >= 2 ? 'hamlet' : 'camp', label: prettyCamp(c.name) }));
}

function prettyCamp(name) {
  const m = /(LIN-\d+)-(?:\d+-)?(.*)/i.exec(name);
  if (m) return `${m[1].toUpperCase()} ${m[2].split('-').slice(0, 3).join(' ')}`.trim();
  return name.replace(/^pc-/, '').split('-').slice(0, 3).join(' ');
}

// ---------- what each Keeper is up to ----------
function failStreak(s) {
  let n = 0;
  for (let i = s.checks.length - 1; i >= 0 && s.checks[i].failed; i--) n++;
  return n;
}

function keeperState(s, night) {
  if (night || s.blocked) return 'sleeping';
  if (s.pendingAsk?.length || s.openQuestion) return 'question';
  if (failStreak(s) >= 2) return 'failing';
  if (s.looping) return 'looping';
  if (s.stalled) return 'stalled';
  return s.status === 'working' ? 'working' : 'idle';
}

const BOSS = {
  question: { name: 'The Waiting Sphinx', lore: 'It guards the path until someone answers its riddle.' },
  failing: { name: 'The Red Golem', lore: 'Born from failing checks. Every rerun that fails makes it stronger.' },
  looping: { name: 'The Ouroboros Wyrm', lore: 'It chases its own tail, and the work goes round in circles.' },
  stalled: { name: 'The Stalling Fog', lore: 'A grey fog where a session went silent mid-step.' },
};

function detectBosses(p, f, state) {
  const out = [];
  for (const s of f.sessions) {
    if (Date.now() - Date.parse(s.lastTs || 0) > DAY || s.blocked) continue;
    const loc = locationOf(p, s);
    const base = { project: p.id, session: s.id, sessionTitle: s.title, location: loc ? `c-${hash(loc)}` : 'town' };
    const qs = s.pendingAsk?.length ? s.pendingAsk.map(q => ({ id: `ask-${hash(s.id, q.question)}`, q: q.question }))
      : s.openQuestion ? [{ id: `q-${hash(s.id, s.openQuestion)}`, q: s.openQuestion }] : [];
    if (qs.length) {
      for (const { id, q } of qs) out.push({
        ...base, id, kind: 'question', detail: q,
        steps: [{ id: 'answer', title: 'Answer the riddle', owner: 'you', action: 'answer', decisionId: id, done: !!state.decisions[id] }],
      });
      continue;
    }
    const streak = failStreak(s);
    const last = s.checks[s.checks.length - 1];
    if (streak >= 2) out.push({ ...base, id: `fail-${s.id}`, kind: 'failing', detail: `"${last.cmd}" failed ${streak} times in a row`, evidence: last.out });
    else if (s.looping) out.push({ ...base, id: `loop-${s.id}`, kind: 'looping', detail: 'The last messages keep repeating.', evidence: s.recent.slice(-4).map(r => r.text.slice(0, 160)).join('\n') });
    else if (s.stalled) out.push({ ...base, id: `stall-${s.id}`, kind: 'stalled', detail: `No word from Keeper since a ${s.lastKind === 'tool' ? 'tool call' : 'prompt'}.`, evidence: (s.lastAssistant || '').slice(0, 300) });
  }
  return out.map(b => ({ ...b, ...BOSS[b.kind] }));
}

function fallbackSteps(kind) {
  return {
    failing: [
      { title: 'Read the failing output and find the cause', owner: 'keeper' },
      { title: 'Fix it and rerun the check', owner: 'keeper' },
      { title: 'Review the fix', owner: 'you' },
    ],
    looping: [
      { title: 'Decide: is this loop still useful?', owner: 'you' },
      { title: 'Explain why nothing is changing', owner: 'keeper' },
      { title: 'Break the loop or change approach', owner: 'keeper' },
    ],
    stalled: [
      { title: 'Check whether the session is still alive', owner: 'you' },
      { title: 'Report status and continue', owner: 'keeper' },
    ],
  }[kind] || [];
}

module.exports = { hash, computeNight, campsFor, locationOf, keeperState, detectBosses, fallbackSteps, failStreak, LIMIT_RE, DAY };
