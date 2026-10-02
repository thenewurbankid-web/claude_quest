// Claude Quest overworld. Each project is a town; NPCs read out live development state.
const T = 16, MW = 64, MH = 48;
const HUB = { x: 32, y: 20 };
const SLOTS = [[12, 12], [52, 12], [12, 36], [52, 36], [32, 40]];
const DIRS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };
const KEY_DIR = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right', s: 'down', w: 'up', a: 'left', d: 'right' };
const KIND_TAG = {
  question: ['ASK', '#d97757'], blocked: ['STOP', '#c04040'], update: ['NEWS', '#4878b8'], commit: ['GIT', '#489868'],
  story: ['TALE', '#8858c8'], sent: ['SENT', '#888'], delivered: ['READ', '#38a0a0'],
};
const ROLE_LOOK = {
  scout: { hat: '#e0a020', shirt: '#48a048' },
  historian: { cap: false, hair: '#d0d0d0', shirt: '#806048', pants: '#504038' },
  guide: { hat: '#f0f0f0', shirt: '#e8e8e8', pants: '#406080' },
  messenger: { hat: '#3060c0', shirt: '#4070d0' },
  clerk: { cap: false, hair: '#e07050', shirt: '#f0a0b0', pants: '#f0a0b0' },
  player: { hat: '#e03030', shirt: '#3050c0', pants: '#303850' },
};
const ROLE_NAME = { scout: 'SCOUT', historian: 'HISTORIAN', guide: 'GUIDE', messenger: 'MESSENGER', clerk: 'CLERK' };

let WORLD = null;
const S = { scene: null, grid: null, at: new Map(), npcs: [], player: null, px: 0, py: 0, facing: 'down', moving: false, held: new Map(), area: null, signs: [] };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const seen = store.get('cq-seen', { news: {}, missions: [] });
const saveSeen = () => store.set('cq-seen', seen);

const town = id => WORLD.towns.find(t => t.id === id);
const ago = iso => {
  if (!iso) return 'a while ago';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const api = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// ---------- world layout ----------
function buildLayout(towns) {
  const g = [...Array(MH)].map(() => Array(MW).fill(TILE.GRASS));
  const keep = [...Array(MH)].map(() => Array(MW).fill(false));
  const objs = [];
  const R = rng(7);
  const inb = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
  const clear = (cx, cy, rx, ry) => { for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (inb(x, y)) keep[y][x] = true; };
  const path = (x, y) => { if (inb(x, y)) { g[y][x] = TILE.PATH; keep[y][x] = true; } };
  const hline = (x0, x1, y) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 1; x++) { path(x, y); path(x, y + 1); } };
  const vline = (x, y0, y1) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { path(x, y); path(x + 1, y); } };

  // Hub: the Claude Center.
  clear(HUB.x, HUB.y + 1, 9, 6);
  objs.push({ kind: 'building', x: 29, y: 16, w: 6, h: 4, tex: 'center', door: [32, 19], label: 'center' });
  vline(32, 20, 25);
  objs.push({ kind: 'npc', role: 'clerk', x: 30, y: 21 });
  objs.push({ kind: 'mailbox', x: 35, y: 20 });
  objs.push({ kind: 'board', x: 28, y: 20 });

  towns.forEach((t, i) => {
    const [cx, cy] = SLOTS[i % SLOTS.length];
    t._cx = cx; t._cy = cy;
    clear(cx, cy, 8, 6);
    // Road: along the hub's main street, down/up a side road beside the town, then into the plaza.
    const vx = cx >= HUB.x ? (cx === HUB.x ? cx + 5 : cx - 6) : cx + 5;
    hline(HUB.x, vx, 25);
    vline(vx, 25, cy + 1);
    hline(cx, vx, cy + 1);
    vline(cx, cy - 1, cy + 1);
    objs.push({ kind: 'building', x: cx - 2, y: cy - 4, w: 5, h: 3, tex: `house-${t.id}`, door: [cx, cy - 2], town: t.id });
    objs.push({ kind: 'sign', x: cx - 2, y: cy - 1, town: t.id });
    objs.push({ kind: 'npc', role: 'scout', x: cx + 4, y: cy, town: t.id });
    objs.push({ kind: 'npc', role: 'historian', x: cx - 4, y: cy + 1, town: t.id });
    objs.push({ kind: 'npc', role: 'guide', x: cx + 4, y: cy + 3, town: t.id });
    objs.push({ kind: 'npc', role: 'messenger', x: cx - 3, y: cy + 3, town: t.id });
  });

  // A pond, for the vibes.
  for (let y = 29; y <= 31; y++) for (let x = 40; x <= 44; x++) { g[y][x] = TILE.WATER; keep[y][x] = true; }

  const occupied = new Set(objs.flatMap(o => { const c = []; for (let dy = 0; dy < (o.h || 1); dy++) for (let dx = 0; dx < (o.w || 1); dx++) c.push(`${o.x + dx},${o.y + dy}`); return c; }));
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const border = x < 2 || y < 2 || x >= MW - 2 || y >= MH - 2;
    const r = R();
    if (border) { g[y][x] = TILE.TREE; continue; }
    if (g[y][x] !== TILE.GRASS) continue;
    if (!keep[y][x]) g[y][x] = r < 0.58 ? TILE.TREE : r < 0.72 ? TILE.TALL : r < 0.85 ? TILE.GRASS2 : TILE.GRASS;
    else if (!occupied.has(`${x},${y}`)) g[y][x] = r < 0.04 ? TILE.FLOWER_R : r < 0.08 ? TILE.FLOWER_Y : r < 0.2 ? TILE.GRASS2 : TILE.GRASS;
  }
  return { g, objs };
}

