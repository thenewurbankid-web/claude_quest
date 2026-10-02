// Claude Quest server: scans projects, narrates them with a local model, serves the game,
// and runs the control channel (inbox, live delivery, stop, wake) the Claude Code hooks read.
// Communication never calls Claude. Only an explicit in-game "wake" starts a Claude run.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const cfg = require('./config.json');
const store = require('./lib/store');
const { collectAll, latestActivity } = require('./lib/collect');
const { generateStory, fallbackStory, askModel, factsText, ago, clip } = require('./lib/story');
const L = require('./lib/lore');
const Paperclip = require('./lib/paperclip');
const Areas = require('./lib/areas');

const PORT = +process.env.PORT || cfg.port;
const PUBLIC = path.join(__dirname, 'public');
const RUNS = path.join(store.DATA, 'runs');
fs.mkdirSync(RUNS, { recursive: true });
const hash = L.hash;

const state = Object.assign(
  { towns: {}, stories: {}, missions: {}, decisions: {}, bosses: {}, awaiting: {}, trophies: {}, firstSeen: {},
    stats: { answers: 0, missionsDone: 0, bosses: 0, messages: 0, days: [] }, badges: [] },
  store.read('state.json', {}),
);
let events = store.read('events.json', []);
const seenEvents = new Set(events.map(e => e.id));
const notifiedDelivered = new Set(store.read('inbox.json', []).filter(m => m.deliveredAt).map(m => m.id));
let facts = {}, prevFacts = {};
let night = null;
const runs = new Map();
const generating = new Set();
const clients = new Set();
let world = null, worldJson = '';

const saveState = () => store.write('state.json', state);

// ---------- the Guild Hall (Paperclip) ----------
const pc = Paperclip.client(process.env.CQ_PAPERCLIP_URL || cfg.paperclip?.url || Paperclip.DEFAULT_URL);
let guild = { up: false, at: null };
async function pollGuild() {
  const save = store.read('world.json', {});
  const next = await Paperclip.snapshot(pc, save.paperclip?.companyId || null);
  if (next.up !== guild.up && guild.at) pushEvent(null, next.up ? 'guild-open' : 'guild-closed',
    next.up ? 'The Guild Hall opens its doors again.' : 'The Guild Hall is closed. Missions wait until it opens.');
  guild = next;
  if (guild.up) await registerAreas();
  rebuild();
}

// Lands charted while the Guild Hall was closed get their Paperclip project once it opens.
async function registerAreas() {
  if (!guild.up) return;
  const save = Areas.save();
  if (!save.paperclip?.companyId) return;
  for (const a of (save.areas || []).filter(x => !x.retiredAt && !x.projectId)) {
    try { Areas.update(a.id, { projectId: await Paperclip.ensureArea(pc, save.paperclip.companyId, { name: a.name, cwd: a.path }) }); }
    catch (e) { console.warn(`[guild] register ${a.id}: ${e.message}`); }
  }
}
// Charted lands come from the save file (data/world.json), not config.json.
let areas = Areas.projects();
const projectById = id => areas.find(p => p.id === id);
const sessionById = (pid, sid) => facts[pid]?.sessions.find(s => s.id === sid);

function claudeBin() {
  if (cfg.claudeBin) return cfg.claudeBin;
  try { return execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() || 'claude'; } catch { return 'claude'; }
}
const CLAUDE = claudeBin();

// ---------- events, stats, badges ----------
function pushEvent(project, kind, text, id = hash(project, kind, text), extra = {}) {
  if (seenEvents.has(id)) return;
  seenEvents.add(id);
  const e = { id, at: new Date().toISOString(), project, kind, text: clip(text, 280), ...extra };
  events.unshift(e);
  events = events.slice(0, 200);
  store.write('events.json', events);
  broadcast('event', e);
  link?.event(e);
}

function tally(key, n = 1) {
  state.stats[key] = (state.stats[key] || 0) + n;
  const today = new Date().toISOString().slice(0, 10);
  if (!state.stats.days.includes(today)) state.stats.days = [...state.stats.days, today].slice(-60);
  checkBadges();
  saveState();
}

function award(id, name, desc, project = null) {
  if (state.badges.some(b => b.id === id)) return;
  state.badges.push({ id, name, desc, project, at: new Date().toISOString() });
  saveState();
  pushEvent(project, 'badge', `You earned the ${name}! ${desc}`, `badge-${id}`);
}

function streak() {
  const days = new Set(state.stats.days);
  let n = 0;
  for (let d = new Date(); days.has(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 1)) n++;
  return n;
}

function checkBadges() {
  const s = state.stats;
  if (s.answers >= 1) award('first-word', 'First Word Badge', 'Answered your first riddle.');
  if (s.answers >= 10) award('oracle', 'Oracle Badge', 'Answered 10 riddles.');
  if (s.missionsDone >= 5) award('taskmaster', 'Taskmaster Badge', 'Finished 5 missions.');
  if (s.bosses >= 3) award('bossbreaker', 'Bossbreaker Badge', 'Cleared 3 blockers.');
  if (s.messages >= 10) award('herald', 'Herald Badge', 'Sent 10 messages to Claude.');
  if (streak() >= 3) award('streak-3', 'Ember Streak Badge', 'Played 3 days in a row.');
}

