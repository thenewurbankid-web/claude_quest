// Turns collected facts into in-game narrative with a local Ollama model.
// Falls back to deterministic templates when Ollama is unavailable.

const SYSTEM = `You are the narrator of a cozy Pokemon-GBA-style overworld game.
Each town is a real software project. Turn real development facts into short, charming in-game text.
Rules:
- Stay truthful to the facts. Never invent features, numbers, people or progress.
- No battles, no monsters. Refer to Keeper by name or as "it", never "he" or "she".
- Every line is under 90 characters, plain text, no markdown.
- Missions are concrete next steps a developer could take, grounded in the facts.
- Choices are real decisions the developer should make, each with 2-3 short options.
Return JSON only.`;

const SCHEMA = {
  type: 'object',
  properties: {
    townName: { type: 'string' },
    motto: { type: 'string' },
    story: { type: 'array', items: { type: 'string' } },
    scout: { type: 'array', items: { type: 'string' } },
    historian: { type: 'array', items: { type: 'string' } },
    missions: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] },
    },
    choices: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
        required: ['question', 'options'],
      },
    },
  },
  required: ['townName', 'motto', 'story', 'scout', 'historian', 'missions', 'choices'],
};

const clip = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function ago(iso) {
  if (!iso) return 'unknown';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function factsText(p, f, accepted) {
  const out = [`PROJECT: ${p.name} (folder ${p.id})`];
  if (f.branch) out.push(`BRANCH: ${f.branch}, ${f.dirty} uncommitted files`);
  if (f.doc) out.push(`STATUS DOC (${f.doc.name}):\n${clip(f.doc.excerpt, 1500)}`);
  if (f.commits.length) out.push('RECENT COMMITS:\n' + f.commits.slice(0, 6).map(c => `- ${ago(c.at)}: ${c.subject}`).join('\n'));
  if (f.sessions.length) {
    out.push('CLAUDE CODE SESSIONS (newest first):\n' + f.sessions.slice(0, 4).map(s =>
      `- "${s.title || 'untitled'}" ${ago(s.lastTs)}, ${s.status}${s.blocked ? ', BLOCKED by usage limit' : ''}` +
      `\n  user asked: "${clip(s.lastPrompt || s.lastUser, 200)}"\n  Keeper last said: "${clip(s.lastAssistant, 300)}"` +
      (s.openQuestion ? `\n  OPEN QUESTION: ${s.openQuestion}` : '')).join('\n'));
  }
  if (accepted.length) out.push('MISSIONS ALREADY ACCEPTED (do not repeat):\n' + accepted.map(m => `- ${m.title}`).join('\n'));
  out.push(`Write: townName (a whimsical town name inspired by "${p.name}"), motto, story (3 lines),` +
    ' scout (2 lines on what Keeper is doing now), historian (2 lines on recent commits),' +
    ' missions (up to 3), choices (up to 2).');
  return out.join('\n\n');
}

// One structured call to the local model.
async function askModel(cfg, system, user, schema, temperature = 0.7) {
  const res = await fetch(`${cfg.ollama.url}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: cfg.ollama.model, stream: false, think: false, format: schema,
      options: { temperature, num_ctx: 8192 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = await res.json();
  return JSON.parse(j.message.content);
}

async function generateStory(cfg, p, facts, accepted) {
  // The player's own notes for this land (areas/<id>.md) steer names and tone.
  const notes = clip(require('./areas').readNotes(p.id), 1500);
  const s = await askModel(cfg, SYSTEM, factsText(p, facts, accepted) + (notes ? `\n\nTHE PLAYER'S NOTES FOR THIS LAND:\n${notes}` : ''), SCHEMA);
  const lines = (a, n) => (Array.isArray(a) ? a : []).map(x => clip(String(x), 120)).filter(Boolean).slice(0, n);
  return {
    townName: clip(s.townName, 24) || `${p.name} Town`,
    motto: clip(s.motto, 80),
    story: lines(s.story, 4),
    scout: lines(s.scout, 3),
    historian: lines(s.historian, 3),
    missions: (s.missions || []).slice(0, 3).map(m => ({ title: clip(m.title, 60), detail: clip(m.detail, 200) })).filter(m => m.title),
    choices: (s.choices || []).slice(0, 2).map(c => ({ question: clip(c.question, 160), options: lines(c.options, 3) })).filter(c => c.question && c.options.length >= 2),
    source: 'ollama',
  };
}

function fallbackStory(p, f) {
  const s = f.sessions[0];
  const missions = [];
  if (s?.blocked) missions.push({ title: 'Wait out the usage limit', detail: s.blocked });
  if (f.dirty) missions.push({ title: `Commit ${f.dirty} loose files`, detail: `There are ${f.dirty} uncommitted files on ${f.branch}.` });
  if (f.commits[0]) missions.push({ title: 'Review the latest commit', detail: f.commits[0].subject });
  return {
    townName: `${p.name} Town`,
    motto: 'Where the code grows.',
    story: [s ? `Last chapter: "${s.title || 'untitled'}".` : 'A quiet town, waiting for its next adventure.'],
    scout: [],
    historian: [],
    missions,
    choices: [],
    source: 'template',
  };
}

module.exports = { generateStory, fallbackStory, askModel, factsText, ago, clip };
