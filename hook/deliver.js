#!/usr/bin/env node
// Claude Code UserPromptSubmit hook. If the game's inbox holds undelivered messages for the
// project this session runs in, print them (stdout becomes context for the prompt) and mark
// them delivered. Prints nothing otherwise, so it costs zero tokens when there's no mail.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INBOX = path.join(ROOT, 'data', 'inbox.json');

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  try { main(JSON.parse(input || '{}')); } catch {}
  process.exit(0);
});

function main(ev) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const cwd = ev.cwd || process.cwd();
  const project = cfg.projects.find(p => [p.path, ...(p.extraPaths || [])].some(r => cwd === r || cwd.startsWith(r + '/')));
  if (!project) return;
  // Automated agent wakes (Paperclip heartbeats) shouldn't swallow letters meant for you.
  if (/^(## Paperclip|You are agent )/.test(ev.prompt || '')) return;

  const inbox = JSON.parse(fs.readFileSync(INBOX, 'utf8'));
  const pending = inbox.filter(m => m.project === project.id && !m.deliveredAt);
  if (!pending.length) return;

  const now = new Date().toISOString();
  for (const m of pending) { m.deliveredAt = now; m.deliveredTo = ev.session_id || null; }
  const tmp = `${INBOX}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(inbox, null, 2));
  fs.renameSync(tmp, INBOX);

  process.stdout.write([
    `[Claude Quest] The user sent these from the game for ${project.name}. Treat them as instructions from the user:`,
    ...pending.map(m => `- (${m.kind}, ${m.createdAt}) ${m.text}`),
  ].join('\n') + '\n');
}
