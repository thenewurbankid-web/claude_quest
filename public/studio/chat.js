// Studio chat panel: a provider + model picker over the plugin endpoints, a message list and a composer.
// Shared by every studio surface (asset editor now; lore and the 3D viewer later).
//   const chat = mountChat(el, { system, placeholder, key });
// `system` is the surface's instructions to the model, `key` names its saved picker choice and history.
// Replies stream from POST /api/studio/chat (NDJSON). Paid providers ask before each request.

const CSS = `
.qchat { display: grid; gap: 8px; min-height: 0; }
.qchat .pick { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.qchat select, .qchat textarea { width: 100%; border-radius: 8px; border: 1px solid var(--line, rgba(255,255,255,.09));
  background: rgba(0,0,0,.2); padding: 7px 9px; color: inherit; font: inherit; }
.qchat textarea { resize: vertical; min-height: 58px; }
.qchat .log { display: grid; gap: 8px; max-height: 340px; overflow: auto; align-content: start; }
.qchat .log:empty { display: none; }
.qchat .msg { padding: 8px 10px; border-radius: 10px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.qchat .msg.user { background: rgba(255,179,71,.14); justify-self: end; max-width: 92%; }
.qchat .msg.assistant { background: rgba(255,255,255,.06); }
.qchat .msg.error { background: rgba(255,138,128,.12); color: #ffb4ac; }
.qchat .msg pre { margin: 6px 0; padding: 8px; border-radius: 8px; background: rgba(0,0,0,.35); overflow: auto; white-space: pre; font: 12px ui-monospace, Menlo, monospace; }
.qchat .msg .thinking { color: var(--dim, #9aa3c0); font-style: italic; }
.qchat .msg.pending::after { content: '▍'; animation: qblink 1s steps(1) infinite; margin-left: 1px; }
@keyframes qblink { 50% { opacity: 0; } }
.qchat .row { display: flex; gap: 6px; align-items: center; }
.qchat .row .note { margin-right: auto; font-size: 12px; color: var(--dim, #9aa3c0); }
`;

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// Plain text with ``` fenced blocks shown as code. Nothing else is interpreted.
const render = text => text.split(/```[\w-]*\n?/).map((part, i) => i % 2 ? `<pre>${esc(part.replace(/\n$/, ''))}</pre>` : esc(part)).join('');

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function mountChat(el, { system = '', placeholder = 'Ask something…', key = 'default' } = {}) {
  if (!document.getElementById('qchat-css')) {
    const st = document.createElement('style'); st.id = 'qchat-css'; st.textContent = CSS; document.head.append(st);
  }
  const PICK = 'quest-chat-pick', HIST = 'quest-chat-' + key;
  el.classList.add('qchat');
  el.innerHTML = `
    <div class="pick">
      <select class="prov" aria-label="Provider"></select>
      <select class="model" aria-label="Model"></select>
    </div>
    <div class="log" aria-live="polite"></div>
    <textarea rows="2" placeholder="${esc(placeholder)}" aria-label="Message"></textarea>
    <div class="row"><span class="note"></span><button class="clear" type="button">Clear</button><button class="send primary" type="button">Send</button></div>`;
  const q = s => el.querySelector(s);
  const prov = q('.prov'), model = q('.model'), log = q('.log'), input = q('textarea'), send = q('.send'), clear = q('.clear'), note = q('.note');

  let providers = [];
  let messages = load(HIST, []);
  let busy = null; // AbortController while a reply streams
  const pick = load(PICK, {});

  function bubble(role, text, cls = '') {
    const d = document.createElement('div');
    d.className = `msg ${role} ${cls}`;
    d.innerHTML = render(text);
    log.append(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  const redraw = () => { log.textContent = ''; for (const m of messages) bubble(m.role, m.content); };
  const setNote = s => (note.textContent = s);
  const idle = () => { send.textContent = 'Send'; send.disabled = !model.value; prov.disabled = model.disabled = false; };

  async function loadModels() {
    const p = providers.find(x => x.id === prov.value);
    model.innerHTML = '<option value="">loading…</option>'; model.disabled = true; send.disabled = true;
    if (!p) { model.innerHTML = '<option value="">no provider</option>'; return; }
    if (!p.available) { model.innerHTML = '<option value="">not running</option>'; setNote(`${p.label} isn't reachable.`); return; }
    try {
      const r = await fetch('api/studio/models?provider=' + encodeURIComponent(p.id), { cache: 'no-cache' });
      const { models = [], error } = await r.json();
      if (error) throw new Error(error);
      model.innerHTML = models.length ? models.map(m => `<option value="${esc(m.id)}">${esc(m.label || m.id)}</option>`).join('') : '<option value="">no models installed</option>';
      if (pick[p.id] && models.some(m => m.id === pick[p.id])) model.value = pick[p.id];
      model.disabled = !models.length;
      setNote(p.cost === 'paid' ? 'Uses paid credit; asks first.' : 'Free · runs locally');
    } catch (e) {
      model.innerHTML = '<option value="">unavailable</option>'; setNote(e.message);
    }
    send.disabled = !model.value;
  }

  async function init() {
    try {
      const r = await fetch('api/studio/plugins', { cache: 'no-cache' });
      if (!r.ok) throw new Error();
      providers = (await r.json()).plugins.filter(p => p.kind === 'provider');
    } catch {
      prov.innerHTML = '<option>server needed</option>'; prov.disabled = model.disabled = send.disabled = input.disabled = true;
      model.innerHTML = '';
      setNote('Chat needs the local server, restarted since the studio update.');
      return;
    }
    if (!providers.length) { prov.innerHTML = '<option>no providers</option>'; setNote('No provider plugins in plugins/provider/.'); send.disabled = true; return; }
    prov.innerHTML = providers.map(p => `<option value="${esc(p.id)}">${esc(p.label)}${p.available ? '' : ' (off)'}</option>`).join('');
    if (pick.provider && providers.some(p => p.id === pick.provider)) prov.value = pick.provider;
    await loadModels();
  }

  async function ask() {
    const text = input.value.trim();
    if (!text || !model.value) return;
    const p = providers.find(x => x.id === prov.value);
    if (p?.cost === 'paid' && !confirm(`Send this to ${p.label} (${model.value})? It spends your usage.`)) return;
    input.value = '';
    messages.push({ role: 'user', content: text });
    bubble('user', text);
    const out = bubble('assistant', '', 'pending');
    let reply = '';
    busy = new AbortController();
    send.textContent = 'Stop'; prov.disabled = model.disabled = true;
    try {
      const r = await fetch('api/studio/chat', {
        method: 'POST', signal: busy.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: p.id, model: model.value, system, messages }),
      });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || `server ${r.status}`);
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.error) throw new Error(m.error);
          if (m.thinking && !reply) out.innerHTML = `<span class="thinking">thinking… (${m.thinking} chars)</span>`;
          if (m.delta) { reply += m.delta; out.innerHTML = render(reply); log.scrollTop = log.scrollHeight; }
        }
      }
      out.classList.remove('pending');
      messages.push({ role: 'assistant', content: reply });
    } catch (e) {
      out.classList.remove('pending');
      if (e.name === 'AbortError') {
        if (reply) messages.push({ role: 'assistant', content: reply + ' …(stopped)' }), out.innerHTML = render(reply + ' …(stopped)');
        else out.remove(), messages.pop(), (input.value = text);
      } else {
        out.classList.add('error'); out.textContent = 'Error: ' + e.message;
        messages.pop(); input.value = text; // let the user retry the same message
      }
    }
    busy = null;
    save(HIST, messages.slice(-40));
    idle();
    input.focus();
  }

  prov.addEventListener('change', () => { pick.provider = prov.value; save(PICK, pick); loadModels(); });
  model.addEventListener('change', () => { pick[prov.value] = model.value; save(PICK, pick); send.disabled = !model.value; });
  send.addEventListener('click', () => busy ? busy.abort() : ask());
  clear.addEventListener('click', () => { if (busy) busy.abort(); messages = []; save(HIST, messages); redraw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) ask(); }
    e.stopPropagation(); // keep editor shortcuts (Space to pan, etc.) out of the composer
  });

  redraw();
  init();
  return { get messages() { return messages; }, ask: text => { input.value = text; return ask(); } };
}
