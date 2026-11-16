/**
 * Deterministic sample data for `--mock`, golden-SVG tests and the demo GIF.
 * Seeded so two runs of the same day produce byte-identical fixtures.
 */
import { DAY, dayKey, dayKeysBetween, startOfDay } from './dates.mjs';
import { seededRandom } from '../svg/primitives.mjs';
import { computeMomentum, rankCluster } from './score.mjs';

const NAMES = [
  'pooria683',
  'mialee',
  'dev-bat',
  'julesortiz',
  'kwan',
  'nyx',
  'tobi',
  'sam-r',
  'vera_code',
  '0xstill',
  'harold',
  'qiqi',
];

const COMMIT_MESSAGES = [
  'feat(svg): momentum gauge with a streak bonus',
  'fix: don’t crash when the search API rate-limits',
  'docs: how the point table works',
  'feat(rivals): detect forks that out-commit upstream',
  'test: golden snapshot for the scoreboard',
  'chore: cache ETags between runs',
  'perf: single pass over the 60-day window',
  'feat: roast line when a rival overtakes you',
  'fix(badges): centre the licence shield',
  'feat: weekly recap issue comment',
];

/**
 * @param {{now?:number, seed?:string, intensity?:number}} options
 */
export function makeSnapshot({ now = Date.now(), seed = 'rivalmode', intensity = 1, repoSlug = 'pooria683/rivalmode' } = {}) {
  const random = seededRandom(seed);
  const [owner, name] = repoSlug.split('/');
  const today = startOfDay(now);
  const days = dayKeysBetween(new Date(today.getTime() - 59 * DAY), new Date(now));

  const activity = {};
  days.forEach((key, i) => {
    const recency = 0.55 + 0.75 * (i / days.length);
    const base = random() * 8 * recency * intensity;
    const weekend = [0, 6].includes(new Date(`${key}T00:00:00Z`).getUTCDay()) ? 0.35 : 1;
    const roll = random();
    activity[key] = roll < 0.08 * (1 / Math.max(0.4, intensity)) ? 0 : Math.round(base * weekend);
  });
  // Make sure today looks alive and the streak is real.
  activity[dayKey(now)] = Math.max(3, activity[dayKey(now)] || 0);
  const last7 = days.slice(-7).reduce((s, k) => s + activity[k], 0);
  const prev7 = days.slice(-14, -7).reduce((s, k) => s + activity[k], 0);
  const monthKey = new Date(today).toISOString().slice(0, 7);
  const monthDays = days.filter((k) => k.startsWith(monthKey));

  const authors = NAMES.slice(0, 6).map((login, i) => ({
    login,
    avatar: null,
    name: login,
    contributions: 120 - i * 17,
  }));
  const monthByAuthor = {};
  authors.forEach((a, i) => {
    monthByAuthor[a.login] = Math.round(monthDays.reduce((s, k) => s + activity[k], 0) * (0.34 - i * 0.05));
  });

  const leaderboard = authors
    .map((a, i) => ({
      login: a.login,
      avatar: null,
      contributions: a.contributions,
      monthCommits: monthByAuthor[a.login],
      rank: i + 1,
      url: `https://github.com/${a.login}`,
    }))
    .sort((a, b) => b.contributions - a.contributions);

  const feedSeed = [
    { type: 'PushEvent', text: 'pooria683 pushed 3 commits', detail: COMMIT_MESSAGES[0] },
    { type: 'WatchEvent', text: 'dev-bat starred the repo', detail: '' },
    { type: 'PullRequestEvent', text: 'PR #58 merged', detail: 'rivals: skip repos younger than a week' },
    { type: 'ForkEvent', text: 'julesortiz forked the repo', detail: 'julesortiz/rivalmode' },
    { type: 'ReleaseEvent', text: 'pooria683 shipped v1.0.0', detail: 'RivalMode v1.0.0' },
    { type: 'IssuesEvent', text: 'issue #61 closed', detail: 'Feed shows stale events on forks' },
    { type: 'PushEvent', text: 'mialee pushed 1 commit', detail: COMMIT_MESSAGES[1] },
    { type: 'WatchEvent', text: 'nyx starred the repo', detail: '' },
    { type: 'CreateEvent', text: 'kwan created branch feat/themes', detail: '' },
    { type: 'PushEvent', text: 'tobi pushed 2 commits', detail: COMMIT_MESSAGES[3] },
  ];
  const feed = feedSeed.map((item, i) => ({
    ...item,
    actor: (item.text.match(/^([\w.-]+)/) || [, 'rivalmode'])[1],
    avatar: null,
    at: new Date(now - (i * 37 + 4) * 60 * 1000).toISOString(),
    url: `https://github.com/${repoSlug}`,
    icon: '·',
  }));

  const recentStars = Array.from({ length: 26 }, (_, i) => ({
    login: NAMES[i % NAMES.length],
    at: new Date(now - (i * 19 + 2) * 3600 * 1000).toISOString(),
  }));

  const snapshot = {
    schema: 1,
    generatedAt: new Date(now).toISOString(),
    repo: {
      owner,
      name,
      slug: repoSlug,
      url: `https://github.com/${repoSlug}`,
      description: 'Gamify your repo: a live scoreboard, rival tracking and a weekly roast, straight from Actions.',
      topics: ['github-actions', 'readme', 'scoreboard', 'gamification'],
      language: 'JavaScript',
      license: 'MIT',
      defaultBranch: 'main',
      createdAt: new Date(now - 41 * DAY).toISOString(),
      stars: 184,
      forks: 12,
    },
    degraded: false,
    private: false,
    counts: { branches: 6, openPRs: 3, openIssues: 7, stars: 184, forks: 12, watchers: 9, contributors: 6 },
    commits: {
      today: activity[dayKey(now)],
      week: last7,
      month: monthDays.reduce((s, k) => s + activity[k], 0),
      last7,
      prev7,
      byDay: activity,
      streak: 6,
      truncated: false,
      latest: {
        at: new Date(now - 42 * 60 * 1000).toISOString(),
        name: 'pooria683',
        message: COMMIT_MESSAGES[0],
      },
      authors,
      monthByAuthor,
      activeDays: days.filter((k) => activity[k] > 0).slice(-30),
    },
    merges: {
      last30: 41,
      today: 2,
      week: 11,
      perDay: 1.4,
      byDay: {},
      recent: [
        { number: 58, title: 'rivals: skip repos younger than a week', url: '#', author: 'mialee', at: new Date(now - 3 * 3600e3).toISOString(), labels: [] },
        { number: 57, title: 'themes: add synthwave', url: '#', author: 'julesortiz', at: new Date(now - 26 * 3600e3).toISOString(), labels: [] },
      ],
    },
    stars: {
      total: 184,
      last30: 26,
      perDay: 0.87,
      lifetimePerDay: 4.5,
      recent: recentStars,
      truncated: false,
    },
    issues: {
      last30: 9,
      last7: 3,
      recent: [
        { number: 61, title: 'Feed shows stale events on forks', url: '#', at: new Date(now - 6 * 3600e3).toISOString(), author: 'nyx' },
      ],
    },
    releases: [
      { tag: 'v1.0.0', name: 'RivalMode v1.0.0', at: new Date(now - 20 * 3600e3).toISOString(), url: '#', prerelease: false },
      { tag: 'v0.9.0', name: 'RivalMode v0.9.0', at: new Date(now - 9 * DAY).toISOString(), url: '#', prerelease: false },
    ],
    leaderboard,
    activity,
    feed,
    warnings: [],
  };

  const rivals = makeRivals({ now, seed, self: snapshot });
  return { snapshot, rivals };
}

