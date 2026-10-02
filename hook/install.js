// Installs the Quest hooks into ~/.claude/settings.json, keeping every other hook.
// Replaces the older single deliver.js hook if present.
const fs = require('fs');
const path = require('path');
const os = require('os');

const file = path.join(os.homedir(), '.claude', 'settings.json');
const live = path.join(__dirname, 'live.js');
const ours = cmd => /claude-quest\/hook\/(deliver|live)\.js/.test(cmd || '');
const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
settings.hooks ??= {};

const wanted = { UserPromptSubmit: 'prompt', PreToolUse: 'pre', PostToolUse: 'post' };
fs.copyFileSync(file, `${file}.bak-claude-quest`);
for (const [event, mode] of Object.entries(wanted)) {
  const groups = (settings.hooks[event] ?? []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h.command)) })).filter(g => g.hooks.length);
  groups.push({ hooks: [{ type: 'command', command: `node ${live} ${mode}`, timeout: 5 }] });
  settings.hooks[event] = groups;
}
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log(`Installed Quest hooks (prompt, pre, post).\nBackup: ${file}.bak-claude-quest`);
