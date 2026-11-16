/**
 * Rival discovery — the hook.
 *
 * Three sources, merged and ranked by star velocity:
 *   1. forks of your repo with more commits than upstream  (they're *working*)
 *   2. repos sharing your topics, via search               (your cluster)
 *   3. people who starred you and ship their own repos     (your fans)
 *
 * Everything here degrades: on a private repo, in a rate-limit storm, or on a
 * repo with no topics, you get fewer rivals — never an exception.
 */
import { createLog, safe } from './collect.mjs';
import { DAY, dayKey } from './dates.mjs';
import { diffRanking, rankCluster, starVelocity } from './score.mjs';

const MAX_TOPIC_CANDIDATES = 24;
const MAX_VELOCITY_LOOKUPS = 10;
const MAX_FORK_LOOKUPS = 8;
const MAX_FAN_LOOKUPS = 12;

/**
 * @param {import('./github.mjs').GithubClient} client
 * @param {object} snapshot  from collectSnapshot
 * @param {object} config
 * @param {{log?:object, now?:number, previous?:object}} options
 */
export async function discoverRivals(client, snapshot, config, { log = createLog(), now = Date.now(), previous = null } = {}) {
  const settings = config.rivals;
  const slug = snapshot.repo.slug;
  const self = {
    slug,
    repo: snapshot.repo,
    stars: snapshot.counts.stars,
    forks: snapshot.counts.forks,
    velocity: snapshot.stars?.perDay ?? 0,
    velocityEstimated: false,
    commitsLast30: snapshot.commits?.month ?? 0,
    followers: 0,
    kind: 'self',
    isSelf: true,
  };

  const result = {
    schema: 1,
    generatedAt: new Date(now).toISOString(),
    enabled: Boolean(settings.enabled) && !snapshot.degraded,
    degradedReason: snapshot.degraded ? 'private repo — rival search is disabled' : null,
    topicCluster: [],
    rivals: [],
    forks: [],
    fans: [],
    ranking: null,
    history: [],
    summary: {},
    warnings: [],
  };

  if (!result.enabled) {
    // Degraded mode still ranks tracked forks, because forks are part of the
    // repo's own data (permitted by the token) rather than a public search.
    result.forks = await collectForks(client, snapshot, log, now);
    result.ranking = rankCluster({ self, rivals: result.forks.filter((f) => f.slug !== slug), limits: settings });
    result.summary = {
      rivals: result.ranking.entries.length - 1,
      rank: result.ranking.rank,
      clusterSize: result.ranking.clusterSize,
      passed: 0,
      passedBy: 0,
      mode: 'degraded',
    };
    result.warnings = log.warnings;
    return result;
  }

  const topics = pickTopics(snapshot.repo.topics, settings.fallbackTopics, snapshot.repo);
  result.topicCluster = topics;

  const [topicCandidates, forks] = await Promise.all([
    searchTopicCluster(client, slug, topics, snapshot, settings, log, now),
    collectForks(client, snapshot, log, now),
  ]);

  result.forks = forks;

  // Pick the strongest candidates for the expensive velocity lookup.
  const shortlist = topicCandidates.slice(0, MAX_VELOCITY_LOOKUPS);
  const [withVelocity, fans] = await Promise.all([
    addVelocity(client, shortlist, log, now),
    collectFans(client, snapshot, log),
  ]);

  const candidates = dedupeBySlug([
    ...forks.filter((f) => f.slug !== slug).map((f) => ({ ...f, kind: f.kind || 'fork' })),
    ...withVelocity,
    ...topicCandidates.slice(MAX_VELOCITY_LOOKUPS),
  ]).filter((c) => c.slug !== slug && !c.isSelf);

  result.rivals = candidates;
  result.fans = fans;
  result.ranking = rankCluster({ self, rivals: candidates, limits: settings });

  const changes = diffRanking(result.ranking, previous?.ranking ?? previous ?? null);
  if (previous?.history) {
    result.history = [...previous.history, { at: result.generatedAt, rank: result.ranking.rank, clusterSize: result.ranking.clusterSize }].slice(-90);
  } else {
    result.history = [
      { at: result.generatedAt, rank: result.ranking.rank, clusterSize: result.ranking.clusterSize },
    ];
  }

  result.ranking.changes = changes;
  result.summary = {
    rivals: candidates.length,
    rank: result.ranking.rank,
    clusterSize: result.ranking.clusterSize,
    passed: changes.passed.length,
    passedBy: changes.passedBy.length,
    mode: result.ranking.rank ? 'ranked' : 'unranked',
  };
  result.warnings = log.warnings;
  return result;
}