export function makeRivals({ now = Date.now(), seed = 'rivalmode', self }) {
  const random = seededRandom(`${seed}-rivals`);
  const names = [
    ['acme', 'scoreboard-kit', 412, 2.1, 1],
    ['tinyfish', 'readme-runner', 331, 1.6, 2],
    ['nova-labs', 'repo-hype', 289, 1.2, 3],
    ['grainstack', 'devboard', 240, 0.95, 4],
    ['hexbyte', 'trophywall', 190, 0.76, 5],
    ['quietpixel', 'live-badges', 121, 0.4, 6],
    ['lowercase', 'commit-golf', 88, 0.22, 7],
  ];
  const rivals = names.map(([owner, name, stars, velocity, i]) => ({
    slug: `${owner}/${name}`,
    name,
    owner,
    url: `https://github.com/${owner}/${name}`,
    description: `${name} — a live badge toolkit`,
    stars,
    velocity: Math.round((velocity + random() * 0.1) * 100) / 100,
    forks: Math.round(stars / 9),
    commitsLast30: Math.round(30 * velocity + i * 3),
    topics: ['github-actions', 'readme'],
    language: 'JavaScript',
    kind: 'topic',
  }));

  const selfEntry = self
    ? {
        repo: self.repo,
        slug: self.repo.slug,
        stars: self.counts.stars,
        velocity: self.stars.perDay,
        commitsLast30: self.commits.month,
      }
    : null;

  const ranking = rankCluster({ self: selfEntry, rivals, limits: { maxLeaders: 5 } });
  return {
    schema: 1,
    generatedAt: new Date(now).toISOString(),
    topicCluster: ['github-actions', 'readme'],
    rivals,
    ranking,
    forks: [
      { slug: 'julesortiz/rivalmode', url: 'https://github.com/julesortiz/rivalmode', ahead: 14, behind: 3, stars: 6, kind: 'fork' },
      { slug: 'dev-bat/rivalmode', url: 'https://github.com/dev-bat/rivalmode', ahead: 6, behind: 1, stars: 2, kind: 'fork' },
      { slug: 'nyx/rivalmode', url: 'https://github.com/nyx/rivalmode', ahead: 0, behind: 0, stars: 0, kind: 'fork' },
    ],
    fans: [
      { login: 'dev-bat', stars: 210, url: 'https://github.com/dev-bat' },
      { login: 'nyx', stars: 44, url: 'https://github.com/nyx' },
    ],
    summary: { rivals: rivals.length, passed: 1, passedBy: 0, rank: ranking.rank, clusterSize: ranking.clusterSize },
    history: [{ at: new Date(now - DAY).toISOString(), rank: ranking.rank + 1, clusterSize: ranking.clusterSize }],
    warnings: [],
  };
}

export function makeMomentum(snapshot, rivals, points) {
  return computeMomentum(snapshot, points, rivals);
}