const areaAt = (x, y) => {
  if (Math.abs(x - HUB.x) <= 9 && Math.abs(y - HUB.y - 1) <= 6) return { id: 'hub', name: 'Claude Center' };
  for (const t of WORLD.towns) if (Math.abs(x - t._cx) <= 8 && Math.abs(y - t._cy) <= 6) return { id: t.id, name: t.townName };
  return null;
};

// ---------- scene ----------
function create() {
  const sc = S.scene = this;
  sc.textures.addCanvas('tiles', Art.tiles());
  const sheet = (key, look) => { const tex = sc.textures.addCanvas(key, Art.character(look)); for (let i = 0; i < 12; i++) tex.add(i, 0, i * 16, 0, 16, 16); };
  for (const [role, look] of Object.entries(ROLE_LOOK)) sheet(`char-${role}`, look);
  sc.textures.addCanvas('center', Art.house(6, 4, '#d97757', { emblem: 'CC' }));
  for (const t of WORLD.towns) sc.textures.addCanvas(`house-${t.id}`, Art.house(5, 3, t.color, { sign: t.name.toUpperCase() }));
  sc.textures.addCanvas('sign', Art.sign());
  sc.textures.addCanvas('mailbox', Art.mailbox());
  sc.textures.addCanvas('board', Art.board());
  sc.textures.addCanvas('bub-!', Art.bubble('!', '#e04040'));
  sc.textures.addCanvas('bub-?', Art.bubble('?', '#3060c0'));
  sc.textures.addCanvas('bub-…', Art.bubble('…', '#606060'));

  const { g, objs } = buildLayout(WORLD.towns);
  S.grid = g.map(row => row.map(tile => SOLID_TILES.has(tile)));
  const map = sc.make.tilemap({ data: g, tileWidth: T, tileHeight: T });
  map.createLayer(0, map.addTilesetImage('tiles', 'tiles', T, T, 0, 0), 0, 0);

  for (const o of objs) {
    const w = o.w || 1, h = o.h || 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) { S.grid[o.y + dy][o.x + dx] = true; S.at.set(`${o.x + dx},${o.y + dy}`, o); }
    if (o.kind === 'building') {
      sc.add.image(o.x * T, o.y * T, o.tex).setOrigin(0).setDepth((o.y + h) * T);
      S.at.set(`${o.door[0]},${o.door[1]}`, { ...o, kind: 'door' });
    } else if (o.kind === 'npc') {
      o.facing = 'down';
      o.sprite = sc.add.sprite(o.x * T, o.y * T - 2, `char-${o.role}`, 0).setOrigin(0).setDepth(o.y * T + 8);
      o.bubble = sc.add.image(o.x * T + 3, o.y * T - 14, 'bub-!').setOrigin(0).setDepth(9999).setVisible(false);
      sc.tweens.add({ targets: o.bubble, y: o.bubble.y - 2, duration: 400, yoyo: true, repeat: -1, ease: 'Stepped' });
      S.npcs.push(o);
    } else {
      o.sprite = sc.add.image(o.x * T, o.y * T, o.kind).setOrigin(0).setDepth(o.y * T + 8);
      if (o.kind === 'sign') {
        o.bubble = sc.add.image(o.x * T + 3, o.y * T - 12, 'bub-…').setOrigin(0).setDepth(9999).setVisible(false);
        S.signs.push(o);
      }
    }
  }

  const saved = store.get('cq-pos', null);
  [S.px, S.py] = saved && !S.grid[saved[1]]?.[saved[0]] ? saved : [HUB.x, HUB.y + 1];
  S.player = sc.add.sprite(S.px * T, S.py * T - 2, 'char-player', 0).setOrigin(0).setDepth(S.py * T + 9);
  sc.cameras.main.setBounds(0, 0, MW * T, MH * T).startFollow(S.player, true).setRoundPixels(true);

  // NPCs glance around now and then.
  sc.time.addEvent({ delay: 1800, loop: true, callback: () => {
    if (UI.open) return;
    const n = S.npcs[Math.floor(Math.random() * S.npcs.length)];
    face(n, Object.keys(DIRS)[Math.floor(Math.random() * 4)]);
  } });

  refreshMarkers();
  checkArea();
  document.getElementById('boot').remove();
}

