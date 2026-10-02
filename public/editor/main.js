// Asset editor: a library of the game's art (pack sprite sheets, 3D models, imports), a pixel sheet viewer, a 3D
// viewer, import (browser storage, optionally the game folder) and export (one file or the whole library as a zip).
import { createSheetView } from './sheet.js';
import { zip } from './zip.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);
const TILESET = 'Sunnyside_World_ASSET_PACK_V2.1/Sunnyside_World_ASSET_PACK_V2.1/Sunnyside_World_Assets/Tileset/spr_tileset_sunnysideworld_16px.png';
const SUNNY_ROOT = 'Sunnyside_World_ASSET_PACK_V2.1/Sunnyside_World_ASSET_PACK_V2.1/Sunnyside_World_Assets/';
const PACKS = {
  'Sunnyside_World_ASSET_PACK_V2.1': { name: 'Sunnyside World', credit: 'Daniel Diggle' },
  Pixel_16_v2_village_free: { name: 'Pixel 16 Village', credit: 'zedpxl' },
  AllCatsDemo: { name: 'Cats', credit: 'ToffeeCraft' },
  CatMaterialsDEMO: { name: 'Cat materials', credit: 'ToffeeCraft' },
  'Humble_Gift_-_Paper_UI_System_v1.1': { name: 'Paper UI', credit: 'Humble Pixel' },
};
const KAYKIT = { credit: 'Kay Lousberg (KayKit, CC0)' };

let items = [];            // { id, kind: 'sheet'|'model', name, group, sub?, url, blob?, origin, credit, path }
let selected = null;
let manifest = {};
let serverImport = false;  // the running server has the editor endpoints
let modelView = null;      // created lazily (WebGL)

