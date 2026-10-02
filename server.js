// Claude Quest server: scans projects, narrates them with a local model, serves the game,
// and keeps the inbox the Claude Code hook delivers from. No Claude API calls anywhere.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config.json');
const store = require('./lib/store');
const { collectAll } = require('./lib/collect');
const { generateStory, fallbackStory, ago, clip } = require('./lib/story');

const PORT = +process.env.PORT || cfg.port;
const PUBLIC = path.join(__dirname, 'public');
const hash = (...xs) => crypto.createHash('sha1').update(xs.join('\u0000')).digest('hex').slice(0, 12);

// Persistent state: town names, story cache, mission and decision states.
const state = store.read('state.json', { towns: {}, stories: {}, missions: {}, decisions: {} });
let events = store.read('events.json', []);
const seenEvents = new Set(events.map(e => e.id));
const notifiedDelivered = new Set(store.read('inbox.json', []).filter(m => m.deliveredAt).map(m => m.id));
const facts = {};
const generating = new Set();
const clients = new Set();
let world = null;
let worldJson = '';

const saveState = () => store.write('state.json', state);

function pushEvent(project, kind, text, id = hash(project, kind, text)) {
  if (seenEvents.has(id)) return;
  seenEvents.add(id);
  const e = { id, at: new Date().toISOString(), project, kind, text: clip(text, 240) };
  events.unshift(e);
  events = events.slice(0, 150);
  store.write('events.json', events);
  broadcast('event', e);
}

function diffEvents(p, prev, cur) {
  if (prev) {
    const old = new Set(prev.commits.map(c => c.hash));
    for (const c of cur.commits.filter(c => !old.has(c.hash)).reverse()) pushEvent(p.id, 'commit', `New commit: ${c.subject}`, `commit-${c.hash}`);
  }
  for (const s of cur.sessions) {
    if (Date.now() - Date.parse(s.lastTs || 0) > 24 * 3600e3) continue;
    if (s.pendingAsk?.length) for (const q of s.pendingAsk) pushEvent(p.id, 'question', `Claude needs you: ${q.question}`, `ask-${hash(s.id, q.question)}`);
    else if (s.openQuestion) pushEvent(p.id, 'question', `Claude asks: ${s.openQuestion}`, `q-${hash(s.id, s.openQuestion)}`);
    if (s.blocked) pushEvent(p.id, 'blocked', `Claude is blocked: ${s.blocked}`, `blk-${hash(p.id, s.blocked, new Date().toDateString())}`);
    else if (s.lastKind === 'assistant' && s.lastAssistant) pushEvent(p.id, 'update', `"${s.title || 'Session'}" — ${s.lastAssistant}`, `upd-${hash(s.id, s.lastAssistant)}`);
  }
}

function factsKey(f) {
  return hash(
    f.commits.slice(0, 6).map(c => c.hash).join(','),
    f.sessions.slice(0, 4).map(s => `${s.title}|${clip(s.lastAssistant, 300)}|${s.openQuestion}|${!!s.blocked}`).join(';'),
    f.doc?.excerpt?.slice(0, 1500) || '',
  );
}

function acceptedMissions(pid) {
  return Object.entries(state.missions).filter(([, m]) => m.project === pid && m.state === 'accepted').map(([id, m]) => ({ id, ...m }));
}

