/**
 * State lives in the repo: `.rivalmode/state/*.json`, committed by the bot.
 * No database, no external store, and `git log` doubles as the leaderboard's
 * audit trail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './config.mjs';

export const STATE_FILES = {
  rivals: 'rivals.json',
  momentum: 'momentum.json',
  feed: 'feed.json',
  apiCache: 'api-cache.json',
  history: 'history.json',
};

export function statePath(root, file) {
  return path.join(stateDir(root), file);
}

export function readState(root, file, fallback = null) {
  const target = statePath(root, file);
  try {
    if (!fs.existsSync(target)) return fallback;
    const raw = fs.readFileSync(target, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeState(root, file, value) {
  const target = statePath(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

/** Compact momentum history — one entry per day, 180 days retained. */
export function appendMomentumHistory(previous, entry) {
  const list = Array.isArray(previous?.history) ? previous.history : [];
  const withoutToday = list.filter((item) => item.date !== entry.date);
  const merged = [...withoutToday, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-180);
  return { schema: 1, updatedAt: entry.at, history: merged };
}

/** The last N events, deduped, kept for the README feed fallback. */
export function mergeFeed(previous, incoming, limit = 40) {
  const seen = new Set();
  const out = [];
  for (const item of [...(incoming || []), ...(previous?.items || [])]) {
    const key = `${item.type}:${item.actor}:${item.at}:${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  out.sort((a, b) => new Date(b.at) - new Date(a.at));
  return { schema: 1, items: out.slice(0, limit) };
}

/** Write files, returning only those whose bytes changed. */
export function writeIfChanged(files) {
  const changed = [];
  for (const [target, content] of Object.entries(files)) {
    const body = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
    let before = null;
    try {
      before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    } catch {
      before = null;
    }
    if (before === body) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    changed.push(target);
  }
  return changed;
}