/** Topics from the repo, then the configured fallbacks, then the language. */
export function pickTopics(repoTopics, fallbackTopics = [], repo = {}) {
  const clean = (list) =>
    (Array.isArray(list) ? list : [])
      .map((t) => String(t).trim().toLowerCase())
      .filter((t) => t && t.length < 40 && !/^(hacktoberfest|good-first-issue)$/.test(t));
  const primary = clean(repoTopics).slice(0, 3);
  if (primary.length) return primary;
  const fallback = clean(fallbackTopics).slice(0, 3);
  if (fallback.length) return fallback;
  if (repo.language) return [String(repo.language).toLowerCase()];
  return [];
}

/**
 * The star range that defines "your weight class" — roughly one order of
 * magnitude either side, with a floor so a brand-new repo still gets a ladder.
 */
export function starBand(selfStars, settings = {}) {
  const spread = Math.max(1, Number(settings.peerSpread) || 10);
  const stars = Math.max(0, Number(selfStars) || 0);
  // A zero-star repo still needs a ladder to climb, but "peers" with zero stars
  // too have no signal at all — start the band at one star.
  const lo = stars === 0 ? 1 : Math.max(1, Math.floor(stars / spread));
  const hi = Math.max(30, Math.ceil(stars * spread));
  return { lo, hi };
}

/**
 * Pick the peer group: repos closest to this one in size.
 *
 * Ranking is done on log scale because stars are log-distributed — the
 * difference between 2 and 20 stars matters as much as 2k to 20k. A brand-new
 * repo therefore competes with other small repos (a ladder it can actually
 * climb this month), and a 5k-star repo competes with its real weight class.
 */
export function peerBand(candidates, selfStars, settings = {}, { clusterSize = 12 } = {}) {
  if (!candidates.length) return [];
  const size = Math.max(3, Math.min(Number(settings.clusterSize) || clusterSize, candidates.length));
  const centre = Math.log2(Math.max(0, selfStars) + 2);
  const distance = (c) => Math.abs(Math.log2(Math.max(0, c.stars || 0) + 2) - centre);
  return [...candidates].sort((a, b) => distance(a) - distance(b) || b.stars - a.stars).slice(0, size);
}

async function searchTopicCluster(client, slug, topics, snapshot, settings, log, now) {
  if (!topics.length) {
    log.info?.('no topics found — rival search skipped (add topics to the repo to unlock the ladder)');
    return [];
  }
  if (client.exhausted?.('search')) {
    log.warn?.('search budget exhausted — reusing the last ladder');
    return [];
  }
  // Ask GitHub for peers directly. Without a star range the top hits for a
  // popular topic are Kubernetes and friends, which makes the ladder a joke;
  // with one, you get a dozen repos you can realistically beat this month.
  const band = starBand(snapshot.counts?.stars ?? 0, settings);
  const batches = await Promise.all(
    topics.map((topic) =>
      safe(
        log,
        `topic search "${topic}"`,
        () =>
          client.get('/search/repositories', {
            // Search has no random-access pagination: whatever the sort puts
            // in the first 30 is our entire candidate pool. So sort by most
            // recently pushed — these are repos that are actually alive — and
            // filter by size locally.
            query: {
              q: `topic:${topic} stars:${band.lo}..${band.hi} pushed:>=${dayKey(now - 45 * DAY)}`,
              sort: 'updated',
              order: 'desc',
              per_page: Math.max(settings.searchPerTopic, 20),
            },
            ttl: 30 * 60 * 1000,
          }),
        null
      )
    )
  );

  const seen = new Set([slug]);
  const out = [];
  for (const batch of batches) {
    for (const repo of batch?.items || []) {
      if (!repo?.full_name || seen.has(repo.full_name)) continue;
      if (!isRivalMaterial(repo, settings, now)) continue;
      seen.add(repo.full_name);
      out.push(toCandidate(repo));
    }
  }
  // Only compete with peers. Being ranked #4,000 in "github-actions" against
  // Kubernetes is true and useless; being ranked #4 of 12 repos your own size is
  // a game you can win this week.
  const pool = peerBand(out, snapshot.counts?.stars ?? 0, settings);
  // Best first: the strongest candidates get the expensive velocity lookup.
  pool.sort((a, b) => b.stars - a.stars || new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0));
  return pool.slice(0, MAX_TOPIC_CANDIDATES);
}

