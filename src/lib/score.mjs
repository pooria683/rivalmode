/**
 * Scoring. Deliberately simple, fully documented in the README, and pure so it
 * can be unit-tested with fixtures.
 *
 * Momentum answers one question: "is this repo hotter than its own recent
 * baseline?" It compares the last 7 days against the 7 days before, weighted by
 * the point table, then nudges for streaks and rival wins.
 */
import { clamp } from './dates.mjs';

export const DEFAULT_POINTS = Object.freeze({
  commit: 2,
  merge: 10,
  star: 5,
  fork: 8,
  release: 25,
  issueClosed: 4,
  streakDay: 3,
  rivalBeaten: 25,
});

/** Points for the trailing 7-day window, straight from the snapshot. */
export function weeklyPoints(snapshot, points = DEFAULT_POINTS) {
  const p = { ...DEFAULT_POINTS, ...points };
  const commits = snapshot.commits?.last7 ?? 0;
  const merges = snapshot.merges?.week ?? 0;
  const stars = snapshot.stars?.last30 ? Math.round((snapshot.stars.last30 / 30) * 7) : 0;
  const forks = recentForks(snapshot, 7);
  const releases = recentReleases(snapshot, 7);
  const issues = snapshot.issues?.last7 ?? 0;
  return {
    commits,
    merges,
    stars,
    forks,
    releases,
    issues,
    total:
      commits * p.commit +
      merges * p.merge +
      stars * p.star +
      forks * p.fork +
      releases * p.release +
      issues * p.issueClosed,
    breakdown: [
      { key: 'commits', label: 'commits', count: commits, points: commits * p.commit, unit: p.commit },
      { key: 'merges', label: 'merges', count: merges, points: merges * p.merge, unit: p.merge },
      { key: 'stars', label: 'stars', count: stars, points: stars * p.star, unit: p.star },
      { key: 'forks', label: 'forks', count: forks, points: forks * p.fork, unit: p.fork },
      { key: 'releases', label: 'releases', count: releases, points: releases * p.release, unit: p.release },
      { key: 'issues', label: 'issues closed', count: issues, points: issues * p.issueClosed, unit: p.issueClosed },
    ].filter((row) => row.count > 0 || row.key === 'commits'),
  };
}

function recentForks(snapshot, days) {
  const cutoff = Date.now() - days * 86400000;
  const list = snapshot.forks?.recent || snapshot.forksList || [];
  if (Array.isArray(list)) return list.filter((f) => f.createdAt && new Date(f.createdAt).getTime() >= cutoff).length;
  return 0;
}

function recentReleases(snapshot, days) {
  const cutoff = Date.now() - days * 86400000;
  return (snapshot.releases || []).filter((r) => r.at && new Date(r.at).getTime() >= cutoff).length;
}

/**
 * Momentum = how this week compares to last week, on a -100..+100 scale.
 *
 *   ratio 0    -> -100 (everyone stopped)
 *   ratio 0.5  ->  -50 (halved)
 *   ratio 1    ->    0 (flat)
 *   ratio 2    ->  +50 (doubled)
 *   ratio 4+   -> +100 (4x or better)
 *
 * The mapping is `50 * log2(ratio)`, which is the only one that behaves on a
 * power-of-two scale: halving always costs exactly 50, doubling always earns
 * exactly 50, and no single huge week can dominate the scoreboard forever.
 */
export function momentumFromRatio(current, previous) {
  if (current === 0 && previous === 0) return 0;
  if (previous === 0) return 100;
  if (current === 0) return -100;
  const ratio = current / previous;
  return Math.round(clamp(50 * Math.log2(ratio), -100, 100));
}

