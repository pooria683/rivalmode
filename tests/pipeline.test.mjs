import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSnapshot, createLog } from '../src/lib/collect.mjs';
import { discoverRivals, pickTopics, compactForState, peerBand, starBand, isRivalMaterial } from '../src/lib/rivals.mjs';
import { run } from '../src/pipeline.mjs';
import { DEFAULT_CONFIG, normalizeConfig, parseRepoSlug, detectRepo } from '../src/lib/config.mjs';
import { GithubClient, GithubError, describeError } from '../src/lib/github.mjs';
import { fakeClient, NOW, repo, commits } from './fixtures/api.mjs';
import { buildRecap, recapMarkdown } from '../src/recap.mjs';
import { makeSnapshot, makeRivals, makeMomentum } from '../src/lib/mock.mjs';

const SLUG = parseRepoSlug('pooria683/rivalmode');
const CONFIG = normalizeConfig({ ...DEFAULT_CONFIG, theme: 'midnight' });

/* --------------------------------------------------------------- collect --- */

test('collectSnapshot normalises the repo and its counters', async () => {
  const client = fakeClient();
  const log = createLog(true);
  const snapshot = await collectSnapshot(client, SLUG, CONFIG, { log, now: NOW });

  assert.equal(snapshot.repo.slug, 'pooria683/rivalmode');
  assert.equal(snapshot.counts.stars, 184);
  assert.equal(snapshot.counts.branches, 3);
  assert.equal(snapshot.counts.openPRs, 3);
  assert.equal(snapshot.commits.today, 5);
  assert.equal(snapshot.commits.streak, 2);
  assert.ok(snapshot.commits.last7 >= 8);
  assert.equal(snapshot.merges.week, 1);
  assert.equal(snapshot.releases.length, 2);
  assert.equal(snapshot.feed[0].type, 'PushEvent');
  assert.ok(snapshot.feed[0].text.includes('pushed 3 commits'));
  assert.ok(snapshot.leaderboard.length === 3);
  assert.equal(snapshot.leaderboard[0].login, 'pooria683');
  assert.ok(Object.keys(snapshot.activity).length > 50, 'activity covers the 60-day window');
});

test('collectSnapshot refuses to invent numbers when the repo is unreadable', async () => {
  const client = fakeClient({ routes: { '/repos/pooria683/rivalmode': null } });
  await assert.rejects(
    () => collectSnapshot(client, SLUG, CONFIG, { log: createLog(true), now: NOW }),
    /could not read pooria683\/rivalmode/
  );
});

test('private repos are flagged and set degraded mode', async () => {
  const client = fakeClient({ routes: { '/repos/pooria683/rivalmode': { ...repo, private: true } } });
  const snapshot = await collectSnapshot(client, SLUG, CONFIG, { log: createLog(true), now: NOW });
  assert.equal(snapshot.private, true);
  assert.equal(snapshot.degraded, true);
});

/* --------------------------------------------------------------- rivals --- */

test('discoverRivals merges forks, topic neighbours, and drops brand-new repos', async () => {
  const client = fakeClient();
  const log = createLog(true);
  const snapshot = await collectSnapshot(client, SLUG, CONFIG, { log, now: NOW });
  const rivals = await discoverRivals(client, snapshot, CONFIG, { log, now: NOW });

  const slugs = rivals.rivals.map((r) => r.slug);
  assert.ok(slugs.includes('acme/scoreboard-kit'), 'topic neighbour found');
  assert.ok(slugs.includes('julesortiz/rivalmode'), 'fork found');
  assert.ok(!slugs.includes('too-new/just-born'), 'repos younger than minAgeDays are ignored');
  assert.ok(!slugs.includes('pooria683/rivalmode'), 'self is never a rival');

  const fork = rivals.rivals.find((r) => r.slug === 'julesortiz/rivalmode');
  assert.equal(fork.ahead, 14, 'fork comparison is recorded');
  assert.ok(rivals.ranking.rank >= 1);
  assert.equal(rivals.ranking.entries.filter((e) => e.isSelf).length, 1);
  assert.ok(rivals.topicCluster.includes('github-actions'));
});

test('discoverRivals degrades to forks-only on a private repo', async () => {
  const client = fakeClient({ routes: { '/repos/pooria683/rivalmode': { ...repo, private: true } } });
  const log = createLog(true);
  const snapshot = await collectSnapshot(client, SLUG, CONFIG, { log, now: NOW });
  const rivals = await discoverRivals(client, snapshot, CONFIG, { log, now: NOW });
  assert.equal(rivals.enabled, false);
  assert.equal(rivals.summary.mode, 'degraded');
  assert.ok(rivals.forks.length > 0, 'forks still work: they are our own data');
  assert.match(rivals.degradedReason, /private/);
});

