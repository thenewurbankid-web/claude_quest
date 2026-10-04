// R3 area lore, the writer: turns one real happening into an in-world line, a game-only question and its choices.
// Ollama on the self-hosted runner first (the askModel pattern from lib/story.js, no hosted API), a template when
// Ollama is down or answers badly. Whatever comes back is clipped plain text; the hint is built here from the real
// event, never by the model, so it always names what actually happens.

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const TEMPLATES = {
  festival: { line: 'Banners go up for a festival in the Hollow', question: 'The festival steward asks where to hang the last banner.', options: ['Over the well', 'On the Lodge door'] },
  market: { line: 'Stalls line the square for market day', question: 'A stallholder needs three baskets carried to the Lodge.' },
  sports: { line: 'Folk gather to cheer a contest at the green', question: 'The judges ask you to carry water to the players.', options: ['Carry it', 'Cheer instead'] },
  music: { line: 'Bards gather at the Lodge tonight', question: 'The bards ask which tale they should sing first.', options: ["The Gloamwyrm's fall", 'The first Beacon', 'Let them choose'] },
  seasonal: { line: 'The Hollow dresses up for the season', question: 'The lamplighter asks which lanterns to light for the feast.', options: ['The river lanterns', 'The orchard lanterns'] },
};
const SKY = {
  clear: { line: 'Clear skies over the Hollow', question: 'The miller asks whether to open the sails today.', options: ['Open them', 'Wait for wind'] },
  cloud: { line: 'Grey clouds drift over the Hollow', question: 'The washer asks whether to hang the linen out.', options: ['Hang it', 'Keep it in'] },
  rain: { line: "Rain drums on the Hollow's roofs", question: 'The well-keeper asks whether to cover the well or let it fill.', options: ['Cover it', 'Let it fill'] },
  snow: { line: 'Snow settles on the Hollow', question: 'The Lodge keeper asks you to clear the path to the door.' },
  fog: { line: 'Fog rolls in over the fields', question: 'A traveller is lost in the fog. Light the way?', options: ['Light a lantern', 'Ring the bell'] },
  storm: { line: 'Thunder rolls over the Hollow', question: 'The shepherd asks you to help bring the flock in.' },
};

/** The real event, in a short plain line for the hint tooltip. */
export const hintOf = ev => clip([ev.title, ev.where].filter(Boolean).join(', '), 140) || clip(ev.feed, 60);

/** The template words for a happening of `kind`. */
export function templateWords(kind, ev = {}) {
  const t = kind === 'weather' ? SKY[ev.sky] || SKY.clear : TEMPLATES[kind];
  return { line: t.line, question: t.question, ...(t.options ? { options: [...t.options] } : {}), writer: 'template' };
}

const SYSTEM = `You write one short in-world notice for a cosy fantasy village called Ember Hollow, inspired by a real local happening.
Never name real people, brands, venues, places or dates. Never mention the real world. No politics, no harm.
Write: line (a headline under 60 characters, present tense), question (a small request a villager makes of the player, under 120 characters),
options (0 to 3 short answers under 30 characters each; empty for an errand that is simply done).`;
const SCHEMA = { type: 'object', properties: { line: { type: 'string' }, question: { type: 'string' },
  options: { type: 'array', items: { type: 'string' } } }, required: ['line', 'question', 'options'] };

/**
 * Words from Ollama, or the template when it fails or answers with something unusable.
 * @param {{ url: string, model: string }|null} ollama  null skips the model
 */
export async function writeWords(kind, ev, ollama, { fetchFn = globalThis.fetch, timeoutMs = 120_000, keepAlive } = {}) {
  if (!ollama?.url || !ollama?.model) return templateWords(kind, ev);
  try {
    const res = await fetchFn(`${ollama.url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model: ollama.model, stream: false, think: false, ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {}), format: SCHEMA, options: { temperature: 0.8 },
        messages: [{ role: 'system', content: SYSTEM },
          { role: 'user', content: `Kind: ${kind}\nHappening: ${clip(ev.title, 120)}${ev.sky ? `\nSky: ${ev.sky}` : ''}` }] }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const s = JSON.parse((await res.json()).message.content);
    const line = clip(s.line, 60), question = clip(s.question, 140);
    const options = (Array.isArray(s.options) ? s.options : []).map(o => clip(o, 30)).filter(Boolean).slice(0, 3);
    if (line.length < 8 || question.length < 12) throw new Error('too short');
    return { line, question, ...(options.length >= 2 ? { options } : {}), writer: 'ollama' };
  } catch {
    return templateWords(kind, ev);
  }
}
