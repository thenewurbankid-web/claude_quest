// Thin client for the local Paperclip API (local_trusted mode, no auth). Paperclip owns projects, missions (issues)
// and agent runs; the game reads a snapshot of it and sends a few actions. Every call fails soft: when Paperclip is
// down the game shows the Guild Hall as closed and stays read-only.
const DEFAULT_URL = 'http://127.0.0.1:3100/api';

function client(base = DEFAULT_URL) {
  const host = new URL(base).hostname.replace(/^\[|\]$/g, '');
  if (!/^(localhost|::1|127(\.\d{1,3}){3})$/.test(host)) throw new Error(`Paperclip must be on this machine, got ${host}`);

  async function call(method, p, body) {
    const res = await fetch(base + p, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const err = new Error(`${method} ${p} -> ${res.status} ${String(json?.error ?? text).slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }
  const list = x => Array.isArray(x) ? x : (x && ['items', 'data', 'issues', 'agents', 'projects'].map(k => x[k]).find(Array.isArray)) || [];
  const get = async p => list(await call('GET', p));

  return {
    call,
    companies: () => get('/companies'),
    createCompany: body => call('POST', '/companies', body),
    projects: cid => get(`/companies/${cid}/projects`),
    createProject: (cid, body) => call('POST', `/companies/${cid}/projects`, body),
    patchProject: (id, body) => call('PATCH', `/projects/${id}`, body),
    createWorkspace: (pid, body) => call('POST', `/projects/${pid}/workspaces`, body),
    issues: cid => get(`/companies/${cid}/issues`),
    createIssue: (cid, body) => call('POST', `/companies/${cid}/issues`, body),
    patchIssue: (id, body) => call('PATCH', `/issues/${id}`, body),
    comment: (id, body) => call('POST', `/issues/${id}/comments`, { body }),
    agents: cid => get(`/companies/${cid}/agents`),
    wakeup: (agentId, reason) => call('POST', `/agents/${agentId}/wakeup`, { source: 'on_demand', reason }),
    pause: agentId => call('POST', `/agents/${agentId}/pause`, {}),
    resume: agentId => call('POST', `/agents/${agentId}/resume`, {}),
    cancelRun: runId => call('POST', `/heartbeat-runs/${runId}/cancel`, {}),
    liveRuns: cid => get(`/companies/${cid}/live-runs`),
  };
}

const OPEN = new Set(['backlog', 'todo', 'in_progress', 'in_review', 'blocked']);

// What the game needs from Paperclip, trimmed. companyId null means only report whether Paperclip is up.
async function snapshot(pc, companyId) {
  const at = new Date().toISOString();
  try {
    const companies = await pc.companies();
    if (!companyId) return { up: true, at, companies: companies.map(c => ({ id: c.id, name: c.name })) };
    const [projects, issues, agents, liveRuns] = await Promise.all([
      pc.projects(companyId), pc.issues(companyId), pc.agents(companyId), pc.liveRuns(companyId),
    ]);
    const recentDone = Date.now() - 7 * 864e5;
    return {
      up: true, at, companyId,
      projects: projects.map(p => ({
        id: p.id, name: p.name, status: p.status,
        cwds: (p.workspaces || []).map(w => w.cwd).filter(Boolean),
      })),
      issues: issues
        .filter(i => OPEN.has(i.status) || Date.parse(i.updatedAt || 0) > recentDone)
        .map(i => ({
          id: i.id, key: i.identifier, title: i.title, status: i.status, priority: i.priority,
          projectId: i.projectId, assignee: i.assigneeAgentId, runId: i.executionRunId || i.activeRun?.id || null,
          updatedAt: i.updatedAt,
        })),
      agents: agents.map(a => ({ id: a.id, name: a.name, status: a.status, cwd: a.adapterConfig?.cwd || null })),
      liveRuns: liveRuns.map(r => ({ id: r.id, agentId: r.agentId, issueId: r.issueId || r.contextSnapshot?.issueId || null, status: r.status, startedAt: r.startedAt })),
    };
  } catch (e) {
    return { up: false, at, error: e.message };
  }
}

// ---------- setup: the game's own company, its dev agent, and one project per area ----------
// Idempotent: finds by name or saved id first, creates only what is missing. Agent settings mirror the Line company's
// agents (owner's choice): claude-sonnet-5, no permission prompts, bounded runs, no heartbeat timer, so it only runs
// when the player sends it.
const fs = require('fs');
const path = require('path');
const COMPANY = 'Quest';
const AGENT = 'Quest Dev';

async function ensureGuild(pc, saved = {}) {
  const companies = await pc.companies();
  let company = companies.find(c => c.id === saved.companyId) || companies.find(c => c.name === COMPANY);
  if (!company) company = await pc.createCompany({
    name: COMPANY,
    description: 'Projects the player charts in Quest. Missions are issues; the game sends the agent out.',
  });
  if (company.requireBoardApprovalForNewAgents) company = await pc.call('PATCH', `/companies/${company.id}`, { requireBoardApprovalForNewAgents: false });

  const agents = await pc.agents(company.id);
  let agent = agents.find(a => a.id === saved.agentId) || agents.find(a => a.name === AGENT);
  if (!agent) {
    const root = path.join(__dirname, '..');
    agent = await pc.call('POST', `/companies/${company.id}/agents`, {
      name: AGENT, role: 'engineer', title: 'Questing developer', icon: 'wrench',
      capabilities: 'Takes missions the player accepts in Quest, in whichever area (repository) the issue belongs to.',
      adapterType: 'claude_local',
      adapterConfig: {
        cwd: root, model: 'claude-sonnet-5', effort: 'medium', engine: 'cli', command: 'claude',
        dangerouslySkipPermissions: true, maxTurnsPerRun: 200, timeoutSec: 3600, graceSec: 30,
        workspaceStrategy: { type: 'project_primary' },
      },
      runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
      permissions: { canCreateAgents: false, canCreateSkills: false },
      instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': fs.readFileSync(path.join(root, 'paperclip', 'AGENTS.md'), 'utf8') } },
    });
  }
  return { companyId: company.id, agentId: agent.id };
}

// One Paperclip project per area, with the repository as its primary workspace.
async function ensureArea(pc, companyId, { name, cwd, projectId }) {
  const projects = await pc.projects(companyId);
  let project = projects.find(p => p.id === projectId) || projects.find(p => (p.workspaces || []).some(w => w.cwd === cwd));
  if (!project) project = await pc.createProject(companyId, { name, status: 'in_progress' });
  if (!(project.workspaces || []).some(w => w.cwd === cwd)) await pc.createWorkspace(project.id, { name, cwd, isPrimary: true });
  return project.id;
}

module.exports = { client, snapshot, ensureGuild, ensureArea, DEFAULT_URL };