// ---------- scanning ----------
function diffEvents(p, prev, cur) {
  if (prev) {
    const old = new Set(prev.commits.map(c => c.hash));
    for (const c of cur.commits.filter(c => !old.has(c.hash)).reverse()) pushEvent(p.id, 'commit', `New commit: ${c.subject}`, `commit-${c.hash}`);
  }
  for (const s of cur.sessions) {
    if (Date.now() - Date.parse(s.lastTs || 0) > L.DAY) continue;
    const wait = state.awaiting[s.id];
    const latest = s.recent[s.recent.length - 1];
    if (wait && latest && Date.parse(latest.ts) > Date.parse(wait.since)) {
      delete state.awaiting[s.id];
      pushEvent(p.id, 'reply', latest.text, `reply-${hash(s.id, latest.ts)}`, { session: s.id });
      seenEvents.add(`upd-${hash(s.id, s.lastAssistant)}`);
    }
    if (s.blocked) continue;
    if (s.lastKind === 'assistant' && s.lastAssistant) pushEvent(p.id, 'update', `"${s.title || 'Session'}": ${s.lastAssistant}`, `upd-${hash(s.id, s.lastAssistant)}`, { session: s.id });
  }
}

const recentKey = (b, f) => hash(b.evidence || '', JSON.stringify(f.sessions.find(s => s.id === b.session)?.recent.slice(-3) || []));

function syncBosses(p, f) {
  const found = L.detectBosses(p, f, state);
  const ids = new Set(found.map(b => b.id));
  for (const b of found) {
    const cur = state.bosses[b.id];
    if (!cur) {
      state.bosses[b.id] = { ...b, steps: (b.steps || []).map((s, i) => ({ id: s.id || `s${i}`, ...s, state: s.done ? 'done' : 'todo' })), since: new Date().toISOString(), status: 'active' };
      if (b.kind !== 'question') queueJob(`boss-${b.id}`, 2, () => planBoss(b.id));
      pushEvent(p.id, 'boss', `${b.name} appeared! ${b.detail}`, `boss-${b.id}`, { bossId: b.id });
      continue;
    }
    Object.assign(cur, { detail: b.detail, evidence: b.evidence, location: b.location });
    if (b.kind === 'question') {
      for (const st of cur.steps) if (st.decisionId && state.decisions[st.decisionId]) st.state = 'done';
    } else if (cur.planKey !== recentKey(b, f)) queueJob(`boss-${b.id}`, 2, () => planBoss(b.id));
  }
  for (const [id, b] of Object.entries(state.bosses)) {
    if (b.project !== p.id || b.status !== 'active' || ids.has(id)) continue;
    const s = f.sessions.find(x => x.id === b.session);
    if (s && Date.parse(s.lastTs || 0) > Date.parse(b.since)) {
      b.status = 'defeated'; b.defeatedAt = new Date().toISOString();
      state.trophies[p.id] = (state.trophies[p.id] || 0) + 1;
      pushEvent(p.id, 'victory', `${b.name} was defeated! The path in ${townName(p)} is clear.`, `win-${id}`, { bossId: id });
      tally('bosses');
      award(`town-${p.id}`, `${townName(p)} Badge`, `Cleared a blocker in ${p.name}.`, p.id);
    } else b.status = 'faded';
  }
  const old = Object.entries(state.bosses).filter(([, b]) => b.status !== 'active')
    .sort((a, b) => Date.parse(b[1].defeatedAt || b[1].since) - Date.parse(a[1].defeatedAt || a[1].since));
  for (const [id] of old.slice(40)) delete state.bosses[id];
}

function scan() {
  prevFacts = facts;
  areas = Areas.projects();
  facts = collectAll({ ...cfg, projects: areas });
  const wasNight = night;
  night = L.computeNight(facts, latestActivity);
  if (night && !wasNight) pushEvent(null, 'night', `The Ember Well ran dry and the Long Night falls. ${night.text}`, `night-${night.since}`);
  if (!night && wasNight) pushEvent(null, 'dawn', 'Dawn! The Ember Well is full again and Claude wakes.', `dawn-${wasNight.since}`);
  for (const p of areas) {
    const f = facts[p.id];
    if (!f) continue;
    diffEvents(p, prevFacts[p.id], f);
    syncBosses(p, f);
    queueStory(p);
  }
  saveState();
  rebuild();
}

// ---------- local model jobs (one at a time, by priority) ----------
const jobs = [];
let running = false;
function queueJob(key, priority, run) {
  if (jobs.some(j => j.key === key)) return;
  jobs.push({ key, priority, run });
  jobs.sort((a, b) => a.priority - b.priority);
  pump();
}
async function pump() {
  if (running) return;
  running = true;
  while (jobs.length) {
    const j = jobs.shift();
    try { await j.run(); } catch (e) { console.warn(`[job] ${j.key}: ${e.message}`); }
    rebuild();
  }
  running = false;
}

