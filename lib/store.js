// Tiny JSON file store shared by the server and the Claude Code hook.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch { return fallback; }
}

// Write to a temp file and rename so a reader never sees half a file.
function write(name, value) {
  const file = path.join(DATA, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { read, write, DATA };
