/**
 * Recorded-shape API fixtures. Hand-trimmed from real responses so the shapes
 * are honest, but small enough to keep in the repo.
 */
import { DAY, dayKey } from '../../src/lib/dates.mjs';

export const NOW = Date.UTC(2026, 10, 16, 12, 0, 0); // 2026-11-16T12:00:00Z

const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

export const repo = {
  name: 'rivalmode',
  full_name: 'pooria683/rivalmode',
  owner: { login: 'pooria683' },
  html_url: 'https://github.com/pooria683/rivalmode',
  description: 'Gamify your repo',
  topics: ['github-actions', 'readme', 'scoreboard'],
  language: 'JavaScript',
  license: { spdx_id: 'MIT' },
  default_branch: 'main',
  created_at: iso(40 * DAY),
  pushed_at: iso(2 * 3600 * 1000),
  stargazers_count: 184,
  forks_count: 12,
  subscribers_count: 9,
  open_issues_count: 10,
  private: false,
};

export function commits({ today = 5, yesterday = 3, lastWeek = 4, older = 6 } = {}) {
  const out = [];
  const make = (login, at, message) => ({
    sha: `${login}-${at}`,
    author: { login, avatar_url: `https://avatars.example/${login}` },
    commit: { author: { date: at, name: login }, message },
  });
  for (let i = 0; i < today; i += 1) out.push(make('pooria683', iso(i * 60000 + 1000), `today commit ${i}`));
  for (let i = 0; i < yesterday; i += 1) out.push(make('mialee', iso(DAY + i * 60000), `yesterday ${i}`));
  for (let i = 0; i < lastWeek; i += 1) out.push(make('dev-bat', iso(9 * DAY + i * 60000), `last week ${i}`));
  for (let i = 0; i < older; i += 1) out.push(make('kwan', iso(20 * DAY + i * 60000), `older ${i}`));
  return out;
}

export const contributors = [
  { login: 'pooria683', contributions: 120, avatar_url: null, html_url: 'https://github.com/pooria683' },
  { login: 'mialee', contributions: 88, avatar_url: null, html_url: 'https://github.com/mialee' },
  { login: 'dev-bat', contributions: 41, avatar_url: null, html_url: 'https://github.com/dev-bat' },
];

export const stargazers = [
  { starred_at: iso(2 * DAY), user: { login: 'newfan' } },
  { starred_at: iso(5 * DAY), user: { login: 'dev-bat' } },
  { starred_at: iso(40 * DAY), user: { login: 'oldfan' } },
];

export const forks = [
  {
    full_name: 'julesortiz/rivalmode',
    name: 'rivalmode',
    owner: { login: 'julesortiz' },
    html_url: 'https://github.com/julesortiz/rivalmode',
    stargazers_count: 6,
    forks_count: 0,
    default_branch: 'main',
    pushed_at: iso(3600 * 1000),
    created_at: iso(10 * DAY),
    description: 'my fork',
    topics: [],
    language: 'JavaScript',
  },
];

export const events = [
  {
    type: 'PushEvent',
    actor: { login: 'pooria683', avatar_url: null },
    created_at: iso(4 * 60000),
    payload: { size: 3, head: 'abc123', commits: [{ sha: 'abc123', message: 'feat: momentum\n\nbody' }] },
  },
  {
    type: 'WatchEvent',
    actor: { login: 'newfan', avatar_url: null },
    created_at: iso(40 * 60000),
    payload: {},
  },
  {
    type: 'ReleaseEvent',
    actor: { login: 'pooria683', avatar_url: null },
    created_at: iso(3 * 3600 * 1000),
    payload: { release: { tag_name: 'v1.0.0', name: 'RivalMode v1.0.0', html_url: 'https://github.com/x/y/releases/v1.0.0' } },
  },
  {
    type: 'ForkEvent',
    actor: { login: 'julesortiz', avatar_url: null },
    created_at: iso(6 * 3600 * 1000),
    payload: { forkee: { full_name: 'julesortiz/rivalmode', html_url: 'https://github.com/julesortiz/rivalmode' } },
  },
];

export const mergedPrs = [
  {
    number: 58,
    title: 'rivals: skip repos younger than a week',
    html_url: 'https://github.com/pooria683/rivalmode/pull/58',
    user: { login: 'mialee' },
    closed_at: iso(2 * 3600 * 1000),
    pull_request: { merged_at: iso(2 * 3600 * 1000) },
    labels: [],
  },
  {
    number: 57,
    title: 'themes: synthwave',
    html_url: 'https://github.com/pooria683/rivalmode/pull/57',
    user: { login: 'julesortiz' },
    closed_at: iso(5 * DAY),
    pull_request: { merged_at: iso(5 * DAY) },
    labels: [],
  },
];

export const closedIssues = [
  {
    number: 61,
    title: 'Feed shows stale events on forks',
    html_url: 'https://github.com/pooria683/rivalmode/issues/61',
    user: { login: 'nyx' },
    closed_at: iso(6 * 3600 * 1000),
    pull_request: undefined,
  },
];

