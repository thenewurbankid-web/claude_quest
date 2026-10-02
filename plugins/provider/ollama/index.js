// Ollama provider: lists installed models (/api/tags) and streams chat replies (/api/chat, NDJSON).
// Settings: cfg.plugins.ollama.url, else the game's cfg.ollama.url, else the default port.
module.exports = ({ cfg }) => {
  const url = (cfg.plugins?.ollama?.url || cfg.ollama?.url || 'http://localhost:11434').replace(/\/$/, '');

  async function tags() {
    const r = await fetch(url + '/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    return (await r.json()).models || [];
  }

  // Thinking models (qwen3 and others) reason even with think: false and mix it into the reply, so ask for
  // think: true and keep the reasoning out of the text. Capabilities come from /api/tags.
  const thinks = new Map();
  async function canThink(model) {
    if (!thinks.has(model)) for (const m of await tags().catch(() => [])) thinks.set(m.name, !!m.capabilities?.includes('thinking'));
    return !!thinks.get(model);
  }

  return {
    async available() { try { await tags(); return true; } catch { return false; } },

    async models() {
      const list = await tags();
      // Chat models only: skip embedding models, which can't answer.
      return list.filter(m => !/embed/i.test(m.name) && !(m.capabilities && !m.capabilities.includes('completion')))
        .map(m => ({ id: m.name, label: `${m.name}${m.details?.parameter_size ? ' · ' + m.details.parameter_size : ''}`, size: m.size }));
    },

    async *chat({ model, messages, system, signal }) {
      const r = await fetch(url + '/api/chat', {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true, think: await canThink(model),
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] }),
      });
      if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.error) throw new Error(m.error);
          if (m.message?.thinking) yield { thinking: m.message.thinking };
          if (m.message?.content) yield m.message.content;
        }
      }
    },
  };
};