function face(o, dir) { o.facing = dir; o.sprite.setFrame(DIR_INDEX[dir] * 3); }

function update(time) {
  if (UI.open || S.moving) return;
  let dir = null, newest = -1;
  for (const [d, t] of S.held) if (t > newest) { newest = t; dir = d; }
  if (!dir && S.queued) { dir = S.queued; S.turnedAt = 0; }
  S.queued = null;
  if (!dir) return;
  if (S.facing !== dir) { S.facing = dir; S.player.setFrame(DIR_INDEX[dir] * 3); S.turnedAt = time; }
  if (time - (S.turnedAt || 0) < 90) return; // a tap just turns, like the real thing
  const [dx, dy] = DIRS[dir];
  const nx = S.px + dx, ny = S.py + dy;
  if (S.grid[ny]?.[nx] !== false) {
    if (time - (S.lastBump || 0) > 300) { Sound.bump(); S.lastBump = time; }
    return;
  }
  S.moving = true;
  S.step = (S.step || 0) % 2 + 1;
  S.player.setFrame(DIR_INDEX[dir] * 3 + S.step);
  S.scene.tweens.add({
    targets: S.player, x: nx * T, y: ny * T - 2, duration: 140,
    onComplete: () => {
      S.px = nx; S.py = ny;
      S.player.setDepth(ny * T + 9);
      S.player.setFrame(DIR_INDEX[dir] * 3);
      S.moving = false;
      store.set('cq-pos', [S.px, S.py]);
      checkArea();
    },
  });
}

function checkArea() {
  const a = areaAt(S.px, S.py);
  if (a && a.id !== S.area) UI.banner(a.name);
  S.area = a?.id ?? null;
}

