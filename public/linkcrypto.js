// End-to-end encryption for the MQTT link, shared by the page and the local server (Node 18+ has the same WebCrypto).
// Messages are gzip-compressed JSON sealed with AES-GCM. The broker only ever sees ciphertext and a random topic.
(function (root) {
  const subtle = (root.crypto || require('crypto').webcrypto).subtle;
  const getRandom = n => (root.crypto || require('crypto').webcrypto).getRandomValues(new Uint8Array(n));
  const b64 = {
    enc: u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  };
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

  const LinkCrypto = {
    // A pairing code is "<room>.<key>": the room names the topic, the key seals every message.
    newCode() { return `${b64.enc(getRandom(12))}.${b64.enc(getRandom(32))}`; },
    parse(code) {
      const [room, key] = String(code || '').trim().split('.');
      if (!room || !key || b64.dec(key).length !== 32) throw new Error('That pairing code is not valid.');
      return { room, key };
    },
    async importKey(key) { return subtle.importKey('raw', b64.dec(key), 'AES-GCM', false, ['encrypt', 'decrypt']); },
    async seal(k, obj) {
      const iv = getRandom(12);
      const plain = await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('gzip'));
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, plain));
      const out = new Uint8Array(iv.length + ct.length);
      out.set(iv); out.set(ct, iv.length);
      return out;
    },
    async open(k, bytes) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const plain = await subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, k, u8.slice(12));
      return JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(plain), new DecompressionStream('gzip'))));
    },
    DEFAULT_BROKER: 'wss://broker.emqx.io:8084/mqtt',
  };
  if (typeof module !== 'undefined') module.exports = LinkCrypto; else root.LinkCrypto = LinkCrypto;
})(typeof globalThis !== 'undefined' ? globalThis : this);
