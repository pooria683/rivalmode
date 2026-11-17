import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMomentum,
  momentumFromRatio,
  momentumLabel,
  rankCluster,
  diffRanking,
  weeklyPoints,
  starVelocity,
  compareRivals,
  gapLabel,
} from '../src/lib/score.mjs';
import { commitStreak, firstLine } from '../src/lib/collect.mjs';
import { isoWeek, isoWeekLabel, shortAge, dayKeysBetween, startOfWeek } from '../src/lib/dates.mjs';

/* ------------------------------------------------------------- momentum --- */

test('momentumFromRatio is symmetric and bounded', () => {
  assert.equal(momentumFromRatio(10, 10), 0);
  assert.equal(momentumFromRatio(20, 10), 50); // doubled
  assert.equal(momentumFromRatio(5, 10), -50); // halved
  assert.equal(momentumFromRatio(0, 0), 0);
  assert.equal(momentumFromRatio(0, 10), -100);
  assert.ok(momentumFromRatio(1000, 1) <= 100);
});

test('momentum labels escalate in the right order', () => {
  assert.equal(momentumLabel(100), 'on fire');
  assert.equal(momentumLabel(50), 'surging');
  assert.equal(momentumLabel(20), 'heating up');
  assert.equal(momentumLabel(0), 'holding');
  assert.equal(momentumLabel(-30), 'cooling');
  assert.equal(momentumLabel(-80), 'fading');
});

test('computeMomentum rewards a doubling week and clamps the total', () => {
  const snapshot = {
    commits: { last7: 20, prev7: 10, streak: 0 },
    merges: { week: 0, last30: 0 },
    stars: { last30: 0 },
  };
  const m = computeMomentum(snapshot);
  assert.ok(m.score > 30, `expected a surge, got ${m.score}`);
  assert.equal(m.direction, 'up');
  assert.equal(m.ratio, 2);

  const huge = computeMomentum({
    commits: { last7: 500, prev7: 1, streak: 14 },
    merges: { week: 50, last30: 200 },
    stars: { last30: 300 },
  });
  assert.ok(huge.score <= 100, 'momentum must clamp to 100');
});

test('a streak adds points but cannot rescue a dead week', () => {
  const snapshot = {
    commits: { last7: 0, prev7: 30, streak: 9 },
    merges: { week: 0, last30: 0 },
    stars: { last30: 0 },
  };
  const m = computeMomentum(snapshot);
  assert.ok(m.score < 0, 'a collapsing week stays negative');
  assert.equal(m.direction, 'down');
});

test('rival wins and losses move momentum in opposite directions', () => {
  const base = { commits: { last7: 10, prev7: 10, streak: 0 }, merges: { week: 0, last30: 0 }, stars: { last30: 0 } };
  const won = computeMomentum(base, undefined, { summary: { passed: 2, passedBy: 0 } });
  const lost = computeMomentum(base, undefined, { summary: { passed: 0, passedBy: 2 } });
  assert.ok(won.score > 0 && lost.score < 0);
  assert.equal(won.rivalBonus, 50);
});

/* ---------------------------------------------------------------- scoring --- */

test('weeklyPoints applies the published point table', () => {
  const snapshot = {
    commits: { last7: 10 },
    merges: { week: 2 },
    stars: { last30: 30 },
    issues: { last7: 3 },
    releases: [],
    forks: { recent: [] },
  };
  const points = weeklyPoints(snapshot);
  // 10*2 + 2*10 + 7*5 + 3*4 = 87  (stars: 30/30*7 = 7)
  assert.equal(points.commits, 10);
  assert.equal(points.stars, 7);
  assert.equal(points.total, 87);
  assert.ok(points.breakdown.some((b) => b.key === 'commits'));
});

test('weeklyPoints tolerates a completely empty snapshot', () => {
  const points = weeklyPoints({});
  assert.equal(points.total, 0);
  assert.ok(Array.isArray(points.breakdown));
});

/* ---------------------------------------------------------------- ranking --- */

const rival = (slug, stars, velocity, commitsLast30 = 0) => ({ slug, stars, velocity, commitsLast30 });

test('rankCluster orders by star velocity then stars', () => {
  const self = { repo: { slug: 'me/repo', name: 'repo', owner: 'me', stars: 100 }, stars: { perDay: 1 } };
  const { entries, rank, clusterSize } = rankCluster({
    self,
    rivals: [rival('a/fast', 50, 3), rival('b/slow', 900, 0.1), rival('c/mid', 200, 1)],
  });
  assert.equal(clusterSize, 4);
  assert.deepEqual(entries.map((e) => e.slug), ['a/fast', 'c/mid', 'me/repo', 'b/slow']);
  assert.equal(rank, 3);
});

test('rankCluster handles being first and being alone', () => {
  const self = { repo: { slug: 'me/repo', name: 'repo', owner: 'me', stars: 500 }, stars: { perDay: 9 } };
  const alone = rankCluster({ self, rivals: [] });
  assert.equal(alone.rank, 1);
  assert.equal(alone.clusterSize, 1);
  assert.equal(alone.leaders.length, 0);

  const first = rankCluster({ self, rivals: [rival('x/y', 10, 0.1)] });
  assert.equal(first.rank, 1);
  assert.equal(first.nextTarget, null);
  assert.equal(first.chasing.length, 1);
});