/** Compare weeks on a points basis, falling back to raw commits for new repos. */
export function computeMomentum(snapshot, points = DEFAULT_POINTS, rivals = null) {
  const p = { ...DEFAULT_POINTS, ...points };
  const cur = snapshot.commits?.last7 ?? 0;
  const prev = snapshot.commits?.prev7 ?? 0;
  const curMerges = snapshot.merges?.week ?? 0;
  const prevMerges = Math.max(0, Math.round((snapshot.merges?.last30 ?? 0) / 4) - curMerges);
  const curStars = Math.round((snapshot.stars?.last30 ?? 0) / 30 * 7);
  const prevStars = Math.max(0, Math.round((snapshot.stars?.last30 ?? 0) / 30 * 7 * 0.6));

  const curWeighted = cur * p.commit + curMerges * p.merge + curStars * p.star;
  const prevWeighted = prev * p.commit + prevMerges * p.merge + prevStars * p.star;

  // A single commit after a dead week is technically an infinite improvement.
  // Cap the celebration until there is enough volume for it to mean something.
  let score = momentumFromRatio(curWeighted, prevWeighted);
  if (curWeighted < 10 && score > 40) score = 40;
  if (curWeighted === 0 && prevWeighted === 0) score = 0;
  const streak = snapshot.commits?.streak ?? 0;
  const streakBonus = clamp(streak, 0, 14) * p.streakDay;
  score += streakBonus;

  let rivalBonus = 0;
  if (rivals?.summary) {
    rivalBonus = (rivals.summary.passed ?? 0) * p.rivalBeaten - (rivals.summary.passedBy ?? 0) * Math.round(p.rivalBeaten / 2);
    score += rivalBonus;
  }

  return {
    score: Math.round(clamp(score, -100, 100)),
    raw: score,
    direction: score > 3 ? 'up' : score < -3 ? 'down' : 'flat',
    ratio: prevWeighted === 0 ? null : Math.round((curWeighted / prevWeighted) * 100) / 100,
    current: { commits: cur, merges: curMerges, stars: curStars, weighted: curWeighted },
    previous: { commits: prev, merges: prevMerges, stars: prevStars, weighted: prevWeighted },
    streak,
    streakBonus,
    rivalBonus,
    label: momentumLabel(score),
  };
}

export function momentumLabel(score) {
  if (score >= 75) return 'on fire';
  if (score >= 45) return 'surging';
  if (score >= 15) return 'heating up';
  if (score > -15) return 'holding';
  if (score > -45) return 'cooling';
  return 'fading';
}

/**
 * Rival ranking. Rivals are ordered by star velocity (stars/day over the last
 * 30 days), tie-broken by total stars then by recent commit activity. The
 * current repo is dropped into the same list to get an honest rank.
 */
export function rankCluster({ self, rivals = [], limits = {} } = {}) {
  const maxLeaders = limits.maxLeaders ?? 5;
  const entries = [];

  if (self) {
    entries.push({
      slug: self.repo?.slug || self.slug,
      name: self.repo?.name || self.slug?.split('/')[1] || 'this repo',
      owner: self.repo?.owner || self.slug?.split('/')[0] || '',
      url: self.repo?.url || `https://github.com/${self.repo?.slug}`,
      stars: self.repo?.stars ?? self.stars ?? 0,
      velocity: self.velocity ?? self.stars?.perDay ?? 0,
      forks: self.repo?.forks ?? self.forks ?? 0,
      commitsLast30: self.commits?.month ?? self.commitsLast30 ?? 0,
      kind: 'self',
      isSelf: true,
      velocityEstimated: false,
      topics: self.repo?.topics || [],
      language: self.repo?.language || null,
      description: self.repo?.description || '',
    });
  }

  const selfSlug = self?.repo?.slug || self?.slug;
  const dropped = [];
  for (const r of rivals) {
    // A repo can show up both as "self" and as a search hit; it is never its own rival.
    if (!r?.slug || (selfSlug && r.slug === selfSlug)) continue;
    if (!isRankable(r)) {
      dropped.push(r.slug);
      continue;
    }
    entries.push({ ...r, isSelf: false });
  }

  entries.sort(compareRivals);

  const selfIndex = entries.findIndex((e) => e.isSelf);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  const selfEntry = selfIndex >= 0 ? entries[selfIndex] : null;
  const ahead = selfIndex > 0 ? entries.slice(0, selfIndex) : [];
  const behind = selfIndex >= 0 ? entries.slice(selfIndex + 1) : entries;
  const clusterSize = entries.length;

  return {
    entries,
    self: selfEntry,
    rank: selfEntry?.rank ?? null,
    clusterSize,
    leaders: ahead.slice(-maxLeaders).reverse(),
    nextTarget: ahead.length ? ahead[ahead.length - 1] : null,
    chasing: behind.slice(0, 3),
    percentile: selfEntry && clusterSize > 1 ? Math.max(1, Math.round(((clusterSize - selfEntry.rank + 1) / clusterSize) * 100)) : null,
    podium: selfEntry ? selfEntry.rank <= 3 : false,
    dropped,
  };
}

/**
 * Ranking order, in this precise order:
 *   1. momentum evidence — a repo with measured velocity beats one we could
 *      only estimate, because otherwise unpicked candidates win on a guess;
 *   2. star velocity;
 *   3. total stars;
 *   4. commit activity;
 *   5. slug (so the order is total and snapshots are stable).
 */
