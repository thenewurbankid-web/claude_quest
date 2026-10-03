// The Gloamwyrm battle box (R2, PLAN-engine.md): a full-screen turn-based fight over the weighted backlog. The rules are
// boss.js; this file is the screen and the turn flow. Each turn you face one of its Riddles, gather light (mash) for a
// bigger hit, or retreat to the Lodge. Normal Riddles open the conversation box with an input lock; confirm and never
// ones pause the fight for the Lodge. Answers go through the Riddle rules exactly as outside combat, and hits come only
// from Riddles getting resolved; nothing here ever chooses an answer.
import { applyChanges, DEFAULT_RULES } from './contract.js';
import { riddleNpcs, riddleContext, answerRiddle, askBack, replyToAsk, trueSight, riskTier, ASK_LATER } from './riddles.js';
import { bossScore, bossSize, whyLine, summon, face, settle, retreat, unresolved, returnNote, emptyBossPlay } from './boss.js';

const STYLE_ID = 'qbt-styles';
const CSS = `
.qbt-root { position: fixed; inset: 0; z-index: 1050; display: grid; grid-template-rows: auto 1fr auto; color: #eef0f4;
  font: 14px/1.4 system-ui, -apple-system, sans-serif; background: radial-gradient(ellipse at 50% 40%, #3a2d5c 0%, #1a1530 55%, #0b0a14 100%); }
.qbt-root[hidden] { display: none; }
.qbt-root *, .qbt-root *::before, .qbt-root *::after { box-sizing: border-box; }
body.qbt-open .qob-root { z-index: 1060; top: 96px; bottom: auto; }
.qbt-head { padding: 14px 16px 6px; max-width: 760px; width: 100%; margin: 0 auto; }
.qbt-title { display: flex; align-items: baseline; gap: 10px; margin: 0 0 6px; font: 700 18px/1.2 Georgia, serif; letter-spacing: .02em; }
.qbt-badge { font: 600 11px/1 system-ui, sans-serif; padding: 3px 7px; border-radius: 999px; background: rgba(255,179,71,.18); color: #ffcf8a; }
.qbt-hp { height: 12px; border-radius: 6px; background: rgba(255,255,255,.1); overflow: hidden; border: 1px solid rgba(255,255,255,.15); }
.qbt-hp > i { display: block; height: 100%; background: linear-gradient(90deg, #8f6bff, #c9a8ff); transition: width .5s ease; }
.qbt-hpnum { font-size: 12px; color: #b8b2cc; margin-top: 3px; display: flex; justify-content: space-between; gap: 8px; }
.qbt-fed { margin-top: 6px; font-size: 13px; color: #d6d0ea; }
.qbt-fed summary { cursor: pointer; }
.qbt-fed ul { margin: 6px 0 0; padding-left: 18px; }
.qbt-fed li { margin: 2px 0; }
.qbt-fed small { color: #a39cbb; display: block; }
.qbt-stage { position: relative; min-height: 0; }
.qbt-dmg { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); font: 800 28px/1 system-ui, sans-serif;
  color: #ffe08a; text-shadow: 0 2px 8px rgba(0,0,0,.6); pointer-events: none; animation: qbt-rise 1.1s ease-out forwards; }
@keyframes qbt-rise { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -40px); } }
.qbt-panel { padding: 10px 16px 16px; max-width: 760px; width: 100%; margin: 0 auto; background: rgba(10,9,20,.78);
  border-top: 1px solid rgba(255,255,255,.12); border-radius: 14px 14px 0 0; }
.qbt-log { min-height: 2.8em; margin: 0 0 8px; color: #f3ecff; }
.qbt-real { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,.07); white-space: pre-wrap; }
.qbt-list { display: grid; gap: 6px; margin: 0 0 8px; }
.qbt-btn { min-height: 44px; padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.22);
  background: rgba(255,255,255,.08); color: inherit; font: inherit; text-align: left; cursor: pointer; touch-action: manipulation; }
.qbt-btn:hover:not(:disabled) { background: rgba(255,255,255,.16); }
.qbt-btn:focus-visible { outline: 2px solid #ffcf8a; outline-offset: 2px; }
.qbt-btn:disabled { opacity: .45; cursor: default; }
.qbt-btn small { display: block; color: #b8b2cc; font-size: 12px; }
.qbt-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.qbt-row .qbt-btn { flex: 1 1 160px; text-align: center; }
.qbt-meter { flex: 1 1 100%; height: 6px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; }
.qbt-meter > i { display: block; height: 100%; width: 0; background: #ffcf8a; }
.qbt-note { font-size: 12px; color: #a39cbb; margin: 6px 0 0; }
.qbt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (prefers-reduced-motion: reduce) { .qbt-hp > i { transition: none; } .qbt-dmg { animation-duration: .01s; } }
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const btn = (text, sub) => {
  const b = el('button', 'qbt-btn', text);
  b.type = 'button';
  if (sub) b.append(el('small', '', sub));
  return b;
};
const TIER_NOTE = { normal: 'asked here', confirm: 'a real decision: answered in the Lodge', never: 'answered outside the game' };
const WYRM_MOVES = [
  w => `The Gloamwyrm coils. The Haze thickens around ${w}.`,
  w => `The Gloamwyrm breathes out grey. ${w} is waiting.`,
  w => `The Gloamwyrm circles, slow and heavy. ${w} still feeds it.`,
];

/**
 * Applies what the conversation box returned: a question asked back, a pasted reply, or an answer (deferring included).
 * Shared with boot.js so combat answers go through exactly the same rules as anywhere else.
 */
export async function applyTalk(store, riddleId, res, { rules = DEFAULT_RULES, agentName = 'the Keeper' } = {}) {
  const now = await store.snapshot(), me = now.realm.owner;
  if (res.askBack) return applyChanges(store, askBack(now, riddleId, { text: res.askBack, by: me }));
  if (res.reply) return applyChanges(store, replyToAsk(now, riddleId, { text: res.reply, by: agentName }));
  return applyChanges(store, answerRiddle(now, riddleId, { text: res.choice, by: me }, new Date(), rules));
}

/**
 * Mount the battle box (hidden until fight()).
 * @param {HTMLElement} container
 * @param {{ store: object, talk: object, rules?: object, play?: object, savePlay?: (p: object) => void,
 *   onEnd?: (play: object) => void, art?: boolean, lockMs?: number }} opts
 */
export function mountBattle(container, { store, talk, rules = DEFAULT_RULES, play = emptyBossPlay(), savePlay = () => {},
  onEnd = () => {}, art = true, lockMs = 900 } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.append(s);
  }
  const root = el('div', 'qbt-root');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Battle with the Gloamwyrm');
  const head = el('div', 'qbt-head');
  const title = el('h2', 'qbt-title', 'The Gloamwyrm');
  const badge = el('span', 'qbt-badge');
  title.append(badge);
  const hp = el('div', 'qbt-hp');
  hp.setAttribute('role', 'progressbar');
  hp.setAttribute('aria-label', 'The Gloamwyrm\'s strength');
  const hpFill = el('i');
  hp.append(hpFill);
  const hpNum = el('div', 'qbt-hpnum');
  const fed = el('details', 'qbt-fed');
  head.append(title, hp, hpNum, fed);
  const stage = el('div', 'qbt-stage');
  const panel = el('div', 'qbt-panel');
  const log = el('p', 'qbt-log');
  log.setAttribute('aria-live', 'polite');
  const body = el('div');
  panel.append(log, body);
  root.append(head, stage, panel);
  container.append(root);

  let wyrm = null, mash = 0, mashAt = 0, busy = false, view = 'turn', fedOpen = false;
  fed.addEventListener('toggle', () => { fedOpen = fed.open; });
  const save = p => { play = p; savePlay(p); };
  const logEvents = events => events.length && applyChanges(store, { puts: [], events });

  // ---------- light (mashing) ----------
  // Pressing Space or "Gather light" fills a meter that slowly drains; the next hit spends it. It adds at most
  // rules.mashBonus to that hit and is never read by anything that answers.
  const meterFill = el('i');
  // It only drains on your turn (never while a question is open), slowly enough to charge during the Gloamwyrm's beat.
  const drain = () => {
    const now = performance.now();
    if (view === 'turn') mash = Math.max(0, mash - (now - mashAt) / 1000 * 0.06);
    mashAt = now;
    meterFill.style.width = `${Math.round(mash * 100)}%`;
  };
  const gather = () => {
    if (root.hidden || view !== 'turn') return; // the Gloamwyrm's beat included: something to do while it moves
    drain();
    mash = Math.min(1, mash + 0.08);
    meterFill.style.width = `${Math.round(mash * 100)}%`;
  };
  setInterval(() => !root.hidden && drain(), 200);
  addEventListener('keydown', e => {
    if (root.hidden || e.key !== ' ' || document.querySelector('.qcv-root:not([hidden])')) return;
    e.preventDefault(); // Space never presses a focused button here: it only gathers light
    gather();
  }, true);

  // ---------- drawing ----------
  async function draw(line) {
    const b = play.battle, l = await store.snapshot();
    const score = bossScore(l, new Date(), rules);
    badge.textContent = b.strength > 1 ? `returned, ×${b.strength}` : '';
    badge.hidden = b.strength <= 1;
    hpFill.style.width = `${Math.round(b.hp / b.maxHp * 100)}%`;
    hp.setAttribute('aria-valuemin', '0');
    hp.setAttribute('aria-valuemax', String(b.maxHp));
    hp.setAttribute('aria-valuenow', String(b.hp));
    hpNum.replaceChildren(el('span', '', `${b.hp} / ${b.maxHp}`), el('span', '', `turn ${b.turn}`));
    // Why it is the size it is: the score at the summons, and every Work feeding it with each Riddle's reasons.
    const names = score.works.slice(0, 2).map(w => w.workTitle).join(', ') + (score.works.length > 2 ? ` +${score.works.length - 2}` : '');
    const sum = el('summary', '', score.works.length
      ? `Size ${b.score} (it rises past ${rules.bossThreshold}), fed by ${names}. Why?`
      : `Size ${b.score}: nothing feeds it any more.`);
    const list = el('ul');
    for (const w of score.works) {
      const li = el('li', '', `${w.workTitle} (${w.march}): ${w.weight}`);
      for (const p of score.parts.filter(x => x.workId === w.workId))
        li.append(el('small', '', `${p.state === 'deferred' ? 'put off, not here to face; ' : ''}${whyLine(p)}`));
      list.append(li);
    }
    if (!score.works.length) list.append(el('li', '', 'Nothing feeds it any more.'));
    fed.replaceChildren(sum, list);
    fed.open = fedOpen;
    if (line !== undefined) log.textContent = line;
    body.replaceChildren(...await panelFor(l));
  }

  const titleOf = (l, id) => {
    const r = l.riddles.find(x => x.id === id);
    return l.works.find(w => w.id === r?.workId)?.title || id;
  };

  async function panelFor(l) {
    const b = play.battle;
    if (b.phase === 'won' || b.phase === 'retreated') {
      const back = btn('Back to the world');
      back.addEventListener('click', close);
      const out = [el('div', 'qbt-row')];
      out[0].append(back);
      if (b.phase === 'retreated') out.unshift(el('p', 'qbt-note', 'Every answer you gave stays given.'));
      queueMicrotask(() => back.focus());
      return out;
    }
    if (b.phase === 'lodge') return lodgePanel(l, b.current);
    const list = el('div', 'qbt-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Face a question');
    for (const id of unresolved(b)) {
      const r = l.riddles.find(x => x.id === id);
      const waiting = r?.state === 'open' && (r.asks || []).some(a => !a.reply);
      const f = btn(`Face: ${titleOf(l, id)}`, `${TIER_NOTE[riskTier(r || {}, rules)]} · weight ${b.weights?.[id] ?? 1}${waiting ? ' · waiting on a reply' : ''}`);
      f.disabled = busy;
      f.addEventListener('click', () => onFace(id));
      list.append(f);
    }
    const row = el('div', 'qbt-row');
    const light = btn('Gather light (Space)');
    light.addEventListener('pointerdown', e => { e.preventDefault(); gather(); });
    light.addEventListener('click', e => { if (e.detail === 0) gather(); }); // keyboard Enter
    const meter = el('div', 'qbt-meter');
    meter.append(meterFill);
    const back = btn('Retreat to the Lodge');
    back.addEventListener('click', onRetreat);
    row.append(light, back, meter);
    return [list, row, el('p', 'qbt-note', `Light adds up to ${Math.round(rules.mashBonus * 100)}% to your next hit. It never answers for you. Retreat: ${returnNote(play, rules)}`)];
  }

  function lodgePanel(l, id) {
    const r = l.riddles.find(x => x.id === id);
    const w = l.works.find(x => x.id === r?.workId), m = l.marches.find(x => x.id === r?.marchId);
    const tier = riskTier(r || {}, rules);
    const out = [];
    out.push(el('p', 'qbt-note', tier === 'never'
      ? `This one is never answered in the game. Answer it outside, on "${w?.title || r?.workId}" in ${m?.name || 'its project'}.`
      : 'A real decision: the fight waits while you answer it in the Lodge, plainly, with no Haze and no timer.'));
    out.push(el('p', 'qbt-real', r?.text ?? '')); // the real words, verbatim, plain text
    const row = el('div', 'qbt-row');
    if (tier !== 'never') {
      const go = btn('Answer in the Lodge');
      go.addEventListener('click', () => onAsk(id));
      row.append(go);
    }
    const later = btn(ASK_LATER, 'it lands the hit; the question comes back later');
    later.addEventListener('click', () => onLater(id));
    const resume = btn('Back to the fight');
    resume.addEventListener('click', () => onSettle('You leave it for now.'));
    const back = btn('Retreat to the Lodge');
    back.addEventListener('click', onRetreat);
    row.append(later, resume, back);
    out.push(row);
    queueMicrotask(() => resume.focus()); // the safe default: a held key never lands on an answer
    return out;
  }

  const popDamage = n => {
    const d = el('div', 'qbt-dmg', `−${n}`);
    stage.append(d);
    setTimeout(() => d.remove(), 1200);
  };

  // ---------- turns ----------
  async function onFace(id) {
    if (busy) return;
    save(face(play, id));
    if (play.battle.phase === 'lodge') { view = 'lodge'; return draw('The fight pauses. This one goes to the Lodge.'); }
    await onAsk(id);
  }

  async function onAsk(id) {
    view = 'question';
    await draw(play.battle.phase === 'lodge' ? 'In the Lodge, the Haze can\'t reach you.' : 'The fight pauses. Take your time.');
    const l = await store.snapshot();
    const npc = riddleNpcs(l).find(n => n.riddle.id === id);
    const r = npc?.riddle || l.riddles.find(x => x.id === id);
    const work = l.works.find(w => w.id === r.workId);
    const keeper = npc?.keeper || l.keepers.find(k => k.id === work?.keeperId) || null;
    const agentName = keeper?.name || 'the Keeper';
    let line;
    try {
      const res = await talk.ask(r, { speaker: { name: keeper?.name || 'A voice in the Haze' }, tier: riskTier(r, rules),
        flags: trueSight(r.text), workTitle: work?.title, agentName, context: riddleContext(l, id), lockMs });
      if (res) {
        await applyTalk(store, id, res, { rules, agentName });
        line = res.askBack ? `You asked ${agentName}. The question waits for a reply.` : res.reply ? 'The reply is in.' : undefined;
      }
    } catch (err) {
      line = `That answer didn't take: ${err.message}`;
    }
    await onSettle(line);
  }

  async function onLater(id) {
    try { await applyChanges(store, answerRiddle(await store.snapshot(), id, { text: ASK_LATER, by: (await store.snapshot()).realm.owner }, new Date(), rules)); }
    catch (err) { return draw(`That didn't take: ${err.message}`); }
    await onSettle();
  }

  async function onSettle(line) {
    const l = await store.snapshot();
    const spent = mash;
    const res = settle(l, play, { mash: spent }, new Date(), rules);
    if (res.hits.length) mash = 0;
    save(res.play);
    await logEvents(res.events);
    const dealt = res.hits.reduce((s, h) => s + h.damage, 0);
    const regained = res.healed.reduce((s, h) => s + h.hp, 0);
    if (regained && !line) line = `An answer was recalled. The Gloamwyrm regains ${regained}.`;
    if (dealt) { wyrm?.hit(Math.min(1, dealt / play.battle.maxHp * 3)); popDamage(dealt); }
    if (play.battle.phase === 'won') {
      view = 'won';
      wyrm?.fall();
      onEnd(play);
      return draw('The Gloamwyrm falls apart into mist. The Haze lifts.');
    }
    view = 'turn';
    const hitLine = dealt ? `Your answer lands: −${dealt}${res.hits.some(h => h.mashed) && spent > 0 ? ' (with light)' : ''}.` : line || 'No answer, no hit. That\'s fine.';
    // The Gloamwyrm's turn: a short beat of its own, then yours again. It never hurts you or hurries you.
    busy = true;
    wyrm?.windup();
    const next = unresolved(play.battle)[0];
    const move = WYRM_MOVES[play.battle.turn % WYRM_MOVES.length](next ? titleOf(l, next) : 'nothing');
    await draw(`${dealt || !line ? hitLine : line} ${move}`);
    setTimeout(async () => { busy = false; await draw(); body.querySelector('button:not(:disabled)')?.focus(); }, 1100);
  }

  async function onRetreat() {
    const res = retreat(play);
    const note = returnNote({ retreats: play.retreats }, rules);
    save(res.play);
    await logEvents(res.events);
    view = 'retreated';
    talk.close?.();
    onEnd(play);
    await draw(`You fall back to the Lodge. ${note}`);
  }

  // Answers sealed, recalled or put off elsewhere (the outbox strip stays usable mid-fight) are picked up on your turn.
  store.subscribe(l => {
    const b = play.battle;
    if (root.hidden || view !== 'turn' || busy || !b || ['won', 'retreated'].includes(b.phase)) return;
    const state = new Map(l.riddles.map(r => [r.id, r.state]));
    const off = [...b.riddleIds, ...b.lodgeIds].some(id => (state.get(id) !== 'open') !== b.resolvedIds.includes(id));
    if (off) onSettle();
  });

  function close() {
    root.hidden = true;
    document.body.classList.remove('qbt-open');
    wyrm?.dispose();
    wyrm = null;
    dispatchEvent(new CustomEvent('quest:battle', { detail: { open: false } }));
  }

  return {
    get play() { return play; },
    get open() { return !root.hidden; },
    /** Starts a fight (or picks up one left mid-way). Resolves at once; the box handles the rest. */
    async fight() {
      if (!root.hidden) return;
      const l = await store.snapshot();
      if (!play.battle || ['won', 'retreated'].includes(play.battle.phase)) {
        const res = summon(l, play, new Date(), rules);
        save(res.play);
        await logEvents(res.events);
      } else if (play.battle.phase !== 'fighting') save(settle(l, play, {}, new Date(), rules).play);
      root.hidden = false;
      document.body.classList.add('qbt-open');
      dispatchEvent(new CustomEvent('quest:battle', { detail: { open: true } }));
      if (art) {
        try {
          const { mountGloamwyrm } = await import('./gloamwyrm.js');
          wyrm = mountGloamwyrm(stage, { size: bossSize(play.battle.score, rules) });
        } catch (err) { console.warn('Gloamwyrm art unavailable:', err.message); }
      }
      view = 'turn';
      mash = 0;
      const n = unresolved(play.battle).length;
      await draw(`The Haze gathers into the Gloamwyrm. ${n} question${n === 1 ? '' : 's'} feed${n === 1 ? 's' : ''} it. Face one, or fall back.`);
      body.querySelector('button')?.focus();
    },
    close,
  };
}
