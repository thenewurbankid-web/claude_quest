#!/usr/bin/env node
// Claude Code hooks for live control from the game.
//   live.js pre   (PreToolUse)  - if the STOP banner is up for this project, deny the tool call.
//   live.js post  (PostToolUse) - hand any pending game messages to the running session mid-turn.
//   live.js prompt (UserPromptSubmit) - same delivery on your next prompt; lowers STOP since you're back.
// Prints nothing when there's nothing to do, so it costs no tokens.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const mode = process.argv[2];

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  try { main(JSON.parse(input || '{}')); } catch {}
  process.exit(0);
});

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const write = (f, v) => { const file = path.join(DATA, f), tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, file); };

function main(ev) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const cwd = ev.cwd || process.cwd();
  const project = cfg.projects.find(p => [p.path, ...(p.extraPaths || [])].some(r => cwd === r || cwd.startsWith(r + '/')));
  if (!project) return;
  const automated = /^(## Paperclip|You are agent )/.test(ev.prompt || '');

  if (mode === 'pre') {
    const stop = read('control.json', { stops: {} }).stops[project.id];
    if (!stop) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'STOP: the user raised the stop banner in Claude Quest. Do not call any more tools. Reply with a two-line status of where you are and end your turn.',
      },
    }));
    return;
  }

  if (mode === 'prompt' && !automated) {
    const c = read('control.json', { stops: {} });
    if (c.stops[project.id]) { delete c.stops[project.id]; write('control.json', c); }
  }
  if (automated) return;

  const inbox = read('inbox.json', []);
  const pending = inbox.filter(m => m.project === project.id && !m.deliveredAt && (!m.session || m.session === ev.session_id));
  if (!pending.length) return;
  const now = new Date().toISOString();
  for (const m of pending) { m.deliveredAt = now; m.deliveredTo = ev.session_id || null; m.via = mode; }
  write('inbox.json', inbox);

  const text = [
    `[Claude Quest] The user sent these from the game for ${project.name}. Treat them as instructions from the user:`,
    ...pending.map(m => `- ${m.text}`),
  ].join('\n');
  if (mode === 'post') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
  else process.stdout.write(text + '\n');
}