function teleport(x, y) {
  S.px = x; S.py = y;
  S.player.setPosition(x * T, y * T - 2).setDepth(y * T + 9);
  store.set('cq-pos', [x, y]);
  checkArea();
}

function refreshMarkers() {
  for (const n of S.npcs) {
    const t = n.town && town(n.town);
    let mark = null;
    if (n.role === 'messenger' && t.decisions.length) mark = '?';
    if (n.role === 'guide' && t.missions.some(m => m.state === 'new' && !seen.missions.includes(m.id))) mark = '!';
    if (n.role === 'scout' && WORLD.events.some(e => e.project === t.id && e.at > (seen.news[t.id] || ''))) mark = '!';
    if (n.role === 'clerk' && WORLD.towns.some(x => x.decisions.length)) mark = '?';
    n.bubble.setVisible(!!mark);
    if (mark) n.bubble.setTexture(`bub-${mark}`);
  }
  for (const s of S.signs) s.bubble.setVisible(!!town(s.town)?.generating);
}

// ---------- conversations ----------
function interact() {
  const [dx, dy] = DIRS[S.facing];
  const o = S.at.get(`${S.px + dx},${S.py + dy}`);
  if (!o) return;
  if (o.kind === 'npc') face(o, { down: 'up', up: 'down', left: 'right', right: 'left' }[S.facing]);
  UI.run(async () => {
    const t = o.town && town(o.town);
    if (o.kind === 'npc') await ({ scout: talkScout, historian: talkHistorian, guide: talkGuide, messenger: talkMessenger, clerk: talkClerk })[o.role](t);
    else if (o.kind === 'sign') await UI.say([`${t.townName.toUpperCase()}`, `"${t.motto}"`, `(The ${t.name} project.)`]);
    else if (o.kind === 'door') await (o.label === 'center' ? talkClerk() : readJournal(t));
    else if (o.kind === 'mailbox') await mailPanel();
    else if (o.kind === 'board') await questLog();
  });
}

async function talkScout(t) {
  seen.news[t.id] = new Date().toISOString(); saveSeen(); refreshMarkers();
  const intro = {
    working: `SCOUT: Claude is hard at work in ${t.townName} right now!`,
    blocked: `SCOUT: Claude is resting here. It hit a usage limit.`,
    idle: `SCOUT: Claude was last seen here ${t.lastActivityAgo}.`,
    quiet: `SCOUT: It's been quiet. Last activity was ${t.lastActivityAgo}.`,
  }[t.status];
  const lines = [intro];
  if (t.activeTitle) lines.push(`The current quest: "${t.activeTitle}".`);
  if (t.blocked) lines.push(t.blocked);
  else if (t.lastClaude) lines.push(`Claude's last words: "${t.lastClaude}"`);
  lines.push(...t.scout.map(l => `SCOUT: ${l}`));
  await UI.say(lines);
  if (WORLD.events.some(e => e.project === t.id)) {
    if (await UI.choose('SCOUT: Want to read the town news?', ['Read news', 'No thanks']) === 0) await mailPanel(t.id);
  }
}

async function talkHistorian(t) {
  const lines = [];
  if (t.commits.length) {
    lines.push(`HISTORIAN: Let me read you the last entries in the ${t.name} chronicle.`);
    for (const c of t.commits.slice(0, 3)) lines.push(`${c.ago}: ${c.subject}`);
  } else lines.push(`HISTORIAN: This town keeps no git chronicle. Its history lives in the journal.`);
  if (t.branch) lines.push(`We're on the "${t.branch}" road${t.dirty ? `, with ${t.dirty} loose pages not yet bound (uncommitted).` : ', all pages bound.'}`);
  lines.push(...t.historian.map(l => `HISTORIAN: ${l}`));
  await UI.say(lines);
}

