/**
 * Turn GitHub APIs into one flat snapshot. Every block is fetched
 * independently and wrapped in `safe()`: a 403 on the search API degrades to a
 * footnote in the README instead of an empty scoreboard.
 */
import { describeError } from './github.mjs';
import { DAY, dayKey, dayKeysBetween, startOfDay, startOfWeek } from './dates.mjs';

const MAX_COMMIT_PAGES = 4;

export function createLog(quiet = false) {
  const warnings = [];
  return {
    warnings,
    warn: (msg) => {
      if (!warnings.includes(msg)) warnings.push(msg);
      if (!quiet) console.warn(`[rivalmode] ${msg}`);
    },
    info: (msg) => {
      if (!quiet) console.log(`[rivalmode] ${msg}`);
    },
  };
}

/** Run `fn`, returning `fallback` and recording a warning if it throws. */
export async function safe(log, label, fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    log.warn(`${label}: ${describeError(err)}`);
    return fallback;
  }
}

/**
 * @param {import('./github.mjs').GithubClient} client
 * @param {{owner:string,name:string,slug:string}} slug
 * @param {object} config
 */
export async function collectSnapshot(client, slug, config, { log = createLog(), now = Date.now() } = {}) {
  const base = `/repos/${slug.owner}/${slug.name}`;
  const today = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
  const historyStart = new Date(today.getTime() - 59 * DAY);

  const repo = await safe(log, 'repository details', () => client.get(base), null);
  if (!repo) {
    throw new Error(
      `RivalMode could not read ${slug.slug}. If the repo is private, add \`"private": true\` to .rivalmode/config.json; otherwise check that the workflow can read the repository.`
    );
  }

  const degraded = Boolean(repo.private || config.private);

  const [branches, openPulls, mergedRecent, commits, contributors, stars, forks, releases, events, closedIssues] =
    await Promise.all([
      safe(log, 'branches', () => client.paginate(`${base}/branches`, { maxPages: 1, perPage: 100 }), []),
      safe(log, 'open pull requests', () => searchCount(client, `repo:${slug.slug} is:pr is:open`), 0),
      safe(
        log,
        'merged pull requests',
        () => searchItems(client, `repo:${slug.slug} is:pr is:merged merged:>=${dayKey(now - 30 * DAY)}`, 100),
        []
      ),
      safe(log, 'commit history', () => fetchCommits(client, base, historyStart), { commits: [], truncated: false }),
      safe(log, 'contributors', () => client.paginate(`${base}/contributors`, { maxPages: 1, perPage: 100, query: { anon: '0' } }), []),
      safe(log, 'stargazers', () => fetchStargazers(client, base), { total: repo.stargazers_count ?? 0, recent: [], all: [], truncated: true }),
      safe(log, 'forks', () => client.paginate(`${base}/forks`, { maxPages: 1, perPage: 100, query: { sort: 'newest' } }), []),
      safe(log, 'releases', () => client.paginate(`${base}/releases`, { maxPages: 1, perPage: 20 }), []),
      safe(log, 'events', () => client.paginate(`${base}/events`, { maxPages: 1, perPage: 100 }), []),
      safe(
        log,
        'closed issues',
        () => searchItems(client, `repo:${slug.slug} is:issue is:closed closed:>=${dayKey(now - 30 * DAY)}`, 100),
        []
      ),
    ]);

  const commitStats = summariseCommits(commits.commits, { now, today, weekStart, monthStart, historyStart, truncated: commits.truncated });
  const mergeStats = summariseMerges(mergedRecent, { now, today, weekStart });
  const starStats = summariseStars(stars, repo, now);
  const leaderboard = buildLeaderboard(contributors, commitStats.monthByAuthor);
  const feed = buildFeed(events, repo, now, config.feed);
  const issueStats = summariseIssues(closedIssues, now);

  return {
    schema: 1,
    generatedAt: new Date(now).toISOString(),
    repo: normalizeRepo(repo, slug),
    degraded,
    private: Boolean(repo.private),
    counts: {
      branches: branches.length,
      openPRs: openPulls,
      openIssues: Math.max(0, (repo.open_issues_count ?? 0) - openPulls),
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      watchers: repo.subscribers_count ?? 0,
      contributors: contributors.length,
    },
    commits: commitStats,
    merges: mergeStats,
    stars: starStats,
    issues: issueStats,
    releases: releases.map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      at: r.published_at || r.created_at,
      url: r.html_url,
      prerelease: Boolean(r.prerelease),
    })),
    leaderboard,
    activity: commitStats.byDay,
    feed,
    warnings: [],
  };
}