// One model call at a time; skip if facts haven't changed or the last story is fresh.
const queue = [];
let running = false;
function queueStory(p, force = false) {
  const f = facts[p.id];
  const key = factsKey(f);
  const cached = state.stories[p.id];
  const fresh = cached && Date.now() - Date.parse(cached.at) < cfg.storyMinMinutes * 60e3;
  if (!force && cached && (cached.key === key || fresh)) return;
  if (generating.has(p.id) || queue.includes(p)) return;
  queue.push(p);
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const p = queue.shift();
    generating.add(p.id);
    rebuild();
    const f = facts[p.id];
    let story;
    try { story = await generateStory(cfg, p, f, acceptedMissions(p.id)); }
    catch (e) { console.warn(`[story] ${p.id}: ${e.message}; using template`); story = fallbackStory(p, f); }
    const prev = state.stories[p.id];
    state.stories[p.id] = { key: factsKey(f), at: new Date().toISOString(), story };
    // Keep the first good town name so the map doesn't get renamed every refresh.
    if (!state.towns[p.id] || (state.towns[p.id].source === 'template' && story.source === 'ollama')) {
      state.towns[p.id] = { townName: story.townName, motto: story.motto, source: story.source };
    }
    saveState();
    generating.delete(p.id);
    if (prev && story.source === 'ollama') pushEvent(p.id, 'story', `A new chapter in ${state.towns[p.id].townName}: ${story.story[0] || ''}`);
    rebuild();
  }
  running = false;
}

