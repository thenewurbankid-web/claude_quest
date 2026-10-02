// Reads a project's real state from disk: git history, docs, and Claude Code transcripts.
// Pure file reads; nothing here calls a model.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_SESSIONS = 14;
const SESSION_WINDOW_MS = 14 * 24 * 3600e3;
const WORKING_MS = 3 * 60e3;

const sessionCache = new Map();
const LIMIT_RE = /hit your .*limit|limit · resets/i;
const CHECK_RE = /\b(test|tests|vitest|jest|pytest|mocha|playwright|tsc|build|lint|typecheck|cargo (test|build)|go test)\b/;
const FAIL_RE = /(\bFAIL(ED)?\b|\d+ failed|failing|✗|error TS\d|Error: |exit code [1-9]|npm ERR!)/; // file -> { mtimeMs, parsed }

function tailLines(file, bytes = 400_000) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  let s = buf.toString('utf8');
  if (start > 0) s = s.slice(s.indexOf('\n') + 1);
  return s.split('\n').filter(Boolean);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(p => p.type === 'text').map(p => p.text).join('\n');
  return '';
}

function lastQuestion(text) {
  const tail = text.slice(-500);
  if (!tail.includes('?')) return null;
  const parts = tail.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].endsWith('?')) return parts[i].replace(/^[-*>\s]+/, '');
  return null;
}

function parseSession(file) {
  const s = {
    id: path.basename(file, '.jsonl'), title: null, lastPrompt: null, lastUser: null,
    lastAssistant: null, lastTs: null, branch: null, cwd: null, lastKind: null,
    toolCalls: 0, pendingAsk: null, cwdHits: {}, recent: [], checks: [], file,
  };
  const asks = new Map();
  const checkCmds = new Map();
  for (const line of tailLines(file)) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'ai-title') { s.title = j.aiTitle; continue; }
    if (j.type === 'last-prompt') { s.lastPrompt = j.lastPrompt; continue; }
    if (j.isSidechain) continue;
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    if (j.timestamp) s.lastTs = j.timestamp;
    if (j.gitBranch) s.branch = j.gitBranch;
    if (j.cwd) { s.cwd = j.cwd; s.cwdHits[j.cwd] = (s.cwdHits[j.cwd] || 0) + 1; }
    const c = j.message?.content;
    if (j.type === 'user') {
      if (Array.isArray(c) && c.some(p => p.type === 'tool_result')) {
        for (const p of c) {
          if (p.type !== 'tool_result') continue;
          asks.delete(p.tool_use_id);
          const cmd = checkCmds.get(p.tool_use_id);
          if (cmd) {
            const out = typeof p.content === 'string' ? p.content : textOf(p.content);
            const failed = !!p.is_error || FAIL_RE.test(out.slice(-4000));
            s.checks.push({ cmd: cmd.slice(0, 120), failed, ts: j.timestamp, out: out.slice(-400) });
          }
        }
        s.lastKind = 'tool';
      }
      const t = textOf(c);
      if (t && !j.isMeta && !t.startsWith('<')) { s.lastUser = t; s.lastKind = 'user'; }
    } else {
      if (Array.isArray(c)) for (const p of c) {
        if (p.type !== 'tool_use') continue;
        s.toolCalls++;
        s.lastKind = 'tool';
        if (p.name === 'AskUserQuestion') asks.set(p.id, p.input?.questions || []);
        if (p.name === 'Bash' && CHECK_RE.test(p.input?.command || '')) checkCmds.set(p.id, p.input.command);
      }
      const t = textOf(c);
      if (t) {
        s.lastAssistant = t; s.lastKind = 'assistant';
        s.recent.push({ text: t.slice(0, 400), ts: j.timestamp });
        if (s.recent.length > 8) s.recent.shift();
      }
    }
  }
  if (!s.title) s.title = (s.lastPrompt || s.lastUser || '').replace(/\s+/g, ' ').trim().slice(0, 48) || null;
  if (/^You are agent /.test(s.title || '')) s.title = 'Paperclip agent run';
  const age = s.lastTs ? Date.now() - Date.parse(s.lastTs) : Infinity;
  s.status = age < WORKING_MS && s.lastKind !== 'assistant' ? 'working' : 'idle';
  if (s.lastAssistant && LIMIT_RE.test(s.lastAssistant)) s.blocked = s.lastAssistant.slice(0, 160);
  s.checks = s.checks.slice(-10);
  // Looping: the last six messages say at most two different things, or Claude says so itself.
  const sig = t => t.toLowerCase().replace(/[0-9]+/g, '#').replace(/\s+/g, ' ').slice(0, 60);
  const last6 = s.recent.slice(-6).map(r => sig(r.text));
  s.looping = (last6.length >= 6 && new Set(last6).size <= 2) || /consecutive no-op/i.test(s.lastAssistant || '');
  s.stalled = !s.blocked && (s.lastKind === 'tool' || s.lastKind === 'user') && age > 15 * 60e3 && age < 6 * 3600e3;
  // Where the session lives on disk, so it can be resumed from the right folder.
  const dirName = path.basename(path.dirname(file));
  const enc = c => c.replace(/[^a-zA-Z0-9]/g, '-');
  const candidates = Object.keys(s.cwdHits).flatMap(c => c.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/')).filter(Boolean));
  s.originCwd = candidates.find(c => enc(c) === dirName) || null;
  // Only treat questions as open if they're the session's last word and recent.
  if (age < 24 * 3600e3) {
    const pend = [...asks.values()];
    if (pend.length) s.pendingAsk = pend[pend.length - 1];
    else if (s.lastKind === 'assistant' && !s.blocked) s.openQuestion = lastQuestion(s.lastAssistant || '');
  }
  return s;
}