const factsKey = f => hash(
  f.commits.slice(0, 6).map(c => c.hash).join(','),
  f.sessions.slice(0, 4).map(s => `${s.title}|${clip(s.lastAssistant, 300)}|${s.openQuestion}|${!!s.blocked}`).join(';'),
  f.doc?.excerpt?.slice(0, 1500) || '',
);
const acceptedMissions = pid => Object.entries(state.missions).filter(([, m]) => m.project === pid && m.state === 'accepted').map(([id, m]) => ({ id, ...m }));
const townName = p => state.towns[p.id]?.townName || `${p.name} Town`;

function queueStory(p, force = false) {
  const f = facts[p.id];
  const cached = state.stories[p.id];
  const fresh = cached && Date.now() - Date.parse(cached.at) < cfg.storyMinMinutes * 60e3;
  if (!force && cached && (cached.key === factsKey(f) || fresh)) return;
  queueJob(`story-${p.id}`, 3, async () => {
    generating.add(p.id); rebuild();
    const f2 = facts[p.id];
    let story;
    try { story = await generateStory(cfg, p, f2, acceptedMissions(p.id)); }
    catch (e) { console.warn(`[story] ${p.id}: ${e.message}`); story = fallbackStory(p, f2); }
    const prev = state.stories[p.id];
    state.stories[p.id] = { key: factsKey(f2), at: new Date().toISOString(), story };
    if (!state.towns[p.id] || (state.towns[p.id].source === 'template' && story.source === 'ollama')) {
      state.towns[p.id] = { townName: story.townName, motto: story.motto, source: story.source };
    }
    generating.delete(p.id);
    saveState();
    if (prev && story.source === 'ollama') pushEvent(p.id, 'story', `A new chapter in ${townName(p)}: ${story.story[0] || ''}`);
  });
}

const BOSS_SCHEMA = {
  type: 'object',
  properties: { steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, owner: { type: 'string', enum: ['you', 'claude'] }, done: { type: 'boolean' } }, required: ['title', 'owner', 'done'] } } },
  required: ['steps'],
};

async function planBoss(id) {
  const b = state.bosses[id];
  if (!b || b.status !== 'active') return;
  const f = facts[b.project];
  const s = sessionById(b.project, b.session);
  const recent = s?.recent.slice(-3) || [];
  const existing = b.steps.length ? b.steps.map((st, i) => `${i + 1}. [${st.owner}] ${st.title} (${st.state})`).join('\n') : '(none yet)';
  const user = [
    `BLOCKER: ${b.name}: ${b.detail}`,
    b.evidence ? `EVIDENCE:\n${clip(b.evidence, 800)}` : '',
    `SESSION: "${b.sessionTitle}"`,
    `CLAUDE'S LATEST MESSAGES:\n${recent.map(r => `- ${clip(r.text, 300)}`).join('\n') || '(none)'}`,
    `CURRENT STEPS:\n${existing}`,
    b.steps.length
      ? 'Return the same steps in the same order with the same titles. Set done=true for a claude step only if the latest messages show it is finished. You may append one new step if all are done but the blocker remains.'
      : 'Break this blocker into 2 to 4 small steps. owner "you" = a decision or review the developer does; owner "claude" = research or a fix Claude does. All done=false.',
  ].filter(Boolean).join('\n\n');
  let steps;
  try {
    const out = await askModel(cfg, 'You plan small, concrete steps to clear a software development blocker. Titles under 60 characters. Return JSON only.', user, BOSS_SCHEMA, 0.3);
    steps = (out.steps || []).slice(0, 5);
  } catch (e) { console.warn(`[boss] ${id}: ${e.message}`); }
  if (!steps?.length && !b.steps.length) steps = L.fallbackSteps(b.kind).map(st => ({ ...st, done: false }));
  if (steps?.length) {
    if (!b.steps.length) b.steps = steps.map((st, i) => ({ id: `s${i}`, title: clip(st.title, 70), owner: st.owner === 'you' ? 'you' : 'claude', state: 'todo' }));
    else {
      b.steps.forEach((st, i) => {
        if (steps[i]?.done && st.owner === 'claude' && st.state !== 'done') {
          st.state = 'done';
          pushEvent(b.project, 'step', `Claude cleared a step against ${b.name}: ${st.title}`, `step-${id}-${st.id}`, { bossId: id });
        }
      });
      const extra = steps[b.steps.length];
      if (extra && b.steps.every(st => st.state === 'done') && b.steps.length < 6) b.steps.push({ id: `s${b.steps.length}`, title: clip(extra.title, 70), owner: extra.owner === 'you' ? 'you' : 'claude', state: 'todo' });
    }
  }
  if (f) b.planKey = recentKey(b, f);
  saveState();
}