test('rankCluster excludes the self repo if it also appears as a rival', () => {
  const self = { slug: 'me/repo', repo: { slug: 'me/repo', stars: 10 }, stars: { perDay: 1 } };
  const { entries } = rankCluster({ self, rivals: [rival('me/repo', 10, 1), rival('a/b', 5, 0.2)] });
  assert.equal(entries.filter((e) => e.slug === 'me/repo').length, 1);
  assert.equal(entries.find((e) => e.slug === 'me/repo').isSelf, true);
});

test('compareRivals is a stable total order', () => {
  const list = [rival('b', 10, 1, 2), rival('a', 10, 1, 2), rival('c', 20, 1, 2)];
  const sorted = [...list].sort(compareRivals);
  assert.deepEqual(sorted.map((r) => r.slug), ['c', 'a', 'b']);
});

test('diffRanking reports who you passed and who passed you', () => {
  const current = {
    rank: 2,
    clusterSize: 3,
    self: { slug: 'me/repo' },
    entries: [
      { slug: 'a/b', rank: 1 },
      { slug: 'me/repo', rank: 2, isSelf: true },
      { slug: 'c/d', rank: 3 },
    ],
  };
  const previous = {
    rank: 3,
    entries: [
      { slug: 'a/b', rank: 1 },
      { slug: 'c/d', rank: 2 },
      { slug: 'me/repo', rank: 3 },
    ],
  };
  const diff = diffRanking(current, previous);
  assert.equal(diff.delta, 1);
  assert.deepEqual(diff.passed.map((p) => p.slug), ['c/d']);
  assert.deepEqual(diff.passedBy, []);
});

test('diffRanking survives a first run with no history', () => {
  const diff = diffRanking({ rank: 4, entries: [] }, null);
  assert.equal(diff.delta, null);
  assert.deepEqual(diff.passed, []);
});

test('gapLabel prefers velocity when the rival is accelerating', () => {
  assert.match(gapLabel({ stars: 100, velocity: 1 }, { stars: 110, velocity: 2 }), /★\/day behind/);
  assert.match(gapLabel({ stars: 100, velocity: 3 }, { stars: 110, velocity: 2 }), /10★ behind/);
});

test('starVelocity counts only the window and handles junk', () => {
  const now = Date.now();
  const stars = [
    { at: new Date(now - 86400000).toISOString() },
    { at: new Date(now - 40 * 86400000).toISOString() },
    { at: null },
  ];
  assert.equal(starVelocity(stars, 30), 0.03);
  assert.equal(starVelocity([], 30), 0);
  assert.equal(starVelocity(null, 30), 0);
});

/* ------------------------------------------------------------------ dates --- */

test('commitStreak counts back from today and tolerates a quiet morning', () => {
  const byDay = { '2026-11-16': 0, '2026-11-15': 2, '2026-11-14': 1, '2026-11-13': 0, '2026-11-12': 5 };
  assert.equal(commitStreak(byDay, '2026-11-16'), 2);
  const withToday = { ...byDay, '2026-11-16': 1 };
  assert.equal(commitStreak(withToday, '2026-11-16'), 3);
  assert.equal(commitStreak({}, '2026-11-16'), 0);
});

test('isoWeek matches known ISO week numbers', () => {
  assert.deepEqual(isoWeek('2026-11-16'), { year: 2026, week: 47 });
  assert.equal(isoWeekLabel('2026-01-01'), '2026-W01');
  assert.equal(isoWeekLabel('2026-12-31'), '2026-W53');
  assert.equal(isoWeekLabel('2025-12-29'), '2026-W01');
});

test('startOfWeek is Monday UTC', () => {
  assert.equal(startOfWeek('2026-11-16T23:00:00Z').toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(startOfWeek('2026-11-15T23:00:00Z').toISOString(), '2026-11-09T00:00:00.000Z');
});

test('shortAge buckets time sensibly', () => {
  const now = Date.UTC(2026, 10, 16, 12);
  assert.equal(shortAge(new Date(now - 30000).toISOString(), now), 'now');
  assert.equal(shortAge(new Date(now - 5 * 60000).toISOString(), now), '5m');
  assert.equal(shortAge(new Date(now - 3 * 3600000).toISOString(), now), '3h');
  assert.equal(shortAge(new Date(now - 3 * 86400000).toISOString(), now), '3d');
  assert.equal(shortAge('not-a-date', now), '?');
});

test('dayKeysBetween spans inclusive UTC days', () => {
  const keys = dayKeysBetween('2026-11-10T22:00:00Z', '2026-11-13T01:00:00Z');
  assert.deepEqual(keys, ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
});

test('firstLine trims commit messages to one line', () => {
  assert.equal(firstLine('feat: x\n\nlong body'), 'feat: x');
  assert.equal(firstLine('x'.repeat(100)).length, 72);
  assert.equal(firstLine(undefined), '');
});