function townFor(p) {
  const f = facts[p.id] || { commits: [], sessions: [], dirty: 0 };
  const story = state.stories[p.id]?.story || fallbackStory(p, f);
  const town = state.towns[p.id] || { townName: story.townName, motto: story.motto };
  const recent = f.sessions[0];
  const working = f.sessions.find(s => s.status === 'working');

  const decisions = [];
  for (const s of f.sessions) {
    if (s.pendingAsk?.length) for (const q of s.pendingAsk) decisions.push({
      id: `ask-${hash(s.id, q.question)}`, source: 'claude', session: s.id, sessionTitle: s.title,
      question: q.question, options: (q.options || []).map(o => o.label).filter(Boolean).slice(0, 4),
    });
    else if (s.openQuestion) decisions.push({
      id: `q-${hash(s.id, s.openQuestion)}`, source: 'claude', session: s.id, sessionTitle: s.title,
      question: s.openQuestion, options: ['Yes, go ahead', 'No, hold off'],
    });
  }
  for (const c of story.choices || []) decisions.push({ id: `o-${hash(p.id, c.question)}`, source: 'oracle', question: c.question, options: c.options });

  const missions = acceptedMissions(p.id);
  for (const m of story.missions || []) {
    const id = `m-${hash(p.id, m.title)}`;
    const st = state.missions[id]?.state;
    if (!st) missions.push({ id, ...m, state: 'new' });
  }

  let status = 'quiet';
  if (working) status = 'working';
  else if (recent?.blocked) status = 'blocked';
  else if (recent && Date.now() - Date.parse(recent.lastTs) < 24 * 3600e3) status = 'idle';

  return {
    id: p.id, name: p.name, color: p.color, ...town,
    status, generating: generating.has(p.id), storySource: story.source, storyAt: state.stories[p.id]?.at,
    activeTitle: (working || recent)?.title || null,
    lastActivity: recent?.lastTs || f.commits[0]?.at || null,
    lastActivityAgo: ago(recent?.lastTs || f.commits[0]?.at),
    lastClaude: clip(recent?.lastAssistant, 280),
    blocked: recent?.blocked || null,
    branch: f.branch, dirty: f.dirty,
    commits: f.commits.slice(0, 4).map(c => ({ ...c, ago: ago(c.at) })),
    sessions: f.sessions.slice(0, 4).map(s => ({ id: s.id, title: s.title, status: s.status, ago: ago(s.lastTs) })),
    story: story.story, scout: story.scout, historian: story.historian,
    missions: missions.slice(0, 5),
    decisions: decisions.filter(d => !state.decisions[d.id]),
    journal: f.doc ? { name: f.doc.name, lines: f.doc.excerpt.split('\n').map(l => l.replace(/[#*`|>]/g, '').trim()).filter(l => l.length > 3).slice(0, 8) } : null,
  };
}

function rebuild() {
  const inbox = store.read('inbox.json', []);
  for (const m of inbox) {
    if (m.deliveredAt && !notifiedDelivered.has(m.id)) {
      notifiedDelivered.add(m.id);
      pushEvent(m.project, 'delivered', `Claude received your letter: ${m.text}`, `dlv-${m.id}`);
    }
  }
  world = {
    towns: cfg.projects.map(townFor),
    events: events.slice(0, 60),
    outbox: inbox.slice(-30).reverse(),
    model: cfg.ollama.model,
  };
  const json = JSON.stringify(world);
  if (json !== worldJson) { worldJson = json; broadcast('world', world); }
}

function scan() {
  const all = collectAll(cfg);
  for (const p of cfg.projects) {
    const f = all[p.id];
    if (!f) continue;
    diffEvents(p, facts[p.id], f);
    facts[p.id] = f;
    queueStory(p);
  }
  rebuild();
}

function addToInbox(project, kind, text, extra = {}) {
  const inbox = store.read('inbox.json', []);
  const m = { id: hash(project, text, Date.now()), project, kind, text: clip(text, 2000), createdAt: new Date().toISOString(), deliveredAt: null, ...extra };
  inbox.push(m);
  store.write('inbox.json', inbox.slice(-300));
  return m;
}

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

const body = req => new Promise((ok, fail) => {
  let s = '';
  req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { fail(e); } });
});

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const projectById = id => cfg.projects.find(p => p.id === id);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const routes = {
  'GET /api/world': (req, res) => send(res, 200, world),
  'GET /api/stream': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: world\ndata: ${worldJson}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  },
  'POST /api/decide': async (req, res) => {
    const { project, decisionId, question, answer } = await body(req);
    if (!projectById(project) || !answer) return send(res, 400, { error: 'project and answer required' });
    state.decisions[decisionId] = { answer, at: new Date().toISOString() };
    saveState();
    const m = addToInbox(project, 'answer', `Answer to "${question}": ${answer}`, { decisionId });
    pushEvent(project, 'sent', `You answered: ${answer}`, `sent-${m.id}`);
    rebuild();
    send(res, 200, m);
  },
  'POST /api/letter': async (req, res) => {
    const { project, text } = await body(req);
    if (!projectById(project) || !text?.trim()) return send(res, 400, { error: 'project and text required' });
    const m = addToInbox(project, 'letter', text.trim());
    pushEvent(project, 'sent', `Letter sent: ${text.trim()}`, `sent-${m.id}`);
    rebuild();
    send(res, 200, m);
  },
  'POST /api/mission': async (req, res) => {
    const { project, missionId, action } = await body(req);
    const town = world.towns.find(t => t.id === project);
    const mission = town?.missions.find(m => m.id === missionId) || (state.missions[missionId] && { id: missionId, ...state.missions[missionId] });
    if (!mission) return send(res, 404, { error: 'unknown mission' });
    const next = { accept: 'accepted', done: 'done', dismiss: 'dismissed', abandon: 'dismissed' }[action];
    if (!next) return send(res, 400, { error: 'bad action' });
    state.missions[missionId] = { project, title: mission.title, detail: mission.detail, state: next, at: new Date().toISOString() };
    saveState();
    if (action === 'accept') addToInbox(project, 'mission', `Mission accepted in the game, make it the current priority: ${mission.title}. ${mission.detail}`);
    if (action === 'abandon') addToInbox(project, 'mission', `Mission abandoned, drop it: ${mission.title}`);
    rebuild();
    send(res, 200, { ok: true });
  },
  'POST /api/refresh': async (req, res) => {
    const { project } = await body(req);
    for (const p of cfg.projects) if (!project || p.id === project) queueStory(p, true);
    send(res, 200, { queued: true });
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) return await route(req, res);
    if (url.pathname === '/phaser.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return fs.createReadStream(require.resolve('phaser/dist/phaser.min.js')).pipe(res);
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Quest on http://localhost:${PORT} · model ${cfg.ollama.model}`);
  scan();
  setInterval(scan, cfg.scanSeconds * 1000);
});
