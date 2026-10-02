// The player's charted lands. The save file data/world.json is the source of truth; each area becomes the
// project shape lib/collect.js reads. Per-area instructions live in areas/<id>.md.
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store');

const ROOT = path.join(__dirname, '..');
const NOTES = path.join(ROOT, 'areas');
const REPOS = path.join(os.homedir(), 'Repositories');
const DOCS = ['HANDOFF.md', 'WIP.md', 'CHANGELOG.md', 'README.md'];
const COLORS = ['#e0a84f', '#d05048', '#8858c8', '#3878d0', '#489868', '#c8a030', '#38a0a0', '#c05890'];
const MAX = 5; // the map has five town slots for now
const DEFAULT_SETTINGS = { sound: true, music: true, autoplaySec: 60, subtext: 'always', minimap: true, minimapCorner: 'tr', minimapSize: 'm', playerName: '', claudeName: '', names: {} };

const enc = p => p.replace(/[^a-zA-Z0-9]/g, '-');
const save = () => store.read('world.json', { areas: [] });
const settings = () => ({ ...DEFAULT_SETTINGS, ...save().settings });

function asProject(a) {
  return {
    id: a.id, name: a.name, path: a.path, color: a.color, projectId: a.projectId,
    extraPaths: a.extraPaths || [],
    transcripts: a.transcripts || [enc(a.path)],
    exclude: a.exclude || [],
    docs: a.docs || DOCS.filter(d => fs.existsSync(path.join(a.path, d))).slice(0, 2),
  };
}
const projects = () => (save().areas || []).filter(a => !a.retiredAt).map(asProject);

// Git repos under ~/Repositories that aren't charted yet.
function repos() {
  const taken = new Set(projects().map(p => p.path));
  let dirs = [];
  try { dirs = fs.readdirSync(REPOS, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')); } catch {}
  return dirs
    .map(d => path.join(REPOS, d.name))
    .filter(p => fs.existsSync(path.join(p, '.git')) && !taken.has(p))
    .map(p => ({ path: p, name: path.basename(p), mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'land';
const titled = s => s.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function notePath(id) { return path.join(NOTES, `${slug(id)}.md`); }
function readNotes(id) { try { return fs.readFileSync(notePath(id), 'utf8'); } catch { return ''; } }
function writeNotes(id, text) { fs.mkdirSync(NOTES, { recursive: true }); fs.writeFileSync(notePath(id), String(text).slice(0, 20000)); }

// Adds a land to the save. Paperclip registration is done by the caller (it may be down).
function claim(repoPath, name) {
  const resolved = path.resolve(repoPath);
  if (path.dirname(resolved) !== REPOS || !fs.existsSync(path.join(resolved, '.git'))) throw Object.assign(new Error('Only git repos directly under ~/Repositories can be charted.'), { status: 400 });
  const s = save();
  s.areas ||= [];
  const live = s.areas.filter(a => !a.retiredAt);
  if (live.some(a => a.path === resolved)) throw Object.assign(new Error('That land is already charted.'), { status: 409 });
  if (live.length >= MAX) throw Object.assign(new Error(`The map has room for ${MAX} lands for now.`), { status: 409 });
  const old = s.areas.find(a => a.path === resolved);
  let area;
  if (old) { delete old.retiredAt; area = old; }
  else {
    let id = slug(path.basename(resolved));
    while (s.areas.some(a => a.id === id)) id += '-2';
    const used = new Set(live.map(a => a.color));
    area = { id, name: name?.trim() || titled(path.basename(resolved)), path: resolved, color: COLORS.find(c => !used.has(c)) || COLORS[0], claimedAt: new Date().toISOString() };
    s.areas.push(area);
  }
  store.write('world.json', s);
  if (!readNotes(area.id)) writeNotes(area.id, `# ${area.name}\n\nInstructions and lore for this land. The storyteller and the guild read this.\n`);
  return area;
}

function update(id, patch) {
  const s = save();
  const a = s.areas?.find(x => x.id === id);
  if (!a) throw Object.assign(new Error('unknown area'), { status: 404 });
  for (const k of ['name', 'color', 'projectId']) if (patch[k] !== undefined) a[k] = String(patch[k]).slice(0, 80);
  if (patch.retire) a.retiredAt = new Date().toISOString();
  store.write('world.json', s);
  return a;
}

function patchSave(fn) { const s = save(); fn(s); store.write('world.json', s); return s; }

module.exports = { projects, repos, claim, update, readNotes, writeNotes, settings, patchSave, save, MAX, DEFAULT_SETTINGS, REPOS };