// ---------- control channel ----------
function addToInbox(project, kind, text, extra = {}) {
  const inbox = store.read('inbox.json', []);
  const m = { id: hash(project, text, Date.now(), Math.random()), project, kind, text: clip(text, 2000), createdAt: new Date().toISOString(), deliveredAt: null, ...extra };
  inbox.push(m);
  store.write('inbox.json', inbox.slice(-300));
  return m;
}

function decide(project, d, answer) {
  state.decisions[d.id] = { answer, at: new Date().toISOString() };
  const m = addToInbox(project, 'answer', `Answer to "${d.question}": ${answer}`, { decisionId: d.id, session: d.session || null });
  if (d.session) state.awaiting[d.session] = { since: m.createdAt };
  for (const b of Object.values(state.bosses)) for (const st of b.steps || []) if (st.decisionId === d.id) st.state = 'done';
  tally('answers');
  pushEvent(project, 'sent', `You answered: ${answer}`, `sent-${m.id}`);
  return m;
}

const controlFile = () => store.read('control.json', { stops: {} });

function startRun(p, s, text) {
  const id = hash(s.id, Date.now());
  // CQ_NO_WAKE: a test server records the run but never starts Claude (no tokens, no real session touched).
  if (process.env.CQ_NO_WAKE) {
    const run = { id, project: p.id, session: s.id, title: s.title, startedAt: new Date().toISOString(), status: 'done', dry: true, text };
    runs.set(id, run);
    console.log(`[wake:dry] ${s.id} ${s.title}\n${text}`);
    return run;
  }
  const log = fs.openSync(path.join(RUNS, `${id}.log`), 'a');
  const child = spawn(CLAUDE, ['-p', '--resume', s.id, text], { cwd: s.originCwd || p.path, stdio: ['ignore', log, log], env: process.env, detached: true });
  const run = { id, project: p.id, session: s.id, title: s.title, startedAt: new Date().toISOString(), status: 'running', pid: child.pid };
  runs.set(id, run);
  state.awaiting[s.id] = { since: run.startedAt };
  saveState();
  child.on('error', e => { run.status = 'failed'; run.error = e.message; rebuild(); });
  child.on('exit', code => {
    run.status = code === 0 ? 'done' : 'failed';
    run.endedAt = new Date().toISOString();
    pushEvent(p.id, 'run', `The woken Claude in "${s.title}" went back to rest (${run.status}).`, `run-${id}`);
    rebuild();
  });
  child.unref();
  pushEvent(p.id, 'run', `You woke Claude in "${s.title}". It's working…`, `runstart-${id}`);
  return run;
}

// A message reaches a working session live (at its next tool call); a resting one needs waking.
function sendToSession(p, s, kind, text) {
  if (night) return { night: true };
  const label = { chat: 'The user says (game chat)', command: 'Command from the user', step: 'Boss quest step from the user' }[kind] || 'From the user';
  if (s.status === 'working') {
    const m = addToInbox(p.id, kind, `${label}: ${text}`, { session: s.id, live: true });
    state.awaiting[s.id] = { since: m.createdAt };
    tally('messages');
    pushEvent(p.id, 'sent', `Sent to Claude live: ${text}`, `sent-${m.id}`);
    return { queued: 'live', id: m.id };
  }
  return { needsWake: true };
}