test('discoverRivals survives a total search failure', async () => {
  const client = fakeClient({ fail: (p) => p.startsWith('/search/repositories') });
  const log = createLog(true);
  const snapshot = await collectSnapshot(client, SLUG, CONFIG, { log, now: NOW });
  const rivals = await discoverRivals(client, snapshot, CONFIG, { log, now: NOW });
  assert.ok(rivals.rivals.some((r) => r.kind === 'fork'), 'forks still ranked');
  assert.ok(rivals.warnings.length > 0, 'the failure is recorded');
});

test('a repo with no topics falls back to language, then to nothing', () => {
  assert.deepEqual(pickTopics([], ['cli', 'app'], { language: 'Go' }), ['cli', 'app']);
  assert.deepEqual(pickTopics([], [], { language: 'Go' }), ['go']);
  assert.deepEqual(pickTopics(['Rust', 'CLI'], [], {}), ['rust', 'cli']);
  assert.deepEqual(pickTopics(['hacktoberfest'], [], {}), []);
});

test('starBand gives a tiny repo a ladder and keeps whales out', () => {
  const tiny = starBand(0);
  assert.equal(tiny.lo, 1);
  assert.ok(tiny.hi >= 30);
  const mid = starBand(184);
  assert.ok(mid.lo < 184 && mid.hi > 184);
  assert.ok(mid.hi <= 184 * 10, 'whales stay out of the band');
});

test('peerBand picks the closest weight class, not the biggest names', () => {
  const candidates = [
    { slug: 'k8s/kubernetes', stars: 100000 },
    { slug: 'a/near-small', stars: 20 },
    { slug: 'b/near', stars: 40 },
    { slug: 'c/mid', stars: 200 },
    { slug: 'd/far', stars: 9000 },
  ];
  const peers = peerBand(candidates, 50, { clusterSize: 3 });
  assert.deepEqual(peers.map((p) => p.slug).sort(), ['a/near-small', 'b/near', 'c/mid']);
});

test('isRivalMaterial filters noise: forks, profiles, archived, dormant', () => {
  const now = Date.now();
  const base = {
    full_name: 'a/real',
    created_at: new Date(now - 40 * 86400000).toISOString(),
    pushed_at: new Date(now - 86400000).toISOString(),
    description: 'a real project',
    stargazers_count: 5,
    forks_count: 1,
  };
  assert.equal(isRivalMaterial(base, {}, now), true);
  assert.equal(isRivalMaterial({ ...base, fork: true }, {}, now), false);
  assert.equal(isRivalMaterial({ ...base, archived: true }, {}, now), false);
  assert.equal(isRivalMaterial({ ...base, full_name: 'a/a' }, {}, now), false);
  assert.equal(isRivalMaterial({ ...base, created_at: new Date(now - 86400000).toISOString() }, {}, now), false);
  assert.equal(isRivalMaterial({ ...base, pushed_at: new Date(now - 300 * 86400000).toISOString() }, {}, now), false);
  assert.equal(
    isRivalMaterial({ full_name: 'a/empty', created_at: base.created_at, pushed_at: base.pushed_at, stargazers_count: 0, forks_count: 0, size: 0, description: '' }, {}, now),
    false,
    'profile-README-shaped repos are filtered'
  );
});

test('compactForState keeps only what the next run needs', async () => {
  const client = fakeClient();
  const log = createLog(true);
  const snapshot = await collectSnapshot(client, SLUG, CONFIG, { log, now: NOW });
  const rivals = await discoverRivals(client, snapshot, CONFIG, { log, now: NOW });
  const compact = compactForState(rivals);
  const json = JSON.stringify(compact);
  assert.ok(json.length < 20000, 'state file stays small enough to commit hourly');
  assert.ok(compact.ranking.entries.length > 1);
  assert.ok(!('topicCandidates' in compact));
});

test('rank changes are detected between two runs', async () => {
  const client = fakeClient();
  const log = createLog(true);
  const snapshot = await collectSnapshot(client, SLUG, CONFIG, { log, now: NOW });
  const first = await discoverRivals(client, snapshot, CONFIG, { log, now: NOW });

  // Rewrite history so the last run had us last: the diff must see us climbing.
  const stored = compactForState(first);
  stored.ranking.rank = stored.ranking.entries.length;
  stored.ranking.entries = stored.ranking.entries.map((e) => ({
    ...e,
    rank: e.isSelf ? stored.ranking.entries.length : Math.max(1, e.rank),
  }));
  const second = await discoverRivals(client, snapshot, CONFIG, { log, now: NOW, previous: stored });

  assert.ok(second.ranking.changes, 'changes are always present');
  assert.equal(typeof second.summary.passed, 'number');
  assert.equal(typeof second.summary.passedBy, 'number');
  assert.ok(second.summary.passed >= 1, 'climbing the ladder is reported as passing rivals');
  assert.ok(second.ranking.changes.passed.length >= 1);
  assert.ok(compactForState(second).ranking.changes, 'changes survive compaction into the state file');
});