/* ------------------------------------------------------------- paginated --- */

async function fetchCommits(client, base, since) {
  const out = [];
  let truncated = false;
  for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
    const batch = await client.paginate(`${base}/commits`, {
      query: { since: new Date(since).toISOString(), sha: undefined },
      maxPages: 1,
      perPage: 100,
      ttl: 60 * 1000,
    });
    out.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_COMMIT_PAGES) truncated = true;
    // paginate() already gives us one page per call; walk by date instead of
    // trusting page numbers, because new commits shift the window.
    const oldest = batch[batch.length - 1]?.commit?.author?.date;
    if (!oldest) break;
    const nextSince = new Date(oldest);
    if (nextSince.getTime() <= new Date(since).getTime()) break;
    since = new Date(nextSince.getTime() - 1000);
    if (page === MAX_COMMIT_PAGES - 1) truncated = true;
  }
  return { commits: dedupeCommits(out), truncated };
}

async function fetchStargazers(client, base) {
  // `star+json` adds starred_at, which is the only way to get star velocity
  // without scraping the webpage.
  const { body, response } = await client.request(`${base}/stargazers`, {
    query: { per_page: 100, page: 1 },
    accept: 'application/vnd.github.star+json',
  });
  const list = Array.isArray(body) ? body : [];
  const link = response.headers?.get?.('link') || '';
  const lastPage = Number((link.match(/[?&]page=(\d+)>; rel="last"/) || [])[1]) || 1;
  return {
    total: lastPage > 1 ? null : list.length,
    recent: list.slice(0, 100).map((s) => ({
      login: s.user?.login,
      at: s.starred_at || null,
    })),
    all: list.map((s) => s.user?.login).filter(Boolean),
    truncated: lastPage > 1,
  };
}

async function searchCount(client, q) {
  const data = await client.get('/search/issues', { query: { q, per_page: 1 }, ttl: 5 * 60 * 1000 });
  return data?.total_count ?? 0;
}

async function searchItems(client, q, cap = 100) {
  const data = await client.get('/search/issues', {
    query: { q, per_page: Math.min(100, cap), sort: 'updated', order: 'desc' },
    ttl: 5 * 60 * 1000,
  });
  return Array.isArray(data?.items) ? data.items : [];
}

/* ------------------------------------------------------------ summaries --- */

function normalizeRepo(repo, slug) {
  return {
    owner: slug.owner,
    name: slug.name,
    slug: slug.slug,
    url: repo.html_url || `https://github.com/${slug.slug}`,
    description: repo.description || '',
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    language: repo.language || null,
    license: repo.license?.spdx_id || repo.license?.key || null,
    defaultBranch: repo.default_branch || 'main',
    createdAt: repo.created_at || null,
    pushedAt: repo.pushed_at || null,
    homepage: repo.homepage || '',
    archived: Boolean(repo.archived),
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
  };
}