function toast(msg, bad = false) {
  const t = $('toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = bad ? 'bad' : ''), 2600);
}
const fmtBytes = n => n == null ? '' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const kindOf = name => /\.png$/i.test(name) ? 'sheet' : /\.(glb|gltf)$/i.test(name) ? 'model' : null;
const pretty = file => file.split('/').pop().replace(/\.(png|glb|gltf)$/i, '').replace(/^spr_/, '').replace(/_/g, ' ');

// ---------- library ----------
async function loadLibrary() {
  try { const r = await fetch('assets/3d/manifest.json', { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch {}
  let list = null;
  try { const r = await fetch('api/editor/list', { cache: 'no-cache' }); if (r.ok) { list = await r.json(); serverImport = true; } } catch {}
  if (!list) {
    // Older server without the editor endpoints: models from the game manifest, and just the main tileset if present.
    const models = [...new Set([manifest.player, ...(manifest.keeper || []), ...(manifest.animations || [])].flat().filter(Boolean))];
    let packs = [];
    try { const r = await fetch('packs/' + TILESET, { method: 'HEAD' }); if (r.ok) packs = [TILESET]; } catch {}
    list = { packs, models, imported: [] }; // models are relative to assets/3d
  }
  const out = [];
  for (const p of list.packs) {
    const [pack] = p.split('/'), info = PACKS[pack] || { name: pack.replace(/_/g, ' '), credit: 'see the pack' };
    const rel = p.startsWith(SUNNY_ROOT) ? p.slice(SUNNY_ROOT.length) : p.split('/').slice(1).join('/');
    const folders = rel.split('/').slice(0, -1);
    out.push({ id: 'pack:' + p, kind: 'sheet', name: pretty(p), group: info.name, sub: folders.slice(0, 2).join(' / ') || '(top)',
      url: 'packs/' + p, origin: 'pack', credit: info.credit, path: 'packs/' + p, licensed: true, featured: p === TILESET });
  }
  const anim = new Set(manifest.animations || []);
  for (const m of list.models) {
    out.push({ id: 'game:' + m, kind: 'model', name: pretty(m), group: '3D models', sub: anim.has(m) ? 'Animation rigs' : m.startsWith('kaykit/') ? 'KayKit Adventurers' : 'Other',
      url: 'assets/3d/' + m, origin: 'game', credit: m.startsWith('kaykit/') ? KAYKIT.credit : '', path: 'assets/3d/' + m, role: roleOf(m) });
  }
  for (const e of list.imported || []) {
    out.push({ id: 'server:' + e.file, kind: e.kind, name: pretty(e.name || e.file), group: 'Imported', sub: 'In the game folder',
      url: 'assets/imported/' + e.file, origin: 'server', credit: '', path: 'assets/imported/' + e.file, size: e.size });
  }
  for (const r of await store.all()) {
    out.push({ id: 'browser:' + r.id, kind: r.kind, name: pretty(r.name), group: 'Imported', sub: 'In this browser', blob: r.data,
      url: null, origin: 'browser', credit: '', path: 'imported/' + r.name, size: r.data?.size, recId: r.id, fileName: r.name });
  }
  items = out;
  renderLibrary();
  return list;
}
function roleOf(m) {
  const roles = [];
  if (manifest.player === m) roles.push('player');
  if ((manifest.keeper || []).includes(m)) roles.push('Keeper');
  if ((manifest.animations || []).includes(m)) roles.push('shared animations');
  return roles.join(', ');
}

function renderLibrary() {
  const q = $('search').value.trim().toLowerCase();
  const lib = $('library'); lib.textContent = '';
  const shown = items.filter(i => !q || (i.name + ' ' + i.group + ' ' + (i.sub || '')).toLowerCase().includes(q));
  const groups = new Map();
  for (const i of shown) { if (!groups.has(i.group)) groups.set(i.group, new Map()); const g = groups.get(i.group); if (!g.has(i.sub)) g.set(i.sub, []); g.get(i.sub).push(i); }
  const order = ['Sunnyside World', '3D models', 'Imported'];
  const names = [...groups.keys()].sort((a, b) => ((order.indexOf(a) + 1) || 9) - ((order.indexOf(b) + 1) || 9) || a.localeCompare(b));
  if (!items.some(i => i.origin === 'pack') && !q) {
    const e = document.createElement('div'); e.className = 'empty';
    e.innerHTML = '<b>No art packs found.</b> The pixel packs are licensed, so they stay out of git. Unzip them into <code>public/packs/</code> (for Sunnyside: <code>public/packs/Sunnyside_World_ASSET_PACK_V2.1/</code>) and reload.';
    lib.append(e);
  }
  for (const gname of names) {
    const subs = groups.get(gname), total = [...subs.values()].reduce((s, a) => s + a.length, 0);
    const d = document.createElement('details'); d.open = !!q || gname !== 'Pixel 16 Village' && total < 600 && gname !== 'Paper UI' && !/^Cat/.test(gname);
    d.innerHTML = `<summary>${esc(gname)}<span class="n">${total}</span></summary>`;
    const subNames = [...subs.keys()].sort((a, b) => a === 'Tileset' ? -1 : b === 'Tileset' ? 1 : a.localeCompare(b));
    for (const s of subNames) {
      const list = subs.get(s);
      const host = subs.size > 1 || s !== '(top)' ? document.createElement('details') : d;
      if (host !== d) { host.open = !!q || s === 'Tileset' || gname !== 'Sunnyside World' || list.length <= 3; host.innerHTML = `<summary>${esc(s)}<span class="n">${list.length}</span></summary>`; d.append(host); }
      for (const it of list.sort((a, b) => (b.featured - a.featured) || a.name.localeCompare(b.name))) {
        const b = document.createElement('button'); b.className = 'item' + (selected?.id === it.id ? ' sel' : ''); b.dataset.id = it.id;
        b.innerHTML = `<span class="ic">${it.kind === 'model' ? '◆' : '▦'}</span><span>${esc(it.name)}</span>${it.role ? `<span class="tag">${esc(it.role)}</span>` : ''}`;
        b.title = it.path; b.onclick = () => select(it);
        host.append(b);
      }
    }
    lib.append(d);
  }
  if (!shown.length && q) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nothing matches that filter.'; lib.append(e); }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('search').addEventListener('input', renderLibrary);

// ---------- viewers ----------
const sheet = createSheetView($('sheet'), st => {
  $('r-zoom').textContent = `${Math.round(st.scale * 100)}%`;
  $('r-px').textContent = st.hover ? `x ${st.hover.x}, y ${st.hover.y}` : 'x –, y –';
  $('r-cell').textContent = st.hover ? `cell ${Math.floor(st.hover.x / st.cell)}, ${Math.floor(st.hover.y / st.cell)}` : `${st.img?.width || 0}×${st.img?.height || 0}`;
  showSelection(st.sel);
});
let lastSel = '';
function showSelection(sel) {
  const s = sel ? `[${sel.join(', ')}]` : '';
  if (s === lastSel) return; lastSel = s;
  $('sel-rect').textContent = s || 'drag on the sheet';
  $('copy-rect').disabled = $('dl-crop').disabled = !sel;
  clearTimeout(showSelection.t);
  showSelection.t = setTimeout(async () => {
    const blob = await sheet.crop(), img = $('crop');
    if (img.src) URL.revokeObjectURL(img.src);
    if (!blob) { img.hidden = true; img.removeAttribute('src'); return; }
    img.src = URL.createObjectURL(blob); img.hidden = false;
    const [, , w, h] = sheet.state.sel; const k = Math.max(1, Math.min(8, Math.floor(160 / Math.max(w, h))));
    img.style.width = w * k + 'px'; img.style.height = h * k + 'px';
  }, 60);
}
$('z-in').onclick = () => sheet.zoom(1.5); $('z-out').onclick = () => sheet.zoom(1 / 1.5);
$('z-1').onclick = () => sheet.setScale(1); $('z-fit').onclick = () => sheet.fit();
const toggleBtn = (id, key) => $(id).onclick = () => { sheet.toggle(key); $(id).classList.toggle('on', sheet.state[key]); };
toggleBtn('t-grid', 'grid'); toggleBtn('t-snap', 'snap'); toggleBtn('t-pan', 'panMode');
$('cell').onchange = e => { sheet.state.cell = +e.target.value; sheet.draw(); };
$('copy-rect').onclick = async () => {
  const s = $('sel-rect').textContent;
  try { await navigator.clipboard.writeText(s); toast('Copied ' + s); } catch { toast('Copy blocked by the browser: ' + s, true); }
};
$('dl-crop').onclick = async () => {
  const b = await sheet.crop(); if (!b || !selected) return;
  const [x, y, w, h] = sheet.state.sel; download(b, `${selected.name.replace(/\s+/g, '_')}_${x}_${y}_${w}x${h}.png`);
};

const urlOf = it => it.url || (it._obj ||= URL.createObjectURL(it.blob));
function loadImage(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }); }

async function select(it) {
  selected = it;
  document.querySelectorAll('.item.sel').forEach(e => e.classList.remove('sel'));
  document.querySelector(`.item[data-id="${CSS.escape(it.id)}"]`)?.classList.add('sel');
  try { history.replaceState(null, '', '#' + encodeURIComponent(it.id)); } catch {}
  $('placeholder').hidden = true; $('dl-one').disabled = false;
  const isSheet = it.kind === 'sheet';
  $('sheet').hidden = $('tb-sheet').hidden = $('readout').hidden = $('sel-card').hidden = !isSheet;
  $('model').hidden = $('tb-model').hidden = $('clips-card').hidden = isSheet;
  const base = [['Name', it.name], ['Source', { pack: 'Art pack (licensed)', game: 'Game files', server: 'Imported, game folder', browser: 'Imported, this browser' }[it.origin]],
    it.credit && ['Artist', it.credit], it.role && ['Used as', it.role], ['Path', it.path], it.size && ['Size', fmtBytes(it.size)]].filter(Boolean);
  details(base.concat([['', 'Loading…']]));
  if (isSheet) {
    $('sheet-title').textContent = it.name;
    try {
      const img = await loadImage(urlOf(it));
      if (selected !== it) return;
      sheet.set(img);
      details(base.concat([['Pixels', `${img.width} × ${img.height}`], ['Cells', `${Math.ceil(img.width / 16)} × ${Math.ceil(img.height / 16)} at 16 px`]]));
    } catch { details(base.concat([['', 'Could not load this image.']])); }
  } else {
    $('model-title').textContent = it.name;
    try {
      if (!modelView) {
        const { createModelView } = await import('./model.js');
        modelView = createModelView($('model'));
      }
      const rigs = (manifest.animations || []).map(f => 'assets/3d/' + f);
      const { clips, info } = await modelView.load(urlOf(it), rigs);
      if (selected !== it) return;
      details(base.concat([['Meshes', info.meshes], ['Triangles', info.tris.toLocaleString()], ['Bones', info.bones],
        ['Size', `${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`]]));
      renderClips(clips);
    } catch (e) {
      console.warn('[editor] model failed', e);
      details(base.concat([['', 'Could not load this model: ' + (e.message || e)]]));
      renderClips([]);
    }
  }
}
function details(rows) {
  const d = $('details');
  d.innerHTML = '<h2>Details</h2><dl class="kv">' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>' +
    (selected?.origin === 'browser' ? '<div class="row"><button id="forget">Remove from this browser</button></div>' : '');
  const f = $('forget');
  if (f) f.onclick = async () => {
    if (!confirm(`Remove “${selected.name}” from this browser? This can't be undone.`)) return;
    await store.remove(selected.recId); selected = null; showEmpty(); await loadLibrary(); toast('Removed');
  };
}
function showEmpty() {
  for (const id of ['sheet', 'model', 'tb-sheet', 'tb-model', 'readout', 'sel-card', 'clips-card']) $(id).hidden = true;
  $('placeholder').hidden = false; $('dl-one').disabled = true;
  $('details').innerHTML = '<h2>Details</h2><p>Nothing selected.</p>';
}
function renderClips(clips) {
  const box = $('clips'); box.textContent = ''; $('clip-n').textContent = clips.length;
  if (!clips.length) { box.innerHTML = '<p style="margin:0;color:var(--dim);font-size:12.5px">No animations in this model.</p>'; return; }
  for (const c of clips) {
    const b = document.createElement('button'); b.className = 'clip';
    b.innerHTML = `<span>${esc(c.name)}</span><small>${c.duration.toFixed(1)} s · ${esc(c.source)}</small>`;
    b.onclick = () => { modelView.play(c, $('clip-loop').checked); box.querySelectorAll('.on').forEach(e => e.classList.remove('on')); b.classList.add('on'); };
    box.append(b);
  }
  // Start an idle so a rigged character doesn't stand in a T-pose.
  const idle = clips.findIndex(c => /^idle(_a)?$/i.test(c.name)) ;
  if (idle >= 0) box.children[idle].click();
}
$('clip-stop').onclick = () => { modelView?.stop(); $('clips').querySelectorAll('.on').forEach(e => e.classList.remove('on')); };
$('m-frame').onclick = () => modelView?.reframe();
$('m-grid').onclick = () => { const on = !$('m-grid').classList.contains('on'); $('m-grid').classList.toggle('on', on); modelView?.toggleGrid(on); };
$('m-speed').oninput = e => { const v = +e.target.value; modelView?.setSpeed(v); $('m-speed-v').textContent = v.toFixed(2) + '×'; };

// ---------- import ----------
async function importFiles(files) {
  const ok = [...files].filter(f => kindOf(f.name));
  const skipped = files.length - ok.length;
  let last = null, serverFail = null;
  for (const f of ok) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const saved = await store.put({ id, name: f.name, kind: kindOf(f.name), type: f.type, data: f, added: Date.now() });
    last = saved ? 'browser:' + id : last;
    if ($('to-server').checked) {
      try {
        const r = await fetch('api/editor/import?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f });
        if (!r.ok) throw new Error(r.status === 404 ? 'restart the server to enable saving to the game folder' : (await r.json().catch(() => ({}))).error || r.status);
        if (!saved) last = 'server:' + (await r.json()).path.split('/').pop();
      } catch (e) { serverFail = e.message; }
    }
    if (!saved && !$('to-server').checked) toast('This browser blocked storage, so the import could not be kept', true);
  }
  await loadLibrary();
  const it = items.find(i => i.id === last);
  if (it) select(it);
  if (serverFail) toast('Kept in the browser, but not the game folder: ' + serverFail, true);
  else if (ok.length) toast(`Imported ${ok.length} file${ok.length > 1 ? 's' : ''}${skipped ? `, skipped ${skipped} (only .png, .glb, .gltf)` : ''}`);
  else if (skipped) toast('Only .png, .glb and .gltf can be imported', true);
}
$('drop').onclick = () => $('file').click();
$('file').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
let dragDepth = 0;
addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer?.files.length) importFiles(e.dataTransfer.files); });

