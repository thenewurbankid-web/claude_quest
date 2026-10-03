// R3 area lore, the generator's sources (PLAN-engine.md, "R3 Lore quests"): local weather from Open-Meteo, and real
// local happenings from each area's iCal and RSS feeds. Only allowed kinds pass (festivals, markets, sports, music,
// seasonal, weather); anything else is dropped here, at the source. Feed text is real-world text: it is only ever
// clipped plain text, and it never reaches a player except as the hint naming the real event.

/** @typedef {{ uid: string, title: string, where: string, startsAt: string, endsAt: string, feed: string, url: string|null }} RawEvent */

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- what may pass ----------
const KINDS = {
  festival: /\b(festival|fete|fête|fair|carnival|parade|celebration|gala)\b/i,
  market: /\b(market|bazaar|car boot|flea|farmers'?|craft fair|makers)\b/i,
  sports: /\b(match|marathon|half marathon|parkrun|race|cup|league|tournament|football|cricket|rugby|tennis|cycling|regatta|derby)\b/i,
  music: /\b(concert|gig|live music|orchestra|band|choir|dj|jazz|open mic|recital|folk night)\b/i,
  seasonal: /\b(halloween|christmas|diwali|easter|bonfire|fireworks|new year|harvest|solstice|lantern|eid|hanukkah|lunar new year)\b/i,
};
// Never written, even when a kind matches: news, politics and harm are not game material.
const NEVER = /\b(protest|rally|election|vote|council meeting|police|crime|arrest|murder|death|died|funeral|vigil|memorial|war|strike|accident|fire alarm|flood warning|court|trial|charity appeal|fundraiser)\b/i;

/** The allowed kind of a happening, or null to drop it. Checked in order, so "Christmas market" is a market. */
export function classify(text) {
  const t = String(text || '');
  if (!t.trim() || NEVER.test(t)) return null;
  for (const k of ['market', 'music', 'sports', 'festival', 'seasonal']) if (KINDS[k].test(t)) return k;
  return null;
}

// ---------- iCal ----------
const unfold = s => String(s).replace(/\r?\n[ \t]/g, '');
const icalText = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
/** An iCal date or date-time as ISO. Floating times are read as UTC, which is close enough for a day's lore. */
function icalTime(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
}

/** VEVENTs from an iCal feed. An event with no end lasts to the end of its start day. */
export function parseICal(text, feed = 'ical') {
  const out = [];
  for (const block of unfold(text).split(/BEGIN:VEVENT/).slice(1)) {
    const body = block.split(/END:VEVENT/)[0];
    const get = key => {
      const m = new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.*)$`, 'mi').exec(body);
      return m ? icalText(m[1].trim()) : '';
    };
    const startsAt = icalTime(get('DTSTART'));
    if (!startsAt) continue;
    let endsAt = icalTime(get('DTEND'));
    if (!endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
      const d = new Date(startsAt); d.setUTCHours(23, 59, 0, 0); endsAt = d.toISOString();
    }
    out.push({ uid: get('UID') || `${get('SUMMARY')}@${startsAt}`, title: clip(get('SUMMARY'), 120),
      where: clip(get('LOCATION'), 80), startsAt, endsAt, feed, url: get('URL') || null,
      text: `${get('SUMMARY')} ${get('CATEGORIES')} ${get('DESCRIPTION')}`.slice(0, 600) });
  }
  return out;
}

// ---------- RSS ----------
const tag = (s, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(s);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") : '';
};
/** Items from an RSS feed. A listing feed rarely says when its event is, so an item lasts a day from its pubDate. */
export function parseRSS(text, feed = 'rss') {
  return String(text).split(/<item[\s>]/i).slice(1).map(it => {
    const pub = Date.parse(tag(it, 'pubDate') || tag(it, 'dc:date'));
    if (Number.isNaN(pub)) return null;
    const title = tag(it, 'title');
    return { uid: tag(it, 'guid') || tag(it, 'link') || `${title}@${pub}`, title: clip(title, 120), where: '',
      startsAt: new Date(pub).toISOString(), endsAt: new Date(pub + 864e5).toISOString(), feed,
      url: clip(tag(it, 'link'), 300) || null, text: `${title} ${tag(it, 'category')} ${tag(it, 'description')}`.slice(0, 600) };
  }).filter(Boolean);
}

// ---------- weather ----------
const WMO = c => c >= 95 ? 'storm' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow'
  : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? 'rain' : c === 45 || c === 48 ? 'fog' : c === 3 || c === 2 ? 'cloud' : 'clear';
/**
 * Today's weather for a point as a happening, from an Open-Meteo daily forecast response.
 * @returns {RawEvent & { kind: 'weather', sky: string, high: number, low: number }}
 */
export function weatherEvent(forecast, cell, now = new Date()) {
  const d = forecast?.daily;
  if (!d?.time?.length) return null;
  const today = now.toISOString().slice(0, 10);
  const i = Math.max(0, d.time.indexOf(today));
  const day = d.time[i], sky = WMO(d.weather_code?.[i] ?? 0);
  const high = Math.round(d.temperature_2m_max?.[i] ?? 0), low = Math.round(d.temperature_2m_min?.[i] ?? 0);
  return { uid: `weather-${cell}-${day}`, kind: 'weather', sky, high, low, title: `${sky[0].toUpperCase()}${sky.slice(1)} today, ${low} to ${high}°C`, where: '',
    startsAt: `${day}T00:00:00.000Z`, endsAt: `${day}T23:59:00.000Z`, feed: 'Open-Meteo', url: 'https://open-meteo.com', text: sky };
}
export const forecastUrl = ({ lat, lon }) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=UTC&forecast_days=2`;