function dedupeCommits(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = c.sha || `${c.commit?.author?.date}:${c.commit?.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function summariseCommits(commits, { now, today, weekStart, monthStart, historyStart, truncated }) {
  const todayKey = dayKey(today);
  const weekKey = dayKey(weekStart);
  const monthKey = dayKey(monthStart);
  const byDay = Object.fromEntries(dayKeysBetween(historyStart, new Date(now)).map((k) => [k, 0]));
  const byAuthor = new Map();
  const monthByAuthor = new Map();
  let todayCount = 0;
  let weekCount = 0;
  let monthCount = 0;
  let latest = null;
  const authors = new Map();

  for (const c of commits) {
    const at = c.commit?.author?.date || c.commit?.committer?.date;
    if (!at) continue;
    const key = dayKey(at);
    const login = c.author?.login || null;
    const name = login || c.commit?.author?.name || 'ghost';
    if (key in byDay) byDay[key] += 1;
    if (key === todayKey) todayCount += 1;
    if (key >= weekKey) weekCount += 1;
    if (key >= monthKey) {
      monthCount += 1;
      monthByAuthor.set(name, (monthByAuthor.get(name) || 0) + 1);
    }
    byAuthor.set(name, (byAuthor.get(name) || 0) + 1);
    if (!latest || new Date(at) > new Date(latest.at)) latest = { at, name, message: firstLine(c.commit?.message) };
    const meta = authors.get(name) || { login, name, avatar: c.author?.avatar_url || null, commits: 0 };
    meta.commits += 1;
    authors.set(name, meta);
  }

  const streak = commitStreak(byDay, todayKey);
  const days = Object.keys(byDay);
  const last7 = days.slice(-7).reduce((sum, k) => sum + byDay[k], 0);
  const prev7 = days.slice(-14, -7).reduce((sum, k) => sum + byDay[k], 0);

  return {
    today: todayCount,
    week: weekCount,
    month: monthCount,
    last7,
    prev7,
    byDay,
    streak,
    latest,
    truncated,
    authors: [...authors.values()].sort((a, b) => b.commits - a.commits),
    monthByAuthor: Object.fromEntries(monthByAuthor),
    activeDays: days.filter((k) => byDay[k] > 0).slice(-30),
  };
}

/** Consecutive days with ≥1 commit, counting back from today (or yesterday). */
export function commitStreak(byDay, todayKey) {
  const days = Object.keys(byDay).sort();
  let streak = 0;
  let cursor = todayKey;
  if (!byDay[todayKey] && days.length && byDay[days[days.length - 1]] === 0) {
    // Allow the streak to survive a day in progress with no commits yet.
    cursor = days.filter((k) => k < todayKey).pop() || todayKey;
  }
  while (cursor in byDay) {
    const count = byDay[cursor] || 0;
    if (count === 0) {
      const isToday = cursor === todayKey;
      if (isToday && streak === 0) {
        cursor = shiftKey(cursor, -1);
        continue;
      }
      break;
    }
    streak += 1;
    cursor = shiftKey(cursor, -1);
  }
  return streak;
}

function shiftKey(key, delta) {
  const d = new Date(`${key}T00:00:00Z`);
  return new Date(d.getTime() + delta * DAY).toISOString().slice(0, 10);
}

function summariseMerges(prs, { now, today, weekStart }) {
  const todayKey = dayKey(today);
  const weekKey = dayKey(weekStart);
  const byDay = {};
  let todayCount = 0;
  let weekCount = 0;
  const recent = [];
  for (const pr of prs) {
    // The search API can return issues when a query is loose; a merge needs a PR.
    if (!pr.pull_request) continue;
    const at = pr.pull_request?.merged_at || pr.closed_at;
    if (!at) continue;
    const key = dayKey(at);
    byDay[key] = (byDay[key] || 0) + 1;
    if (key === todayKey) todayCount += 1;
    if (key >= weekKey) weekCount += 1;
    recent.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login || 'ghost',
      at,
      labels: (pr.labels || []).map((l) => l.name),
    });
  }
  recent.sort((a, b) => new Date(b.at) - new Date(a.at));
  const spanDays = Math.max(1, Math.min(30, Math.ceil((now - new Date(dayKey(now - 30 * DAY))) / DAY)));
  const total = prs.filter((pr) => pr.pull_request).length;
  return {
    last30: total,
    today: todayCount,
    week: weekCount,
    perDay: Math.round((total / spanDays) * 10) / 10,
    byDay,
    recent: recent.slice(0, 20),
  };
}

function summariseStars(stars, repo, now) {
  const recentCutoff = now - 30 * DAY;
  const recent = (stars.recent || []).filter((s) => s.at && new Date(s.at).getTime() >= recentCutoff);
  const firstSeen = stars.recent?.[stars.recent.length - 1]?.at || null;
  // Page 1 is newest-first. If the page is full and the oldest entry is still
  // inside the window, the true 30-day count is at least 100.
  const velocity30 = stars.truncated && recent.length === stars.recent.length && firstSeen && new Date(firstSeen).getTime() >= recentCutoff
    ? recent.length * 3
    : recent.length;
  const total = repo.stargazers_count ?? 0;
  const ageDays = repo.created_at ? Math.max(1, (now - new Date(repo.created_at).getTime()) / DAY) : 1;
  return {
    total,
    last30: velocity30,
    perDay: Math.round((velocity30 / 30) * 100) / 100,
    lifetimePerDay: Math.round((total / ageDays) * 100) / 100,
    recent: stars.recent || [],
    truncated: Boolean(stars.truncated),
  };
}

function summariseIssues(issues, now) {
  const closed = issues.filter((i) => !i.pull_request);
  const weekAgo = now - 7 * DAY;
  return {
    last30: closed.length,
    last7: closed.filter((i) => new Date(i.closed_at) >= weekAgo).length,
    recent: closed.slice(0, 10).map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      at: i.closed_at,
      author: i.user?.login || 'ghost',
    })),
  };
}

function buildLeaderboard(contributors, monthByAuthor) {
  return contributors
    .filter((c) => c?.login || c?.name)
    .map((c, index) => ({
      login: c.login || c.name,
      avatar: c.avatar_url || null,
      contributions: c.contributions ?? 0,
      monthCommits: monthByAuthor[c.login] || 0,
      rank: index + 1,
      url: c.html_url || `https://github.com/${c.login}`,
    }));
}