export const releases = [
  { tag_name: 'v1.0.0', name: 'RivalMode v1.0.0', published_at: iso(3 * 3600 * 1000), html_url: 'https://x/1', prerelease: false },
  { tag_name: 'v0.9.0', name: 'v0.9.0', published_at: iso(9 * DAY), html_url: 'https://x/2', prerelease: false },
];

export const branches = [{ name: 'main' }, { name: 'feat/themes' }, { name: 'fix/feed' }];

/** Search results for the topic cluster. */
export const searchRepos = {
  total_count: 3,
  items: [
    {
      full_name: 'acme/scoreboard-kit',
      html_url: 'https://github.com/acme/scoreboard-kit',
      description: 'scoreboard kit',
      stargazers_count: 412,
      forks_count: 30,
      topics: ['github-actions'],
      language: 'JavaScript',
      created_at: iso(200 * DAY),
      pushed_at: iso(3600 * 1000),
      fork: false,
    },
    {
      full_name: 'tinyfish/readme-runner',
      html_url: 'https://github.com/tinyfish/readme-runner',
      description: 'readme runner',
      stargazers_count: 331,
      forks_count: 12,
      topics: ['github-actions'],
      language: 'TypeScript',
      created_at: iso(150 * DAY),
      pushed_at: iso(2 * 3600 * 1000),
      fork: false,
    },
    {
      full_name: 'too-new/just-born',
      html_url: 'https://github.com/too-new/just-born',
      stargazers_count: 900,
      forks_count: 0,
      topics: ['github-actions'],
      created_at: iso(2 * DAY),
      pushed_at: iso(3600 * 1000),
      fork: false,
    },
  ],
};

export const compareAhead = { ahead_by: 14, behind_by: 3, commits: [{ commit: { author: { date: iso(3600 * 1000) } } }] };

/** Build a fake client that answers from these fixtures, with pluggable failures. */
export function fakeClient(overrides = {}) {
  const routes = {
    '/repos/pooria683/rivalmode': repo,
    '/repos/pooria683/rivalmode/branches': branches,
    '/repos/pooria683/rivalmode/contributors': contributors,
    '/repos/pooria683/rivalmode/forks': forks,
    '/repos/pooria683/rivalmode/releases': releases,
    '/repos/pooria683/rivalmode/events': events,
    '/repos/pooria683/rivalmode/stargazers': stargazers,
    '/search/repositories': searchRepos,
    '/repos/acme/scoreboard-kit/stargazers': [{ starred_at: iso(DAY), user: { login: 'a' } }],
    '/repos/tinyfish/readme-runner/stargazers': [{ starred_at: iso(2 * DAY), user: { login: 'b' } }],
    '/users/newfan': { login: 'newfan', public_repos: 4, followers: 12, html_url: 'https://github.com/newfan' },
    '/users/dev-bat': { login: 'dev-bat', public_repos: 9, followers: 40, html_url: 'https://github.com/dev-bat' },
    ...overrides.routes,
  };

  const calls = [];
  const client = {
    warnings: new Set(),
    calls,
    saveCache() {},
    stats() {
      return { calls: calls.length, cacheHits: 0, remaining: 4000, resetAt: null };
    },
    warn(msg) {
      this.warnings.add(msg);
    },
    buildUrl(p) {
      return p;
    },
    async get(pathname, opts = {}) {
      calls.push(pathname);
      const failing = overrides.fail || (() => false);
      if (failing(pathname)) {
        const { GithubError } = await import('../../src/lib/github.mjs');
        throw new GithubError(`403 for ${pathname}`, { status: 403, url: pathname });
      }
      if (pathname.startsWith('/search/issues')) {
        return overrides.searchIssues?.(pathname) ?? { total_count: 3, items: mergedPrs.concat(closedIssues) };
      }
      if (pathname.includes('/compare/')) return compareAhead;
      const key = matchRoute(routes, pathname);
      const value = key ? routes[key] : null;
      if (value === null && opts.allow404 === false) {
        const { GithubError } = await import('../../src/lib/github.mjs');
        throw new GithubError(`404 for ${pathname}`, { status: 404, url: pathname });
      }
      return value;
    },
    async paginate(pathname) {
      calls.push(pathname);
      const failing = overrides.fail || (() => false);
      if (failing(pathname)) {
        const { GithubError } = await import('../../src/lib/github.mjs');
        throw new GithubError(`403 for ${pathname}`, { status: 403, url: pathname });
      }
      if (pathname.endsWith('/commits')) return overrides.commits ?? commits();
      if (pathname.endsWith('/stargazers')) return stargazers;
      const key = matchRoute(routes, pathname);
      const value = key ? routes[key] : [];
      return Array.isArray(value) ? value : [];
    },
    async request(pathname) {
      const body = await this.get(pathname);
      return { body, response: { status: 200, headers: new Headers() } };
    },
  };
  return client;
}

/** Longest-prefix match, so /repos/o/r/branches beats /repos/o/r. */
function matchRoute(routes, pathname) {
  return Object.keys(routes)
    .sort((a, b) => b.length - a.length)
    .find((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export { dayKey };