async function talkGuide(t) {
  for (const m of t.missions) if (!seen.missions.includes(m.id)) seen.missions.push(m.id);
  saveSeen(); refreshMarkers();
  if (!t.missions.length) return UI.say(`GUIDE: No missions in ${t.townName} right now. Check back after the next chapter.`);
  for (;;) {
    const cur = town(t.id);
    const opts = cur.missions.map(m => `${m.state === 'accepted' ? '★ ' : ''}${short(m.title, 46)}`);
    const i = await UI.choose('GUIDE: Here are the missions I know about.', [...opts, 'Bye']);
    if (i < 0 || i === opts.length) return;
    await missionFlow(cur, cur.missions[i]);
  }
}

async function missionFlow(t, m) {
  await UI.say([`MISSION: ${m.title}`, m.detail]);
  if (m.state === 'accepted') {
    const i = await UI.choose('This mission is on your list.', ['Mark done', 'Abandon it', 'Back']);
    if (i === 0) { await api('/api/mission', { project: t.id, missionId: m.id, action: 'done' }); Sound.mail(); await UI.say('Mission complete! ★'); }
    if (i === 1) { await api('/api/mission', { project: t.id, missionId: m.id, action: 'abandon' }); await UI.say(`Mission dropped. Claude will be told next time you talk in ${t.name}.`); }
  } else {
    const i = await UI.choose('Take this mission?', ['Accept: tell Claude to prioritize it', 'Not now', 'Dismiss for good']);
    if (i === 0) { await api('/api/mission', { project: t.id, missionId: m.id, action: 'accept' }); Sound.mail(); await UI.say([`Mission accepted!`, `Claude gets the order with your next prompt in ${t.name}.`]); }
    if (i === 2) await api('/api/mission', { project: t.id, missionId: m.id, action: 'dismiss' });
  }
}

async function decideFlow(t, d) {
  const who = d.source === 'claude' ? `Claude asks${d.sessionTitle ? ` (in "${short(d.sessionTitle, 30)}")` : ''}:` : 'The Oracle wonders:';
  await UI.say(`MESSENGER: ${who}`);
  const opts = [...d.options, 'Write my own reply…', 'Ask me later'];
  const i = await UI.choose(d.question, opts);
  if (i < 0 || i === opts.length - 1) return false;
  const answer = i === opts.length - 2 ? await UI.ask(`Your reply to: ${d.question}`) : d.options[i];
  if (!answer) return false;
  await api('/api/decide', { project: t.id, decisionId: d.id, question: d.question, answer });
  Sound.mail();
  await UI.say(['Your answer was sealed in a letter!', `Claude reads it with your next prompt in ${t.name}.`]);
  return true;
}

async function talkMessenger(t) {
  const ds = t.decisions;
  if (!ds.length) await UI.say(`MESSENGER: No open questions in ${t.townName}.`);
  else {
    await UI.say(`MESSENGER: ${ds.length} question${ds.length > 1 ? 's need' : ' needs'} your call.`);
    for (const d of ds) if ((await decideFlow(t, d)) === false && (await UI.choose(null, ['Next question', 'Stop'])) !== 0) break;
  }
  if (await UI.choose('MESSENGER: Anything you want to tell Claude?', ['Write a letter', 'Bye']) === 0) {
    const text = await UI.ask(`Letter to Claude about ${t.name}:`);
    if (text) { await api('/api/letter', { project: t.id, text }); Sound.mail(); await UI.say(`Letter sent! It goes out with your next prompt in ${t.name}.`); }
  }
}

async function readJournal(t) {
  const lines = [`You open the ${t.townName} journal.`];
  if (t.story.length) lines.push(...t.story);
  if (t.journal) lines.push(`A page from ${t.journal.name} reads:`, ...t.journal.lines.slice(0, 5));
  if (t.storySource === 'template') lines.push('(The local storyteller hasn\'t written this chapter yet.)');
  await UI.say(lines);
  if (await UI.choose(`Ask the local storyteller (${WORLD.model}) for a fresh chapter?`, ['Yes, rewrite it', 'No']) === 0) {
    await api('/api/refresh', { project: t.id });
    await UI.say('The storyteller starts writing… the town sign shows "…" until it\'s done.');
  }
}

