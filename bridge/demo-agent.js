// node bridge/demo-agent.js <keeperId> [name] — a stand-in agent for the demo: registers as the Keeper, waits for the
// Bridge's work offer, then reports progress and done. Reads the Realm login from bridge/credential.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';

const [keeperId, name = 'Demo Agent'] = process.argv.slice(2);
if (!keeperId) { console.error('usage: node bridge/demo-agent.js <keeperId> [name]'); process.exit(1); }
const cred = JSON.parse(readFileSync(process.env.BRIDGE_CREDENTIAL || fileURLToPath(new URL('./credential.json', import.meta.url)), 'utf8'));
const t = kind => `quest/${cred.realmId}/${kind}/${keeperId}`;
const c = mqtt.connect(`mqtt://127.0.0.1:${process.env.BRIDGE_TCP_PORT || 4780}`, { clientId: `agent-${keeperId}`,
  username: cred.mqtt.username, password: cred.mqtt.password, protocolVersion: 4 });
c.on('connect', () => {
  c.subscribe(t('work'), { qos: 1 });
  c.publish(t('register'), JSON.stringify({ v: 1, keeperId, name, skills: ['demo'], client: 'demo-agent' }), { qos: 1 });
  console.log(`registered as ${keeperId}; waiting for work (the Bridge must be opened in the game)`);
});
c.on('message', (_t, buf) => {
  const offer = JSON.parse(String(buf));
  console.log(`offered: ${offer.title}`);
  const report = (kind, summary, extra = {}) => c.publish(t('report'), JSON.stringify({ v: 1, queueId: offer.queueId, kind, summary, ...extra }), { qos: 1 });
  report('progress', 'Started the demo work', { branch: offer.branch });
  setTimeout(() => { report('done', 'Finished the demo work', { branch: offer.branch }); console.log('reported done'); setTimeout(() => c.end(), 500); }, 1500);
});