// ---------- world ----------
function townFor(p) {
  const f = facts[p.id] || { commits: [], sessions: [], dirty: 0 };
  const story = state.stories[p.id]?.story || fallbackStory(p, f);
  const town = state.towns[p.id] || { townName: story.townName, motto: story.motto };
  const recent = f.sessions[0];
  const working = f.sessions.find(s => s.status === 'working');
  const camps = L.campsFor(p, f.sessions, f.worktrees);
  const campIds = new Set(camps.map(c => c.id));
  const stops = controlFile().stops;

  const decisions = [];
  for (const s of f.sessions) {
    if (Date.now() - Date.parse(s.lastTs || 0) > L.DAY) continue;
    if (s.pendingAsk?.length) for (const q of s.pendingAsk) decisions.push({
      id: `ask-${hash(s.id, q.question)}`, source: 'claude', session: s.id, sessionTitle: s.title,
      question: q.question, options: (q.options || []).map(o => o.label).filter(Boolean).slice(0, 4),
    });
    else if (s.openQuestion) decisions.push({ id: `q-${hash(s.id, s.openQuestion)}`, source: 'claude', session: s.id, sessionTitle: s.title, question: s.openQuestion, options: ['Yes, go ahead', 'No, hold off'] });
  }
  for (const c of story.choices || []) decisions.push({ id: `o-${hash(p.id, c.question)}`, source: 'oracle', question: c.question, options: c.options });
  for (const d of decisions) d.firstSeen = state.firstSeen[d.id] ??= new Date().toISOString();

  const missions = acceptedMissions(p.id);
  for (const m of story.missions || []) {
    const id = `m-${hash(p.id, m.title)}`;
    if (!state.missions[id]?.state) missions.push({ id, ...m, state: 'new' });
  }

  const inCamp = s => campIds.has(`c-${hash(L.locationOf(p, s) || '')}`);
  const fresh = f.sessions.filter(s => Date.now() - Date.parse(s.lastTs || 0) < L.DAY);
  // Town Claudes are capped; every camp keeps its own.
  const claudes = [...fresh.filter(s => !inCamp(s)).slice(0, 6), ...fresh.filter(inCamp)].map(s => {
    const root = L.locationOf(p, s);
    const loc = root ? `c-${hash(root)}` : 'town';
    return {
      sid: s.id, title: s.title, state: L.claudeState(s, night), location: campIds.has(loc) ? loc : 'town',
      ago: ago(s.lastTs), working: s.status === 'working', branch: s.branch,
      recent: s.recent.slice(-3).map(r => ({ text: clip(r.text, 300), ago: ago(r.ts) })),
      lastUser: clip(s.lastPrompt || s.lastUser, 160), canWake: !!s.originCwd && s.status !== 'working',
      running: [...runs.values()].some(r => r.session === s.id && r.status === 'running'),
    };
  });

  let status = 'quiet';
  if (working) status = 'working';
  else if (recent?.blocked) status = 'blocked';
  else if (recent && Date.now() - Date.parse(recent.lastTs) < L.DAY) status = 'idle';
  const weekAgo = Date.now() - 7 * L.DAY;

  return {
    id: p.id, name: p.name, color: p.color, projectId: p.projectId || null, ...town,
    status, generating: generating.has(p.id), storySource: story.source, storyAt: state.stories[p.id]?.at,
    activeTitle: (working || recent)?.title || null,
    lastActivityAgo: ago(recent?.lastTs || f.commits[0]?.at),
    lastClaude: clip(recent?.lastAssistant, 280), blocked: recent?.blocked || null,
    branch: f.branch, dirty: f.dirty,
    commits: f.commits.slice(0, 4).map(c => ({ ...c, ago: ago(c.at) })),
    story: story.story, scout: story.scout, historian: story.historian,
    missions: missions.slice(0, 5),
    decisions: decisions.filter(d => !state.decisions[d.id]),
    camps: camps.map(c => ({ ...c, ago: ago(c.lastTs) })),
    claudes,
    bosses: Object.values(state.bosses).filter(b => b.project === p.id && b.status === 'active').map(b => ({
      id: b.id, kind: b.kind, name: b.name, lore: b.lore, detail: b.detail, session: b.session, sessionTitle: b.sessionTitle,
      location: campIds.has(b.location) ? b.location : 'town', steps: b.steps,
      hp: b.steps.filter(s => s.state !== 'done').length, maxHp: b.steps.length || 1,
    })),
    stopped: !!stops[p.id],
    flowers: Math.min(14, f.commits.filter(c => Date.parse(c.at) > weekAgo).length),
    statues: Math.min(4, (state.trophies[p.id] || 0) + Object.values(state.missions).filter(m => m.project === p.id && m.state === 'done').length),
    journal: f.doc ? { name: f.doc.name, lines: f.doc.excerpt.split('\n').map(l => l.replace(/[#*`|>]/g, '').trim()).filter(l => l.length > 3).slice(0, 8) } : null,
  };
}

function rebuild() {
  const inbox = store.read('inbox.json', []);
  for (const m of inbox) {
    if (m.deliveredAt && !notifiedDelivered.has(m.id)) {
      notifiedDelivered.add(m.id);
      pushEvent(m.project, 'delivered', `Claude received: ${m.text}`, `dlv-${m.id}`);
    }
  }
  world = {
    towns: areas.map(townFor),
    events: events.slice(0, 80),
    outbox: inbox.slice(-30).reverse(),
    model: cfg.ollama.model,
    night,
    stats: { ...state.stats, streak: streak() },
    badges: state.badges,
    runs: [...runs.values()].slice(-10).reverse(),
    guild,
    save: { introDone: !!Areas.save().introDoneAt, settings: Areas.settings(), maxAreas: Areas.MAX },
  };
  const json = JSON.stringify(world);
  if (json !== worldJson) { worldJson = json; broadcast('world', world); link?.world(world); }
}

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- http ----------
const body = req => new Promise((ok, fail) => {
  let s = '';
  req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { fail(e); } });
});
const send302 = (res, to) => { res.writeHead(302, { location: to }); res.end(); };
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const findDecision = (pid, id) => world.towns.find(t => t.id === pid)?.decisions.find(d => d.id === id);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const routes = {
  'GET /api/world': (req, res) => send(res, 200, world),
  'GET /api/link': (req, res) => send(res, 200, { on: !!link, url: link?.url || null }),
  'GET /api/stream': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: world\ndata: ${worldJson}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  },
  'POST /api/decide': async (req, res) => {
    const { project, decisionId, question, answer } = await body(req);
    if (!projectById(project) || !answer) return send(res, 400, { error: 'project and answer required' });
    const m = decide(project, findDecision(project, decisionId) || { id: decisionId, question }, answer);
    rebuild();
    send(res, 200, m);
  },
  // The player closed the menu: every answer still waiting for a resting session goes out now, one wake per
  // session with all its answers (owner's choice: spends Claude tokens, no extra confirm). Working sessions get
  // theirs live from the hook; nothing wakes during the Long Night.
  'POST /api/flush': async (req, res) => {
    if (night) return send(res, 200, { woke: [], night: true });
    const inbox = store.read('inbox.json', []);
    const bySession = new Map();
    const fresh = m => Date.now() - Date.parse(m.createdAt) < L.DAY;
    for (const m of inbox) if (m.kind === 'answer' && m.session && !m.deliveredAt && fresh(m)) (bySession.get(m.session) || bySession.set(m.session, []).get(m.session)).push(m);
    const woke = [], live = [];
    for (const [sid, msgs] of bySession) {
      const p = projectById(msgs[0].project), s = p && sessionById(p.id, sid);
      if (!s || !s.originCwd) continue;
      if (s.status === 'working') { live.push(s.title); continue; }
      if ([...runs.values()].some(r => r.session === sid && r.status === 'running')) continue;
      const now = new Date().toISOString();
      for (const m of msgs) { m.deliveredAt = now; m.deliveredTo = sid; m.via = 'wake'; }
      store.write('inbox.json', inbox);
      startRun(p, s, ['[Claude Quest] The user answered from the game. Treat these as the user\'s replies and continue:', ...msgs.map(m => `- ${m.text}`)].join('\n'));
      tally('messages');
      woke.push({ title: s.title, answers: msgs.length });
    }
    rebuild();
    send(res, 200, { woke, live });
  },
  'POST /api/letter': async (req, res) => {
    const { project, text } = await body(req);
    if (!projectById(project) || !text?.trim()) return send(res, 400, { error: 'project and text required' });
    const m = addToInbox(project, 'letter', `Letter from the user: ${text.trim()}`);
    tally('messages');
    pushEvent(project, 'sent', `Letter sent: ${text.trim()}`, `sent-${m.id}`);
    rebuild();
    send(res, 200, m);
  },
  'POST /api/chat': async (req, res) => {
    const { project, session, text, mode } = await body(req);
    const p = projectById(project), s = sessionById(project, session);
    if (!p || !s || !text?.trim()) return send(res, 400, { error: 'project, session and text required' });
    const r = sendToSession(p, s, mode === 'command' ? 'command' : 'chat', text.trim());
    rebuild();
    send(res, 200, r);
  },
  'POST /api/wake': async (req, res) => {
    const { project, session, text } = await body(req);
    const p = projectById(project), s = sessionById(project, session);
    if (!p || !s || !text?.trim()) return send(res, 400, { error: 'project, session and text required' });
    if (night) return send(res, 409, { night: true });
    if (s.status === 'working') return send(res, 409, { error: 'That Claude is already working. Talk to it live instead.' });
    if ([...runs.values()].some(r => r.session === s.id && r.status === 'running')) return send(res, 409, { error: 'Already awake.' });
    tally('messages');
    const run = startRun(p, s, text.trim());
    rebuild();
    send(res, 200, run);
  },
  'POST /api/stop': async (req, res) => {
    const { project, on } = await body(req);
    if (!projectById(project)) return send(res, 400, { error: 'project required' });
    const c = controlFile();
    if (on) c.stops[project] = { at: new Date().toISOString() }; else delete c.stops[project];
    store.write('control.json', c);
    if (on) for (const r of runs.values()) if (r.project === project && r.status === 'running') { try { process.kill(r.pid, 'SIGINT'); } catch {} }
    pushEvent(project, 'sent', on ? 'You raised the STOP banner. Claude halts at its next step.' : 'You lowered the STOP banner. Claude may continue.', hash('stop', project, Date.now()));
    rebuild();
    send(res, 200, { stopped: !!on });
  },
  'POST /api/step': async (req, res) => {
    const { bossId, stepId, action } = await body(req);
    const b = state.bosses[bossId];
    const st = b?.steps.find(x => x.id === stepId);
    if (!st) return send(res, 404, { error: 'unknown step' });
    if (action === 'done') {
      st.state = 'done';
      pushEvent(b.project, 'step', `You struck ${b.name}: ${st.title}`, `step-${bossId}-${stepId}`, { bossId });
      tally('missionsDone');
    } else if (action === 'send') {
      const s = sessionById(b.project, b.session);
      if (!s) return send(res, 404, { error: 'That session is gone.' });
      const r = sendToSession(projectById(b.project), s, 'step', `${st.title}. (Blocker: ${b.detail})`);
      if (r.queued) st.state = 'sent';
      saveState(); rebuild();
      return send(res, 200, r);
    }
    saveState(); rebuild();
    send(res, 200, { ok: true });
  },
  'POST /api/mission': async (req, res) => {
    const { project, missionId, action } = await body(req);
    const town = world.towns.find(t => t.id === project);
    const mission = town?.missions.find(m => m.id === missionId) || (state.missions[missionId] && { id: missionId, ...state.missions[missionId] });
    if (!mission) return send(res, 404, { error: 'unknown mission' });
    const next = { accept: 'accepted', done: 'done', dismiss: 'dismissed', abandon: 'dismissed' }[action];
    if (!next) return send(res, 400, { error: 'bad action' });
    state.missions[missionId] = { project, title: mission.title, detail: mission.detail, state: next, at: new Date().toISOString() };
    if (action === 'accept') addToInbox(project, 'mission', `Mission accepted in the game, make it the current priority: ${mission.title}. ${mission.detail}`);
    if (action === 'abandon') addToInbox(project, 'mission', `Mission abandoned, drop it: ${mission.title}`);
    if (action === 'done') { tally('missionsDone'); pushEvent(project, 'victory', `Mission complete: ${mission.title}. A statue rises in town.`, `mdone-${missionId}`); }
    saveState(); rebuild();
    send(res, 200, { ok: true });
  },
  // ---------- Guild Hall actions (Paperclip). Each one is an explicit player action; the ones that wake the agent
  // spend Claude tokens, so the client confirms before calling them.
  'POST /api/guild/mission': async (req, res) => {
    const { area, title, detail, priority = 'medium' } = await body(req);
    const save = store.read('world.json', {}), a = save.areas?.find(x => x.id === area);
    if (!a || !title?.trim()) return send(res, 400, { error: 'area and title required' });
    if (!guild.up) return send(res, 503, { closed: true });
    if (night) return send(res, 409, { night: true });
    const issue = await pc.createIssue(save.paperclip.companyId, {
      title: title.trim(), description: detail || '', priority, status: 'todo',
      projectId: a.projectId, assigneeAgentId: save.paperclip.agentId,
    });
    tally('messages');
    pushEvent(area, 'sent', `You posted a quest at the Guild Hall: ${title.trim()}`, `gq-${issue.id}`);
    pollGuild();
    send(res, 200, { id: issue.id, key: issue.identifier });
  },
  'POST /api/guild/send': async (req, res) => {
    const { issueId, text } = await body(req);
    if (!issueId || !text?.trim()) return send(res, 400, { error: 'issueId and text required' });
    if (!guild.up) return send(res, 503, { closed: true });
    if (night) return send(res, 409, { night: true });
    const save = store.read('world.json', {});
    await pc.comment(issueId, text.trim());
    await pc.wakeup(save.paperclip.agentId, `Player message on ${issueId}`);
    tally('messages');
    pollGuild();
    send(res, 200, { ok: true });
  },
  'POST /api/guild/stop': async (req, res) => {
    const { issueId, on = true } = await body(req);
    if (!guild.up) return send(res, 503, { closed: true });
    const save = store.read('world.json', {});
    if (issueId) {
      // Stop one task: cancel its run and the issue.
      const i = guild.issues?.find(x => x.id === issueId);
      if (i?.runId) await pc.cancelRun(i.runId).catch(() => {});
      await pc.patchIssue(issueId, { status: 'cancelled' });
      pushEvent(null, 'sent', `You called off the quest${i ? `: ${i.title}` : ''}.`, hash('gstop', issueId));
    } else {
      // Stop everything: pause the agent (cancels its live runs) or let it work again.
      if (on) await pc.pause(save.paperclip.agentId); else await pc.resume(save.paperclip.agentId);
      pushEvent(null, 'sent', on ? 'You sent the guild home. No one sets out until you call them back.' : 'You called the guild back to work.', hash('gpause', on, Date.now()));
    }
    pollGuild();
    send(res, 200, { ok: true });
  },
  // ---------- the save: lands, notes, settings, the intro ----------
  'GET /api/repos': (req, res) => send(res, 200, { repos: Areas.repos().map(r => ({ path: r.path, name: r.name })), max: Areas.MAX, charted: areas.length }),
  'GET /api/areas': (req, res) => send(res, 200, { areas: Areas.save().areas || [], guildUp: guild.up }),
  'POST /api/areas': async (req, res) => {
    const { path: repo, name } = await body(req);
    const a = Areas.claim(repo, name);
    await registerAreas();
    pushEvent(a.id, 'story', `You charted a new land: ${a.name}. Its Waystone waits to be attuned.`, hash('chart', a.id, Date.now()));
    scan();
    send(res, 200, a);
  },
  'POST /api/areas/update': async (req, res) => {
    const { id, ...patch } = await body(req);
    const a = Areas.update(id, patch);
    if (patch.retire) {
      if (a.projectId && guild.up) await pc.patchProject(a.projectId, { status: 'cancelled' }).catch(e => console.warn(`[guild] retire: ${e.message}`));
      pushEvent(null, 'story', `You abandoned ${a.name}. Grass grows over its roads.`, hash('retire', id, Date.now()));
    }
    scan();
    send(res, 200, a);
  },
  'GET /api/notes': (req, res, url) => send(res, 200, { id: url.searchParams.get('id'), text: Areas.readNotes(url.searchParams.get('id') || '') }),
  'POST /api/notes': async (req, res) => {
    const { id, text } = await body(req);
    if (!projectById(id) || typeof text !== 'string') return send(res, 400, { error: 'id and text required' });
    Areas.writeNotes(id, text);
    send(res, 200, { ok: true });
  },
  'POST /api/settings': async (req, res) => {
    const patch = await body(req);
    const d = Areas.DEFAULT_SETTINGS;
    Areas.patchSave(s => {
      s.settings = { ...Areas.settings() };
      if (typeof patch.sound === 'boolean') s.settings.sound = patch.sound;
      if (typeof patch.music === 'boolean') s.settings.music = patch.music;
      for (const k of ['playerName', 'claudeName']) if (typeof patch[k] === 'string' && patch[k].trim()) s.settings[k] = patch[k].trim().slice(0, 16);
      // Names the player gave to lands, characters and places: { id: name }. They win over generated ones.
      if (patch.names && typeof patch.names === 'object') {
        s.settings.names = { ...s.settings.names };
        for (const [k, v] of Object.entries(patch.names).slice(0, 200)) if (typeof v === 'string') { if (v.trim()) s.settings.names[String(k).slice(0, 80)] = v.trim().slice(0, 24); else delete s.settings.names[k]; }
      }
      if (Number.isFinite(patch.autoplaySec)) s.settings.autoplaySec = Math.max(0, Math.min(3600, Math.round(patch.autoplaySec)));
      if (['always', 'focus', 'off'].includes(patch.subtext)) s.settings.subtext = patch.subtext;
      if (typeof patch.minimap === 'boolean') s.settings.minimap = patch.minimap;
      if (['tl', 'tr', 'bl', 'br'].includes(patch.minimapCorner)) s.settings.minimapCorner = patch.minimapCorner;
      if (['s', 'm', 'l'].includes(patch.minimapSize)) s.settings.minimapSize = patch.minimapSize;
      for (const k of Object.keys(s.settings)) if (!(k in d)) delete s.settings[k];
    });
    rebuild();
    send(res, 200, Areas.settings());
  },
  'POST /api/intro': async (req, res) => {
    Areas.patchSave(s => { s.introDoneAt = new Date().toISOString(); });
    rebuild();
    send(res, 200, { ok: true });
  },
  'POST /api/refresh': async (req, res) => {
    const { project } = await body(req);
    for (const p of areas) if (!project || p.id === project) queueStory(p, true);
    send(res, 200, { queued: true });
  },
};

// ---------- the hosted-page link (outgoing MQTT, end-to-end encrypted) ----------
// Runs the same routes for actions that arrive from a linked page.
function dispatch(method, url, payload) {
  const u = new URL(url, 'http://x');
  const route = routes[`${method} ${u.pathname}`];
  if (!route || u.pathname === '/api/stream') return Promise.resolve({ error: `unknown action ${method} ${u.pathname}` });
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  setImmediate(() => { req.emit('data', JSON.stringify(payload || {})); req.emit('end'); });
  return new Promise(ok => {
    const res = { writeHead() {}, end(s) { try { ok(JSON.parse(s)); } catch { ok({ ok: true }); } } };
    Promise.resolve(route(req, res, u)).catch(e => ok({ error: e.message }));
  });
}
// What leaves the Mac (owner's choice "trimmed"): what the game shows, without document contents or run prompts.
const trimForLink = w => ({
  ...w, runs: w.runs.map(({ text, pid, ...r }) => r),
  towns: w.towns.map(t => ({ ...t, journal: t.journal ? { name: t.journal.name, lines: [] } : null })),
});
const linkCfg = cfg.link || {};
const link = (process.env.CQ_LINK ?? (linkCfg.enabled ? '1' : '')) === '1'
  ? require('./lib/link').start({ broker: linkCfg.broker || require('./public/linkcrypto').DEFAULT_BROKER, pagesUrl: process.env.CQ_PAGES_URL || linkCfg.pagesUrl || 'https://thenewurbankid-web.github.io/claude_quest', dispatch, trim: trimForLink })
  : null;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) return await route(req, res, url);
    if (url.pathname === '/settings') return send302(res, '/settings.html');
    if (url.pathname === '/mqtt.min.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return fs.createReadStream(path.join(__dirname, 'node_modules', 'mqtt', 'dist', 'mqtt.min.js')).pipe(res);
    }
    if (url.pathname === '/phaser.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return fs.createReadStream(require.resolve('phaser/dist/phaser.min.js')).pipe(res);
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!e.status) console.error(e);
    if (res.headersSent) return res.end();
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Quest on http://localhost:${PORT} · model ${cfg.ollama.model} · claude ${CLAUDE}`);
  scan();
  setInterval(scan, cfg.scanSeconds * 1000);
  pollGuild();
  setInterval(pollGuild, cfg.scanSeconds * 1000);
});
