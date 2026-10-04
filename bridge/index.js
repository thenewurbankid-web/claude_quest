// node bridge/index.js — starts the Bridge. Optional: the game never needs it.
// Env: BRIDGE_CREDENTIAL (default bridge/credential.json),
// BRIDGE_ORIGIN (comma list of the game's origins for CORS), BRIDGE_HTTP_PORT (4779), BRIDGE_TCP_PORT (4780).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBridge } from './bridge.js';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const credPath = process.env.BRIDGE_CREDENTIAL || here('./credential.json');
if (!existsSync(credPath)) { console.error(`No credential file at ${credPath}. See public/quest/sample-bridge.json for its shape.`); process.exit(1); }
const bridge = createBridge({
  credential: JSON.parse(readFileSync(credPath, 'utf8')),
  origin: (process.env.BRIDGE_ORIGIN || 'http://localhost:4777,http://localhost:4790').split(','),
  httpPort: Number(process.env.BRIDGE_HTTP_PORT) || 4779,
  tcpPort: Number(process.env.BRIDGE_TCP_PORT) || 4780,
});
bridge.start().then(p => console.log(`The Bridge listens on 127.0.0.1: http+websocket ${p.http}, mqtt ${p.tcp}`));