async function talkClerk() {
  const pending = WORLD.towns.reduce((n, t) => n + t.decisions.length, 0);
  const waiting = WORLD.outbox.filter(m => !m.deliveredAt).length;
  const working = WORLD.towns.filter(t => t.status === 'working').map(t => t.name);
  await UI.say([
    'CLERK: Welcome to the Claude Center!',
    working.length ? `Claude is busy in ${working.join(', ')}.` : 'No Claude sessions are running right now.',
    `${pending} question${pending === 1 ? '' : 's'} need you. ${waiting} letter${waiting === 1 ? '' : 's'} wait for delivery.`,
  ]);
  await centerMenu();
}

async function centerMenu() {
  for (;;) {
    const i = await UI.choose('CLERK: How can I help?', ['Read mail', 'Quest log', 'Open questions', 'Outbox', 'Rewrite every chapter', 'Bye']);
    if (i === 0) await mailPanel();
    else if (i === 1) await questLog();
    else if (i === 2) await decisionsPanel();
    else if (i === 3) await outboxPanel();
    else if (i === 4) { await api('/api/refresh', {}); await UI.say('The storytellers are writing. Signs show "…" while they work.'); }
    else return;
  }
}

async function mailPanel(filter) {
  for (;;) {
    const evs = WORLD.events.filter(e => !filter || e.project === filter);
    const items = evs.map(e => {
      const [tag, tagColor] = KIND_TAG[e.kind] || ['INFO', '#888'];
      return { label: short(e.text, 80), sub: `${town(e.project)?.townName || e.project} · ${ago(e.at)}`, tag, tagColor };
    });
    const i = await UI.panel(filter ? `${town(filter).townName} news` : 'Mail', items, { right: `${evs.length}` });
    if (i < 0) return;
    await UI.say(evs[i].text);
  }
}

async function questLog() {
  for (;;) {
    const all = WORLD.towns.flatMap(t => t.missions.map(m => ({ t, m })));
    const items = all.map(({ t, m }) => ({ label: m.title, sub: `${t.townName} · ${short(m.detail, 90)}`, tag: m.state === 'accepted' ? 'ON' : 'NEW', tagColor: m.state === 'accepted' ? '#d97757' : '#489868' }));
    const i = await UI.panel('Quest log', items, { right: `${all.filter(x => x.m.state === 'accepted').length} active` });
    if (i < 0) return;
    await missionFlow(all[i].t, all[i].m);
  }
}

async function decisionsPanel() {
  for (;;) {
    const all = WORLD.towns.flatMap(t => t.decisions.map(d => ({ t, d })));
    const items = all.map(({ t, d }) => ({ label: d.question, sub: t.townName, tag: d.source === 'claude' ? 'CLAUDE' : 'ORACLE', tagColor: d.source === 'claude' ? '#d97757' : '#8858c8' }));
    const i = await UI.panel('Open questions', items, { right: `${all.length}` });
    if (i < 0) return;
    await decideFlow(all[i].t, all[i].d);
  }
}

async function outboxPanel() {
  const items = WORLD.outbox.map(m => ({
    label: short(m.text, 90), sub: `${town(m.project)?.name} · sent ${ago(m.createdAt)}${m.deliveredAt ? ` · read ${ago(m.deliveredAt)}` : ''}`,
    tag: m.deliveredAt ? 'READ' : 'WAIT', tagColor: m.deliveredAt ? '#38a0a0' : '#c8a030',
  }));
  const i = await UI.panel('Outbox', items, { hint: 'Letters go out with your next prompt in that project · X close' });
  if (i >= 0) await UI.say(WORLD.outbox[i].text);
}