/* ---------------------------------------------------------------- github --- */

test('GithubClient sends ETags and reuses cache on 304', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (init.headers['if-none-match']) {
      return new Response(null, { status: 304, headers: { etag: '"abc"' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { etag: '"abc"' } });
  };
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rm-cache-')), 'cache.json');
  const client = new GithubClient({ token: 't', fetchImpl, cacheFile: tmp, ttl: 0 });

  const first = await client.get('/repos/a/b');
  assert.deepEqual(first, { ok: true });
  const second = await client.get('/repos/a/b');
  assert.deepEqual(second, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['if-none-match'], '"abc"');
  assert.equal(client.stats().cacheHits, 1);
  client.saveCache();
  assert.ok(fs.existsSync(tmp));
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});

test('GithubClient returns null for 404 and throws typed errors otherwise', async () => {
  const fetchImpl = async () => new Response('{"message":"nope"}', { status: 404 });
  const client = new GithubClient({ fetchImpl, maxRetries: 0 });
  assert.equal(await client.get('/x'), null);

  const forbidden = new GithubClient({
    fetchImpl: async () => new Response('{"message":"secondary rate limit"}', { status: 403 }),
    maxRetries: 0,
  });
  await assert.rejects(() => forbidden.get('/x'), (err) => err instanceof GithubError && err.status === 403);

  assert.match(describeError(new GithubError('x', { status: 403 })), /rate limit/);
  assert.match(describeError(new Error('boom')), /boom/);
});

test('GithubClient retries 500s and then succeeds', async () => {
  let attempt = 0;
  const client = new GithubClient({
    fetchImpl: async () => {
      attempt += 1;
      return attempt < 3
        ? new Response('oops', { status: 502 })
        : new Response('{"fine":true}', { status: 200 });
    },
    maxRetries: 3,
    sleep: async () => {},
  });
  assert.deepEqual(await client.get('/x'), { fine: true });
  assert.equal(attempt, 3);
});

test('GithubClient refuses to authenticate-less badly: 401 is explicit', async () => {
  const client = new GithubClient({ fetchImpl: async () => new Response('{}', { status: 401 }), maxRetries: 0 });
  await assert.rejects(() => client.get('/x'), /token/);
});

test('pagination follows pages until a short page', async () => {
  let page = 0;
  const client = new GithubClient({
    fetchImpl: async (url) => {
      page += 1;
      const n = page < 2 ? 100 : 3;
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ i }))), {
        status: 200,
        headers: { link: page < 2 ? '<https://api.github.com/x?page=2>; rel="next"' : '' },
      });
    },
  });
  const items = await client.paginate('/x', { maxPages: 5 });
  assert.equal(items.length, 103);
});

/* -------------------------------------------------------------- pipeline --- */

