// The sky follows the player's own clock. Sunrise and sunset come from a place: the rounded location the player
// shared for real weather (stored by weather.js), else a guess from the device time zone. Nothing is asked for here.
const DEG = Math.PI / 180;

export function place() {
  try { const p = JSON.parse(localStorage.getItem('quest.place') || 'null'); if (p && isFinite(p.lat) && isFinite(p.lon)) return p; } catch {}
  // Standard (non-summer) UTC offset → rough longitude. The hemisphere comes from which half of the year has summer time.
  const y = new Date().getFullYear();
  const jan = new Date(y, 0, 1).getTimezoneOffset(), jul = new Date(y, 6, 1).getTimezoneOffset();
  return { lat: jan < jul ? -34 : 48, lon: -Math.max(jan, jul) / 4, guessed: true };
}

// Sunrise and sunset in local clock hours (NOAA approximation, good to a few minutes).
export function sunTimes(date, { lat, lon }) {
  const start = new Date(date.getFullYear(), 0, 0);
  const n = Math.floor((date - start) / 864e5);
  const decl = 23.44 * Math.sin(2 * Math.PI * (284 + n) / 365) * DEG;
  const b = 2 * Math.PI * (n - 81) / 364;
  const eqTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
  const zone = -date.getTimezoneOffset() / 60;
  const noon = 12 - lon / 15 - eqTime / 60 + zone;
  const cosH = (Math.sin(-0.833 * DEG) - Math.sin(lat * DEG) * Math.sin(decl)) / (Math.cos(lat * DEG) * Math.cos(decl));
  if (cosH >= 1) return { rise: noon, set: noon, noon };          // polar night
  if (cosH <= -1) return { rise: noon - 12, set: noon + 12, noon }; // midnight sun
  const h = Math.acos(cosH) / DEG / 15;
  return { rise: noon - h, set: noon + h, noon };
}

// Map the local clock onto the scene's day cycle, where 0.25 is sunrise, 0.5 noon, 0.75 sunset and 0 midnight.
export function dayPhase(date = new Date(), where = place()) {
  const { rise, set } = sunTimes(date, where);
  const t = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const dayLen = Math.min(23.9, Math.max(0.1, set - rise));
  if (t >= rise && t <= set) return 0.25 + 0.5 * (t - rise) / dayLen;
  const since = ((t - set) % 24 + 24) % 24;
  return (0.75 + 0.5 * since / (24 - dayLen)) % 1;
}

export const clockLabel = (date = new Date()) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