const EVENT_LABELS = {
  PushEvent: { icon: '↑', verb: 'pushed' },
  WatchEvent: { icon: '★', verb: 'starred' },
  ForkEvent: { icon: '⑂', verb: 'forked' },
  ReleaseEvent: { icon: '◆', verb: 'released' },
  PullRequestEvent: { icon: '⇄', verb: 'pull request' },
  IssuesEvent: { icon: '●', verb: 'issue' },
  CreateEvent: { icon: '+', verb: 'created' },
  PublicEvent: { icon: '◉', verb: 'open sourced' },
  MemberEvent: { icon: '◈', verb: 'added member' },
};

function buildFeed(events, repo, now, feedConfig) {
  const allowed = new Set(feedConfig?.includeTypes || Object.keys(EVENT_LABELS));
  const items = [];
  for (const e of events) {
    if (!allowed.has(e.type)) continue;
    const item = describeEvent(e, repo);
    if (!item) continue;
    items.push(item);
    if (items.length >= 200) break;
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return items.slice(0, Math.max(5, feedConfig?.limit || 10));
}

function describeEvent(e, repo) {
  const actor = e.actor?.login || 'someone';
  const meta = EVENT_LABELS[e.type];
  if (!meta) return null;
  switch (e.type) {
    case 'PushEvent': {
      const commits = e.payload?.commits || [];
      const n = e.payload?.size ?? commits.length;
      if (!n) return null;
      const head = commits[commits.length - 1];
      return {
        type: e.type,
        icon: meta.icon,
        actor,
        avatar: e.actor?.avatar_url || null,
        at: e.created_at,
        text: `${actor} pushed ${n} commit${n === 1 ? '' : 's'}`,
        detail: firstLine(head?.message) || '',
        url: `https://github.com/${repo.slug}/commit/${head?.sha || e.payload?.head}`,
      };
    }
    case 'WatchEvent':
      return { type: e.type, icon: meta.icon, actor, avatar: e.actor?.avatar_url || null, at: e.created_at, text: `${actor} starred the repo`, detail: '', url: `https://github.com/${actor}` };
    case 'ForkEvent':
      return {
        type: e.type,
        icon: meta.icon,
        actor,
        avatar: e.actor?.avatar_url || null,
        at: e.created_at,
        text: `${actor} forked the repo`,
        detail: e.payload?.forkee?.full_name || '',
        url: e.payload?.forkee?.html_url || `https://github.com/${actor}`,
      };
    case 'ReleaseEvent':
      return {
        type: e.type,
        icon: meta.icon,
        actor,
        avatar: e.actor?.avatar_url || null,
        at: e.created_at,
        text: `${actor} shipped ${e.payload?.release?.tag_name || 'a release'}`,
        detail: firstLine(e.payload?.release?.name) || '',
        url: e.payload?.release?.html_url || '',
      };
    case 'PullRequestEvent': {
      const pr = e.payload?.pull_request;
      if (!pr) return null;
      const merged = Boolean(pr.merged);
      return {
        type: e.type,
        icon: meta.icon,
        actor,
        avatar: e.actor?.avatar_url || null,
        at: e.created_at,
        text: `PR #${pr.number} ${merged ? 'merged' : e.payload?.action || 'updated'}`,
        detail: firstLine(pr.title) || '',
        url: pr.html_url,
      };
    }
    case 'IssuesEvent': {
      const issue = e.payload?.issue;
      if (!issue) return null;
      return {
        type: e.type,
        icon: meta.icon,
        actor,
        avatar: e.actor?.avatar_url || null,
        at: e.created_at,
        text: `issue #${issue.number} ${e.payload?.action || 'updated'}`,
        detail: firstLine(issue.title) || '',
        url: issue.html_url,
      };
    }
    case 'CreateEvent': {
      const ref = e.payload?.ref;
      const kind = e.payload?.ref_type;
      if (!kind) return null;
      return {
        type: e.type,
        icon: meta.icon,
        actor,
        avatar: e.actor?.avatar_url || null,
        at: e.created_at,
        text: `${actor} created ${kind}${ref ? ` ${ref}` : ''}`,
        detail: '',
        url: `https://github.com/${repo.slug}`,
      };
    }
    default:
      return {
        type: e.type,
        icon: meta.icon,
        actor,
        avatar: e.actor?.avatar_url || null,
        at: e.created_at,
        text: `${actor} ${meta.verb}`,
        detail: '',
        url: `https://github.com/${repo.slug}`,
      };
  }
}

export function firstLine(message, max = 72) {
  const line = String(message || '').split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