/**
 * Is this repo actually a rival, or just noise wearing the same topic?
 * Rules of thumb: forks are not rivals (they are family), brand-new repos have
 * no track record, archived repos are not competing, and a profile README with
 * the topic slapped on it has no commits to compare against.
 */
export function isRivalMaterial(repo, settings, now = Date.now()) {
  if (!repo?.full_name) return false;
  if (repo.fork) return false;
  if (repo.archived) return false;
  if (repo.disabled) return false;
  if ((repo.stargazers_count ?? 0) < Math.max(0, settings.minStars ?? 0)) return false;
  const ageDays = (now - new Date(repo.created_at || now).getTime()) / DAY;
  if (ageDays < (settings.minAgeDays ?? 7)) return false;
  // A repo with no real description and no forks is very often a profile README.
  const hasSubstance = Boolean((repo.description || '').trim()) || (repo.forks_count ?? 0) > 0 || (repo.size ?? 0) > 50;
  if (!hasSubstance) return false;
  // Profile READMEs are named after their owner: owner/owner.
  const [owner, name] = String(repo.full_name).split('/');
  if (owner && name && owner.toLowerCase() === name.toLowerCase()) return false;
  // Not touched in months = not a rival, it is a museum.
  const pushed = new Date(repo.pushed_at || repo.updated_at || 0).getTime();
  if (pushed && now - pushed > 120 * DAY) return false;
  return true;
}

function toCandidate(repo) {
  const [owner, name] = String(repo.full_name).split('/');
  const ageDays = Math.max(1, (Date.now() - new Date(repo.created_at || Date.now()).getTime()) / DAY);
  return {
    slug: repo.full_name,
    name,
    owner,
    url: repo.html_url || `https://github.com/${repo.full_name}`,
    description: repo.description || '',
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    velocity: Math.round(((repo.stargazers_count ?? 0) / ageDays) * 100) / 100,
    velocityEstimated: true,
    commitsLast30: null,
    topics: repo.topics || [],
    language: repo.language || null,
    pushedAt: repo.pushed_at || null,
    createdAt: repo.created_at || null,
    kind: 'topic',
  };
}

/** Replace estimated velocity with the real 30-day figure from stargazers. */
async function addVelocity(client, candidates, log, now) {
  const out = [];
  let budget = MAX_VELOCITY_LOOKUPS;
  for (const candidate of candidates) {
    if (budget <= 0 || client.exhausted?.('core')) {
      out.push(candidate);
      continue;
    }
    const stars = await safe(
      log,
      `star velocity ${candidate.slug}`,
      () => client.get(`/repos/${candidate.slug}/stargazers`, { query: { per_page: 100 }, accept: 'application/vnd.github.star+json', ttl: 60 * 60 * 1000 }),
      null
    );
    budget -= 1;
    if (Array.isArray(stars)) {
      const velocity = starVelocity(
        stars.map((s) => ({ login: s.user?.login, at: s.starred_at })),
        30
      );
      out.push({ ...candidate, velocity: velocity || 0, velocityEstimated: false, stars: undefined });
    } else {
      out.push(candidate);
    }
  }
  return out;
}

