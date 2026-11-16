/**
 * Configuration. One small JSON file in `.rivalmode/` is the whole install:
 * no env vars required, no secrets, nothing to sign up for.
 */
import fs from 'node:fs';
import path from 'node:path';

export const HOME_DIR = '.rivalmode';
export const CONFIG_FILE = 'config.json';
export const STATE_DIR = 'state';

export const DEFAULT_CONFIG = Object.freeze({
  // Repository RivalMode tracks. `owner/name`; auto-detected from the git
  // remote or GITHUB_REPOSITORY when left empty.
  repo: '',
  // Where generated SVGs are written, relative to the repo root.
  outDir: 'assets/rivalmode',
  // Section markers are inserted into this README.
  readme: 'README.md',
  // Visual theme; see themes/ and CONTRIBUTING.md.
  theme: 'midnight',
  // Where "How the game works" and the team name show up.
  title: 'RivalMode',
  // Rival discovery settings.
  rivals: {
    enabled: true,
    // How many same-topic repos to search per topic.
    searchPerTopic: 8,
    // Minimum days a repo must exist before it can be called a rival.
    minAgeDays: 7,
    // Ignore repos with fewer stars than this (keeps the cluster honest).
    minStars: 0,
    // Cap on leaders shown in the README.
    maxLeaders: 5,
    // How many similar-sized repos make up your ladder.
    clusterSize: 12,
    // Forks are always compared, even for small repos.
    includeForks: true,
    // Topics used when the repo has none of its own.
    fallbackTopics: [],
  },
  // Scoring weights — see README "How the game works".
  points: {
    commit: 2,
    merge: 10,
    star: 5,
    fork: 8,
    release: 25,
    issueClosed: 4,
    streakDay: 3,
    rivalBeaten: 25,
  },
  // Per-event weights when ranking rivals by star velocity.
  feed: {
    limit: 10,
    includeTypes: ['PushEvent', 'WatchEvent', 'ForkEvent', 'ReleaseEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent'],
  },
  // Repo-private mode is detected automatically, but can be forced for
  // forks/CI runs where the repo lookup is unavailable.
  private: false,
  // Fake data for demos and tests. Never commit `mock: true` by accident...
  // (the renderer prints a DEMO watermark when it is on).
  mock: false,
});

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== 'object' || base === null) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

export function configPath(root = '.') {
  return path.join(root, HOME_DIR, CONFIG_FILE);
}

export function stateDir(root = '.') {
  return path.join(root, HOME_DIR, STATE_DIR);
}

export function loadConfig(root = '.') {
  const file = configPath(root);
  let raw = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`RivalMode: ${file} is not valid JSON (${err.message})`);
    }
  }
  return normalizeConfig(deepMerge(DEFAULT_CONFIG, raw));
}

export function saveConfig(config, root = '.') {
  const file = configPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(stripDefaults(config), null, 2)}\n`);
  return file;
}

/** Only persist what differs from the defaults — the file stays readable. */
function stripDefaults(config) {
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    const def = DEFAULT_CONFIG[key];
    if (JSON.stringify(value) === JSON.stringify(def)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && def) {
      const nested = {};
      for (const [k, v] of Object.entries(value)) {
        if (JSON.stringify(v) !== JSON.stringify(def[k])) nested[k] = v;
      }
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function normalizeConfig(config) {
  const cfg = deepMerge(DEFAULT_CONFIG, config ?? {});
  cfg.outDir = String(cfg.outDir || 'assets/rivalmode').replace(/^\/+|\/+$/g, '');
  cfg.readme = cfg.readme || 'README.md';
  cfg.rivals.searchPerTopic = Math.max(1, Math.min(30, Number(cfg.rivals.searchPerTopic) || 8));
  cfg.rivals.maxLeaders = Math.max(1, Math.min(10, Number(cfg.rivals.maxLeaders) || 5));
  cfg.feed.limit = Math.max(1, Math.min(25, Number(cfg.feed.limit) || 10));
  for (const [key, value] of Object.entries(cfg.points)) {
    cfg.points[key] = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_CONFIG.points[key];
  }
  return cfg;
}

/** `owner/name` for the current checkout, in order of trustworthiness. */
export function detectRepo(config = {}, env = process.env) {
  if (config.repo) return config.repo;
  if (env.RIVALMODE_REPO) return env.RIVALMODE_REPO;
  if (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY.includes('/')) return env.GITHUB_REPOSITORY;
  return '';
}

export function parseRepoSlug(slug) {
  const clean = String(slug || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
  const [owner, name] = clean.split('/');
  if (!owner || !name) throw new Error(`RivalMode: "${slug}" is not an owner/repo slug`);
  return { owner, name, slug: `${owner}/${name}` };
}