test('run() writes SVGs, state and README into a scratch repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rivalmode-run-'));
  const client = fakeClient();
  const log = createLog(true);
  const result = await run({
    root: dir,
    config: CONFIG,
    slug: SLUG,
    client,
    log,
    now: NOW,
    mode: 'rivals',
  });

  assert.ok(result.files[path.join(dir, 'assets/rivalmode/scoreboard.svg')].startsWith('<svg'));
  assert.ok(fs.existsSync(path.join(dir, 'assets/rivalmode/rivals.svg')));
  assert.ok(fs.existsSync(path.join(dir, 'README.md')));
  assert.ok(fs.existsSync(path.join(dir, '.rivalmode/state/rivals.json')));
  assert.ok(fs.existsSync(path.join(dir, '.rivalmode/state/momentum.json')));

  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.ok(readme.includes('rivalmode:start scoreboard'));
  assert.ok(readme.includes('pooria683/rivalmode'));

  // Second run with identical data must be a no-op — no commit churn.
  const second = await run({ root: dir, config: CONFIG, slug: SLUG, client: fakeClient(), log, now: NOW, mode: 'rivals' });
  assert.equal(second.readmeChanged, false);
  assert.equal(second.changedFiles.length, 0, `expected no changes, got ${second.changedFiles.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('run() in scoreboard mode reuses the stored ladder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rivalmode-reuse-'));
  const log = createLog(true);
  await run({ root: dir, config: CONFIG, slug: SLUG, client: fakeClient(), log, now: NOW, mode: 'rivals' });
  const stored = JSON.parse(fs.readFileSync(path.join(dir, '.rivalmode/state/rivals.json'), 'utf8'));

  const result = await run({ root: dir, config: CONFIG, slug: SLUG, client: fakeClient(), log, now: NOW + 3600_000, mode: 'scoreboard' });
  assert.equal(result.ranking.rank, stored.ranking.rank);
  assert.ok(result.ranking.stale, 'cached ladder is marked stale');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('run() with --mock never touches the network', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rivalmode-mock-'));
  let networkCalls = 0;
  const result = await run({
    root: dir,
    config: CONFIG,
    now: NOW,
    write: true,
    mock: true,
    log: createLog(true),
    client: { get: () => { networkCalls += 1; }, paginate: () => { networkCalls += 1; }, stats: () => ({}) },
  });
  assert.equal(networkCalls, 0);
  assert.ok(result.snapshot.repo.slug.includes('/'));
  assert.ok(fs.existsSync(path.join(dir, 'assets/rivalmode/scoreboard.svg')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('run() reports a hard failure when every API call fails', async () => {
  const client = fakeClient({ routes: { '/repos/pooria683/rivalmode': null } });
  await assert.rejects(
    () => run({ root: os.tmpdir(), config: CONFIG, slug: SLUG, client, log: createLog(true), now: NOW, write: false }),
    /could not read/
  );
});

/* ----------------------------------------------------------------- recap --- */

test('recap summarises the week with real numbers', () => {
  const { snapshot, rivals } = makeSnapshot({ now: NOW, seed: 'recap' });
  const momentum = makeMomentum(snapshot, rivals, CONFIG.points);
  const recap = buildRecap({
    snapshot,
    momentum,
    ranking: { ...rivals.ranking, changes: { passed: [], passedBy: [] } },
    rivals,
    history: [],
    config: CONFIG,
    now: NOW,
  });
  assert.ok(recap.points.total > 0);
  assert.ok(recap.topContributor?.login);
  assert.equal(recap.clusterSize, rivals.ranking.clusterSize);
  const md = recapMarkdown(recap, { config: CONFIG, snapshot });
  assert.match(md, /RivalMode weekly recap/);
  assert.match(md, /\| \*\*Points earned\*\* \|/);
  assert.ok(md.includes(snapshot.repo.slug));
});

test('recap roasts a rival that passed, and brags when one was passed', () => {
  const { snapshot, rivals } = makeSnapshot({ now: NOW, seed: 'roast' });
  const momentum = makeMomentum(snapshot, rivals, CONFIG.points);
  const roasted = buildRecap({
    snapshot,
    momentum,
    ranking: { ...rivals.ranking, changes: { passed: [], passedBy: [{ slug: 'acme/scoreboard-kit' }] } },
    rivals,
    config: CONFIG,
    now: NOW,
  });
  assert.equal(roasted.roast.tone, 'roast');
  assert.match(roasted.roast.text, /acme\/scoreboard-kit/);

  const bragged = buildRecap({
    snapshot,
    momentum,
    ranking: { ...rivals.ranking, changes: { passed: [{ slug: 'tinyfish/readme-runner' }], passedBy: [] } },
    rivals,
    config: CONFIG,
    now: NOW,
  });
  assert.equal(bragged.roast.tone, 'brag');
});

/* ------------------------------------------------------------------ config --- */

test('detectRepo prefers config, then env, and parseRepoSlug is forgiving', () => {
  assert.equal(detectRepo({ repo: 'a/b' }, { GITHUB_REPOSITORY: 'c/d' }), 'a/b');
  assert.equal(detectRepo({}, { GITHUB_REPOSITORY: 'c/d' }), 'c/d');
  assert.equal(detectRepo({}, {}), '');
  assert.equal(parseRepoSlug('https://github.com/a/b.git').slug, 'a/b');
  assert.throws(() => parseRepoSlug('nope'), /owner\/repo/);
});

test('normalizeConfig clamps hostile values', () => {
  const cfg = normalizeConfig({ rivals: { searchPerTopic: 999 }, feed: { limit: -2 }, outDir: '/x/y/' });
  assert.equal(cfg.rivals.searchPerTopic, 30);
  assert.equal(cfg.feed.limit, 1);
  assert.equal(cfg.outDir, 'x/y');
});

/* ------------------------------------------------------------- fixtures sanity --- */

test('fixtures match the shapes the collectors rely on', () => {
  assert.ok(Array.isArray(commits()));
  assert.equal(commits().length, 5 + 3 + 4 + 6);
  assert.ok(repo.created_at < repo.pushed_at);
  const { snapshot } = makeSnapshot({ now: NOW });
  assert.equal(snapshot.counts.contributors, snapshot.leaderboard.length);
  const rivals = makeRivals({ now: NOW, self: snapshot });
  assert.ok(rivals.ranking.entries.some((e) => e.isSelf));
});