/** Forks that out-commit upstream. Uses the compare API when we can. */
async function collectForks(client, snapshot, log, now) {
  const slug = snapshot.repo.slug;
  const forks = await safe(
    log,
    'forks',
    () => client.paginate(`/repos/${slug}/forks`, { perPage: 100, maxPages: 1, query: { sort: 'newest' } }),
    []
  );
  const out = [];
  let budget = MAX_FORK_LOOKUPS;
  for (const fork of forks) {
    if (!fork?.full_name || !fork.owner?.login) continue;
    const base = {
      slug: fork.full_name,
      name: fork.name,
      owner: fork.owner.login,
      url: fork.html_url,
      description: fork.description || '',
      stars: fork.stargazers_count ?? 0,
      forks: fork.forks_count ?? 0,
      velocity: 0,
      commitsLast30: null,
      ahead: 0,
      behind: 0,
      kind: 'fork',
      pushedAt: fork.pushed_at || null,
      createdAt: fork.created_at || null,
      language: fork.language || null,
      topics: fork.topics || [],
    };
    if (budget <= 0 || client.exhausted?.('core')) {
      out.push(base);
      continue;
    }
    budget -= 1;
    const branch = fork.default_branch || 'main';
    const compare = await safe(
      log,
      `fork comparison ${fork.full_name}`,
      () =>
        client.get(`/repos/${slug}/compare/${snapshot.repo.defaultBranch || 'main'}...${fork.owner.login}:${branch}`, {
          ttl: 60 * 60 * 1000,
          allow404: true,
        }),
      null
    );
    out.push({
      ...base,
      ahead: compare?.ahead_by ?? 0,
      behind: compare?.behind_by ?? 0,
      lastCommitAt: compare?.commits?.[compare.commits.length - 1]?.commit?.author?.date || fork.pushed_at || null,
    });
  }
  // Forks genuinely ahead first.
  out.sort((a, b) => b.ahead - a.ahead || new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0));

  // Give ahead-forks a velocity-ish score so they can beat topic rivals: use
  // commits-ahead as a tiebreaker in rankCluster via commitsLast30.
  return out.map((f) => ({ ...f, commitsLast30: f.ahead || null, velocity: f.velocity || 0 }));
}

/** Stargazers who ship their own repos — the friendliest rivalry there is. */
async function collectFans(client, snapshot, log) {
  const logins = (snapshot.stars?.all || []).slice(0, MAX_FAN_LOOKUPS);
  const fans = [];
  for (const login of logins) {
    if (client.exhausted?.('core')) break;
    const user = await safe(
      log,
      `fan lookup ${login}`,
      () => client.get(`/users/${login}`, { ttl: 24 * 60 * 60 * 1000 }),
      null
    );
    if (!user || !user.public_repos) continue;
    fans.push({
      login: user.login,
      url: user.html_url,
      repos: user.public_repos,
      followers: user.followers ?? 0,
      avatar: user.avatar_url,
    });
  }
  fans.sort((a, b) => b.followers - a.followers || b.repos - a.repos);
  return fans.slice(0, 8);
}

function dedupeBySlug(list) {
  const seen = new Map();
  for (const item of list) {
    if (!item?.slug) continue;
    const existing = seen.get(item.slug);
    if (!existing) {
      seen.set(item.slug, item);
      continue;
    }
    // Prefer the entry with real (non-estimated) velocity and fork data.
    const better = (a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      if (!a.velocityEstimated) scoreA += 2;
      if (!b.velocityEstimated) scoreB += 2;
      if (a.kind === 'fork') scoreA += 1;
      if (b.kind === 'fork') scoreB += 1;
      return scoreB > scoreA ? b : a;
    };
    seen.set(item.slug, better(existing, item));
  }
  return [...seen.values()];
}

/** Persisted shape: everything we need for next run's rank diff. */
export function compactForState(result) {
  return {
    schema: 1,
    generatedAt: result.generatedAt,
    mode: result.summary?.mode,
    topicCluster: result.topicCluster,
    summary: result.summary,
    ranking: result.ranking
      ? {
          rank: result.ranking.rank,
          clusterSize: result.ranking.clusterSize,
          percentile: result.ranking.percentile,
          entries: result.ranking.entries.map((e) => ({ slug: e.slug, rank: e.rank, stars: e.stars, velocity: e.velocity, isSelf: e.isSelf })),
        }
      : null,
    history: (result.history || []).slice(-90),
    rivals: (result.rivals || []).slice(0, 30).map((r) => ({
      slug: r.slug,
      stars: r.stars,
      velocity: r.velocity,
      kind: r.kind,
      ahead: r.ahead ?? null,
    })),
    fans: result.fans?.slice(0, 8) || [],
    forks: (result.forks || []).slice(0, 20).map((f) => ({
      slug: f.slug,
      ahead: f.ahead,
      behind: f.behind,
      stars: f.stars,
      url: f.url,
      pushedAt: f.pushedAt,
      lastCommitAt: f.lastCommitAt ?? null,
    })),
    warnings: result.warnings || [],
  };
}