function matchesProject(dir, p) {
  if ((p.exclude || []).some(x => dir === x || dir.startsWith(x + '-'))) return false;
  return p.transcripts.some(t => dir === t || dir.startsWith(t + '-'));
}

const isUnder = (cwd, roots) => roots.some(r => cwd === r || cwd.startsWith(r + '/'));

function recentFiles(dirFilter) {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR).filter(dirFilter); } catch { return []; }
  const files = [];
  for (const d of dirs) {
    const full = path.join(PROJECTS_DIR, d);
    let entries = [];
    try { entries = fs.readdirSync(full); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(full, f);
      const { mtimeMs } = fs.statSync(file);
      if (Date.now() - mtimeMs < SESSION_WINDOW_MS) files.push({ file, mtimeMs });
    }
  }
  return files;
}

function parseCached({ file, mtimeMs }) {
  const hit = sessionCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.parsed;
  let parsed;
  try { parsed = parseSession(file); } catch { return null; }
  parsed.mtimeMs = mtimeMs;
  sessionCache.set(file, { mtimeMs, parsed });
  return parsed;
}

// Sessions started in a shared folder (e.g. ~/Repositories) belong to the project
// where most of their activity happened.
function attribute(session, projects) {
  let best = null, bestHits = 0;
  for (const p of projects) {
    const roots = [p.path, ...(p.extraPaths || [])];
    const hits = Object.entries(session.cwdHits).filter(([c]) => isUnder(c, roots)).reduce((a, [, n]) => a + n, 0);
    if (hits > bestHits) { best = p; bestHits = hits; }
  }
  return bestHits >= 5 ? best : null;
}

const enc = c => c.replace(/[^a-zA-Z0-9]/g, '-');

function newestJsonl(dir) {
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      const { mtimeMs } = fs.statSync(file);
      if (!best || mtimeMs > best.mtimeMs) best = { file, mtimeMs };
    }
  } catch {}
  return best;
}

// Worktrees of a project, with how recently Claude worked in each.
function worktreesFor(p) {
  const roots = new Map();
  try {
    let cur = null;
    for (const line of git(p.path, ['worktree', 'list', '--porcelain']).split('\n')) {
      if (line.startsWith('worktree ')) { cur = { root: line.slice(9), branch: null }; roots.set(cur.root, cur); }
      else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '');
    }
  } catch {}
  for (const extra of p.extraPaths || []) {
    try { for (const d of fs.readdirSync(extra)) { const root = path.join(extra, d); if (!roots.has(root) && fs.statSync(root).isDirectory()) roots.set(root, { root, branch: null }); } } catch {}
  }
  roots.delete(p.path);
  const out = [];
  for (const wt of roots.values()) {
    const newest = newestJsonl(path.join(PROJECTS_DIR, enc(wt.root)));
    if (!newest || Date.now() - newest.mtimeMs > SESSION_WINDOW_MS) continue;
    out.push({ ...wt, newest });
  }
  return out.sort((a, b) => b.newest.mtimeMs - a.newest.mtimeMs).slice(0, 4);
}

// Newest transcript write anywhere, so a limit notice in one place doesn't end the world
// while another session is clearly still running.
function latestActivity(excludeFiles) {
  let latest = 0;
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      const n = newestJsonl(path.join(PROJECTS_DIR, d));
      if (n && !excludeFiles.has(n.file)) latest = Math.max(latest, n.mtimeMs);
    }
  } catch {}
  return latest;
}

function collectAll(cfg) {
  const shared = cfg.sharedTranscripts || [];
  const sharedSessions = recentFiles(d => shared.includes(d)).map(parseCached).filter(Boolean);
  const out = {};
  for (const p of cfg.projects) {
    const own = recentFiles(d => matchesProject(d, p)).map(parseCached).filter(Boolean);
    const borrowed = sharedSessions.filter(s => attribute(s, cfg.projects) === p);
    const sessions = [...own, ...borrowed].sort((a, b) => Date.parse(b.lastTs || 0) - Date.parse(a.lastTs || 0)).slice(0, MAX_SESSIONS);
    const worktrees = worktreesFor(p);
    // Make sure each camp's latest Claude is known, even if older than the newest sessions.
    for (const wt of worktrees) {
      if (sessions.some(s => s.file === wt.newest.file)) continue;
      const s = parseCached(wt.newest);
      if (s) sessions.push(s);
    }
    sessions.sort((a, b) => Date.parse(b.lastTs || 0) - Date.parse(a.lastTs || 0));
    try { out[p.id] = { ...gitFacts(p.path), doc: docFacts(p), sessions, worktrees: worktrees.map(w => ({ root: w.root, branch: w.branch, lastTs: new Date(w.newest.mtimeMs).toISOString() })) }; }
    catch (e) { console.warn(`[collect] ${p.id}: ${e.message}`); }
  }
  return out;
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
}

function gitFacts(dir) {
  try {
    const log = git(dir, ['log', '-12', '--pretty=%h\x1f%ct\x1f%s']);
    const commits = log ? log.split('\n').map(l => {
      const [hash, ct, subject] = l.split('\x1f');
      return { hash, at: new Date(+ct * 1000).toISOString(), subject };
    }) : [];
    const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const dirty = git(dir, ['status', '--porcelain']).split('\n').filter(Boolean).length;
    return { commits, branch, dirty };
  } catch { return { commits: [], branch: null, dirty: 0 }; }
}

function docFacts(p) {
  for (const name of p.docs || []) {
    try {
      const text = fs.readFileSync(path.join(p.path, name), 'utf8');
      return { name, excerpt: text.slice(0, 2500) };
    } catch {}
  }
  return null;
}

module.exports = { collectAll, latestActivity };
