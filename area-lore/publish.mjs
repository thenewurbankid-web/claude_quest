// Publishes approved area lore (CLA-16): writes lore/cells.json and lore/<cell>/... into a separate clone of the
// orphan branch `lore`, commits and pushes that branch only. The clone is never the game checkout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir, rm, stat, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { validateAreaLore, validateAreaLoreIndex, AREA_LORE_VERSION, GEOHASH_CELL } from '../public/quest/contract.js';

const run = promisify(execFile);
export const LORE_BRANCH = 'lore';
export const DEFAULT_REMOTE = 'https://github.com/thenewurbankid-web/claude_quest.git';
const git = async (dir, ...args) => (await run('git', ['-C', dir, ...args], { maxBuffer: 1 << 24 })).stdout.trim();
const exists = p => stat(p).then(() => true, () => false);

async function gitTop(dir) { try { return await realpath(await git(dir, 'rev-parse', '--show-toplevel')); } catch { return null; } }

/**
 * Makes sure `dir` is a clone of the remote's `lore` branch (an orphan branch is created when the remote has none).
 * Refuses a directory inside the game checkout, and any other branch than `lore`.
 */
export async function ensureCheckout({ dir, remote, gameDir }) {
  dir = resolve(dir);
  const game = await realpath(gameDir);
  await mkdir(dir, { recursive: true });
  dir = await realpath(dir);
  if (dir === game || dir.startsWith(game + sep) || game.startsWith(dir + sep)) throw new Error('the lore clone must be outside the game checkout');
  if (!(await exists(join(dir, '.git')))) {
    await git(dir, 'init', '-q');
    await git(dir, 'remote', 'add', 'origin', remote);
    const heads = await git(dir, 'ls-remote', '--heads', 'origin', LORE_BRANCH);
    if (heads) { await git(dir, 'fetch', '-q', 'origin', LORE_BRANCH); await git(dir, 'checkout', '-q', '-B', LORE_BRANCH, 'FETCH_HEAD'); }
    else await git(dir, 'checkout', '-q', '--orphan', LORE_BRANCH);
  }
  if ((await gitTop(dir)) !== dir) throw new Error('the lore clone is not its own git repository');
  if ((await git(dir, 'symbolic-ref', '--short', 'HEAD')) !== LORE_BRANCH) throw new Error(`the lore clone must be on ${LORE_BRANCH}`);
  if (await git(dir, 'remote', 'get-url', 'origin') !== remote) await git(dir, 'remote', 'set-url', 'origin', remote);
  return dir;
}

const readJson = async p => JSON.parse(await readFile(p, 'utf8'));

/** Rewrites index.json per cell and cells.json from the entry files present, dropping ended or invalid entries. */
export async function rebuild(dir, now = new Date()) {
  const root = join(dir, 'lore');
  await mkdir(root, { recursive: true });
  const cells = [];
  for (const d of (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && GEOHASH_CELL.test(d.name))) {
    const cdir = join(root, d.name), entries = [];
    for (const f of (await readdir(cdir)).filter(f => f.endsWith('.json') && f !== 'index.json')) {
      let e = null;
      try { e = await readJson(join(cdir, f)); } catch {}
      if (e && !validateAreaLore(e).length && e.cell === d.name && `${e.id}.json` === f && Date.parse(e.endsAt) > now.getTime()) entries.push(e);
      else await rm(join(cdir, f), { force: true });
    }
    if (!entries.length) { await rm(cdir, { recursive: true, force: true }); continue; }
    entries.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    const index = { version: AREA_LORE_VERSION, cell: d.name, updatedAt: now.toISOString(),
      entries: entries.map(({ id, kind, startsAt, endsAt }) => ({ id, kind, startsAt, endsAt })) };
    if (validateAreaLoreIndex(index).length) throw new Error(`index for ${d.name} is invalid`);
    await writeFile(join(cdir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    cells.push(d.name);
  }
  await writeFile(join(root, 'cells.json'), JSON.stringify({ version: AREA_LORE_VERSION, updatedAt: now.toISOString(), cells: cells.sort() }, null, 2) + '\n');
}

/**
 * Writes the entries into the clone, commits and pushes `lore` only. Returns the commit sha, or null when nothing changed.
 * @param {{ dir: string, remote: string, gameDir: string, entries: object[], now?: Date, message?: string }} a
 */
export async function publish({ dir, remote, gameDir, entries, now = new Date(), message }) {
  dir = await ensureCheckout({ dir, remote, gameDir });
  for (const e of entries) {
    if (validateAreaLore(e).length) throw new Error(`entry ${e.id} is invalid`);
    await mkdir(join(dir, 'lore', e.cell), { recursive: true });
    await writeFile(join(dir, 'lore', e.cell, `${e.id}.json`), JSON.stringify(e, null, 2) + '\n');
  }
  await rebuild(dir, now);
  await git(dir, 'add', '-A', 'lore');
  if (await git(dir, 'status', '--porcelain')) {
    const who = [];
    for (const [k, v] of [['user.name', 'Quest lore'], ['user.email', 'lore@localhost']])
      if (!(await git(dir, 'config', k).catch(() => ''))) who.push('-c', `${k}=${v}`);
    await git(dir, ...who, 'commit', '-q', '-m', message || `lore: ${entries.length} approved ${entries.length === 1 ? 'story' : 'stories'}`);
  }
  if (!(await git(dir, 'rev-parse', '--verify', '-q', 'HEAD').catch(() => ''))) return null;
  await git(dir, 'push', '-q', 'origin', `${LORE_BRANCH}:refs/heads/${LORE_BRANCH}`);
  return git(dir, 'rev-parse', 'HEAD');
}
