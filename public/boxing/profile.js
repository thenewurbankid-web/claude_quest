/** Fighter profiles as they travel (P2P `start`, offers) and as the arena renders them. */
import { normalizeLook, PHOTO_OUTFITS } from './boxer-model.js';

/** Shipped to the engine and the other player. `look` is render-only: FighterModel never reads it, so lockstep is unaffected. */
export const profileOf = (f) => (f.look
  ? { name: f.name, stats: { ...f.stats }, look: normalizeLook(f.look) }
  : { name: f.name, stats: { ...f.stats } });

/** A profile from the other side: its look is always rebuilt through normalizeLook, with the corner's photo outfit filling gaps. */
export const receivedProfile = (p, corner) => ({ ...p, look: normalizeLook(p?.look, PHOTO_OUTFITS[corner]) });