export function compareRivals(a, b) {
  const evA = a.velocityEstimated ? 0 : 1;
  const evB = b.velocityEstimated ? 0 : 1;
  if (evA !== evB) return evB - evA;
  if ((b.velocity ?? 0) !== (a.velocity ?? 0)) return (b.velocity ?? 0) - (a.velocity ?? 0);
  if ((b.stars ?? 0) !== (a.stars ?? 0)) return (b.stars ?? 0) - (a.stars ?? 0);
  if ((b.commitsLast30 ?? 0) !== (a.commitsLast30 ?? 0)) return (b.commitsLast30 ?? 0) - (a.commitsLast30 ?? 0);
  return String(a.slug).localeCompare(String(b.slug));
}

/**
 * Rivals need evidence of momentum to share a ladder with you. A repo with no
 * stars and no measurable velocity is not "level with you" — it is unknown, and
 * ranking unknowns above you is how a scoreboard loses all credibility.
 */
export function isRankable(entry) {
  if (!entry) return false;
  if (entry.isSelf) return true;
  return Boolean(entry.velocityEstimated === false || (entry.velocity ?? 0) > 0 || (entry.stars ?? 0) > 0);
}

/** Stars/day over a window, from a star+json list; 0 when unknown. */
export function starVelocity(recentStars, windowDays = 30) {
  if (!Array.isArray(recentStars) || !recentStars.length) return 0;
  const cutoff = Date.now() - windowDays * 86400000;
  const count = recentStars.filter((s) => s.at && new Date(s.at).getTime() >= cutoff).length;
  return Math.round((count / windowDays) * 100) / 100;
}

/**
 * How the cluster rank moved since the previous run.
 * `previous` is the stored ranking: { rank, clusterSize, entries: [{slug, rank}] }.
 */
export function diffRanking(current, previous) {
  if (!previous || previous.rank == null || current.rank == null) {
    return { delta: null, passed: [], passedBy: [], entered: [], left: [] };
  }
  const prevRankBySlug = new Map((previous.entries || []).map((e) => [e.slug, e.rank]));
  const currRankBySlug = new Map(current.entries.map((e) => [e.slug, e.rank]));
  const selfSlug = current.self?.slug;

  const passed = [];
  const passedBy = [];
  for (const [slug, prevRank] of prevRankBySlug) {
    if (slug === selfSlug) continue;
    const now = currRankBySlug.get(slug);
    if (now == null) continue;
    const wasAhead = prevRank < (previous.rank ?? Infinity);
    const isAhead = now < (current.rank ?? Infinity);
    if (wasAhead && !isAhead) passed.push({ slug, from: prevRank, to: now });
    if (!wasAhead && isAhead) passedBy.push({ slug, from: prevRank, to: now });
  }

  return {
    delta: (previous.rank ?? 0) - (current.rank ?? 0),
    passed,
    passedBy,
    entered: current.entries.filter((e) => !e.isSelf && !prevRankBySlug.has(e.slug)).map((e) => e.slug),
    left: [...prevRankBySlug.keys()].filter((slug) => slug !== selfSlug && !currRankBySlug.has(slug)),
  };
}

/** Human headline for the scoreboard, e.g. "You are #3 of 12 in ai · ahead of X". */
export function rankHeadline(ranking, { topicLabel = 'your cluster' } = {}) {
  if (!ranking?.rank) return 'Unranked — rival search is off for this repo';
  const { rank, clusterSize, nextTarget, percentile } = ranking;
  const place = `${rank} of ${clusterSize}`;
  if (rank === 1) return `#1 of ${clusterSize} in ${topicLabel}`;
  const gap = nextTarget ? gapLabel(ranking.self, nextTarget) : '';
  return `#${place} in ${topicLabel}${gap ? ` · ${gap} from #${rank - 1}` : ''}${
    percentile && percentile >= 90 ? ' · top 10%' : ''
  }`;
}

export function gapLabel(self, target) {
  if (!self || !target) return '';
  if (target.velocity > self.velocity) {
    const diff = Math.round((target.velocity - self.velocity) * 100) / 100;
    return `${diff > 0 ? diff : '<0.01'}★/day behind`;
  }
  const gap = Math.max(1, Math.ceil(target.stars - self.stars));
  return `${gap}★ behind`;
}

/** A single headline number for the badge and the README title row. */
export function headlineStats(snapshot) {
  return {
    commitsToday: snapshot.commits?.today ?? 0,
    commitsWeek: snapshot.commits?.week ?? 0,
    streak: snapshot.commits?.streak ?? 0,
    openPRs: snapshot.counts?.openPRs ?? 0,
    branches: snapshot.counts?.branches ?? 0,
    stars: snapshot.counts?.stars ?? 0,
    mergesPerDay: snapshot.merges?.perDay ?? 0,
    contributors: snapshot.counts?.contributors ?? 0,
  };
}