// ---------- export ----------
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function bytesOf(it) {
  if (it.blob) return new Uint8Array(await it.blob.arrayBuffer());
  const r = await fetch(it.url); if (!r.ok) throw new Error(`${it.path}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
$('dl-one').onclick = async () => {
  if (!selected) return;
  try { download(new Blob([await bytesOf(selected)]), selected.fileName || selected.path.split('/').pop()); } catch (e) { toast('Download failed: ' + e.message, true); }
};
$('dl-zip').onclick = async () => {
  const withPacks = $('zip-packs').checked, btn = $('dl-zip');
  const list = items.filter(i => withPacks || i.origin !== 'pack');
  btn.disabled = true;
  try {
    const files = [], entries = [], used = new Set();
    for (let n = 0; n < list.length; n++) {
      const it = list[n];
      btn.textContent = `Packing ${n + 1} / ${list.length}…`;
      let name = it.path, k = 2;
      while (used.has(name)) name = it.path.replace(/(\.\w+)$/, `-${k++}$1`);
      used.add(name);
      files.push({ name, data: await bytesOf(it) });
      entries.push({ name: it.name, kind: it.kind, file: name, source: it.origin, ...(it.credit && { artist: it.credit }), ...(it.role && { usedAs: it.role }) });
    }
    const man = { app: 'Quest asset library', exported: new Date().toISOString(), credits: {
      'Sunnyside World': 'Daniel Diggle (licensed; not for redistribution)', 'KayKit Adventurers': 'Kay Lousberg (CC0)' },
      gameManifest: manifest, assets: entries };
    files.unshift({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(man, null, 2)) });
    download(zip(files), `quest-assets-${new Date().toISOString().slice(0, 10)}.zip`);
    toast(`Exported ${entries.length} assets`);
  } catch (e) { toast('Export failed: ' + e.message, true); }
  btn.disabled = false; btn.textContent = 'Export library (.zip)';
};

// ---------- start ----------
await loadLibrary();
if (!serverImport) { $('to-server').disabled = true; $('to-server').parentElement.title = 'The running server has no editor endpoints yet. Restart it to enable.'; }
const want = decodeURIComponent(location.hash.slice(1));
const first = items.find(i => i.id === want) || items.find(i => i.featured) || items.find(i => i.kind === 'model');
if (first) select(first);