async function townsPanel() {
  const items = WORLD.towns.map(t => ({
    label: `${t.townName}`, sub: `${t.name} · ${t.status} · ${t.lastActivityAgo}`,
    tag: t.status.toUpperCase(), tagColor: { working: '#48a048', blocked: '#c04040', idle: '#4878b8', quiet: '#888' }[t.status],
  }));
  const i = await UI.panel('Fly to…', [{ label: 'Claude Center', sub: 'Mail, quest log, outbox' }, ...items]);
  if (i < 0) return;
  if (i === 0) teleport(HUB.x, HUB.y + 1);
  else { const t = WORLD.towns[i - 1]; teleport(t._cx, t._cy + 1); }
  S.facing = 'down'; S.player.setFrame(0);
}

async function startMenu() {
  for (;;) {
    const q = WORLD.towns.reduce((n, t) => n + t.decisions.length, 0);
    const i = await UI.choose(null, ['Quest log', 'Mail', `Questions${q ? ` (${q})` : ''}`, 'Fly', 'Outbox', `Sound: ${Sound.on ? 'on' : 'off'}`, 'Close'], { menu: true });
    if (i === 0) await questLog();
    else if (i === 1) await mailPanel();
    else if (i === 2) await decisionsPanel();
    else if (i === 3) return townsPanel();
    else if (i === 4) await outboxPanel();
    else if (i === 5) Sound.on = !Sound.on;
    else return;
  }
}

// ---------- input ----------
window.addEventListener('keydown', e => {
  if (UI.handler) { if (UI.key(e)) e.preventDefault(); return; }
  if (UI.open) return;
  const dir = KEY_DIR[e.key];
  if (dir) {
    e.preventDefault();
    if (!S.held.has(dir)) S.held.set(dir, S.scene ? S.scene.time.now : 0);
    if (S.player && !S.moving && S.facing !== dir) { S.facing = dir; S.player.setFrame(DIR_INDEX[dir] * 3); S.turnedAt = S.scene.time.now; }
    else if (S.player) S.queued = dir; // a tap while already facing that way takes one step
    return;
  }
  if (['z', 'Z', ' '].includes(e.key)) { e.preventDefault(); interact(); }
  else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); UI.run(startMenu); }
});
window.addEventListener('keyup', e => { const dir = KEY_DIR[e.key]; if (dir) S.held.delete(dir); });
window.addEventListener('blur', () => S.held.clear());

function fit() {
  const w = document.getElementById('screen').clientWidth;
  document.documentElement.style.setProperty('--px', `${w / 240}px`);
}
window.addEventListener('resize', fit);

// ---------- live data ----------
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('world', e => {
    const next = JSON.parse(e.data);
    if (!next) return;
    if (WORLD) {
      // Keep layout positions; towns are a fixed list.
      for (const t of next.towns) { const old = town(t.id); if (old) { t._cx = old._cx; t._cy = old._cy; } }
      WORLD = next;
      if (S.scene) refreshMarkers();
    } else {
      WORLD = next;
      start();
    }
  });
  es.addEventListener('event', e => {
    const ev = JSON.parse(e.data);
    const [tag, color] = KIND_TAG[ev.kind] || ['INFO', '#888'];
    const name = WORLD && town(ev.project)?.townName || ev.project;
    UI.toast(`<b style="color:${color}">${tag}</b> ${esc(name)}<br>${esc(short(ev.text, 110))}`);
    if (['question', 'blocked', 'delivered', 'update'].includes(ev.kind)) Sound.mail();
  });
}

function start() {
  fit();
  new Phaser.Game({
    type: Phaser.CANVAS, parent: 'game', width: 240, height: 160, pixelArt: true, backgroundColor: '#000000',
    input: { keyboard: false }, fps: { target: 60, forceSetTimeOut: true }, scale: { mode: Phaser.Scale.NONE }, scene: { create, update },
  });
}

connect();
