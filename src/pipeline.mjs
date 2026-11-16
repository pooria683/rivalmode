/**
 * The pipeline: collect -> score -> render -> write. Used by the CLI, by the
 * workflows, and by the integration test.
 *
 * Jobs are deliberately separable so the hourly scoreboard never pays for the
 * daily rival search:
 *   scoreboard : collect + render + README   (hourly)
 *   rivals     : discover rivals + render    (daily)
 *   recap      : read state, post a comment  (weekly)
 */
import fs from 'node:fs';
import path from 'node:path';
import { GithubClient } from './lib/github.mjs';
import { collectSnapshot, createLog, safe } from './lib/collect.mjs';
import { computeMomentum, rankCluster, weeklyPoints } from './lib/score.mjs';
import { discoverRivals, compactForState } from './lib/rivals.mjs';
import { renderAll } from './render.mjs';
import { buildSections, writeReadme } from './render_readme.mjs';
import { loadConfig, parseRepoSlug, detectRepo, stateDir } from './lib/config.mjs';
import { STATE_FILES, appendMomentumHistory, mergeFeed, readState, statePath, writeState, writeIfChanged } from './lib/state.mjs';
import { makeSnapshot, makeRivals, makeMomentum } from './lib/mock.mjs';
import { dayKey } from './lib/dates.mjs';
import { warningsFor } from './lib/warnings.mjs';

export function makeClient(config, root = '.', { token, log = console, logger = null } = {}) {
  return new GithubClient({
    token: token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '',
    cacheFile: path.join(stateDir(root), STATE_FILES.apiCache),
    logger: logger || log,
    // One problem should produce one warning, not one per endpoint.
    dedupeWarnings: true,
  });
}

export function resolveRepo(config, env = process.env, root = '.') {
  const slug = config.repo || detectRepo(config, env) || detectRepoFromGit(root);
  if (!slug) {
    throw new Error(
      'RivalMode could not work out which repo it is running in. Set `repo` in .rivalmode/config.json, or run inside GitHub Actions.'
    );
  }
  return parseRepoSlug(slug);
}

/** Mock mode still uses *your* repo name when it can work it out. */
function mockRepo(config, root) {
  const detected = config.repo || process.env.RIVALMODE_REPO || process.env.GITHUB_REPOSITORY || detectRepoFromGit(root);
  try {
    return parseRepoSlug(detected || 'you/your-repo');
  } catch {
    return parseRepoSlug('you/your-repo');
  }
}

function detectRepoFromGit(root) {
  try {
    const gitConfig = fs.readFileSync(path.join(root, '.git', 'config'), 'utf8');
    const match = gitConfig.match(/url\s*=\s*\S*github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

/**
 * @param {{root?:string, config?:object, slug?:object, client?:object, now?:number, log?:object, write?:boolean, mock?:boolean, force?:boolean}} options
 */
export async function run({
  root = '.',
  config: configOverride = null,
  slug = null,
  client = null,
  now = Date.now(),
  log = createLog(),
  write = true,
  mock = false,
  mode = 'full',
} = {}) {
  const config = configOverride || loadConfig(root);
  const useMock = mock || config.mock;
  const target = slug || (useMock ? mockRepo(config, root) : resolveRepo(config, process.env, root));
  const gh = client || makeClient(config, root, { logger: log });

  let snapshot;
  let rivals;
  let momentum;

  if (useMock) {
    const mocked = makeSnapshot({ now, repoSlug: target.slug, intensity: mockIntensity() });
    snapshot = mocked.snapshot;
    rivals = mocked.rivals;
    momentum = makeMomentum(snapshot, rivals, config.points);
  } else {
    snapshot = await collectSnapshot(gh, target, config, { log, now });

    // GitHub's events timeline is best-effort and often empty on a young repo.
    // Fall back to the events we have already seen and stored, so the feed is
    // "the last things that happened", not "the last things GitHub felt like
    // mentioning in the last few minutes".
    const storedFeed = readState(root, STATE_FILES.feed, { items: [] });
    if (storedFeed?.items?.length) {
      snapshot.feed = mergeFeed(storedFeed, snapshot.feed, Math.max(config.feed.limit, 10)).items;
    }

    const previousState = readState(root, STATE_FILES.rivals, null);
    if (mode === 'rivals' || mode === 'full') {
      rivals = await discoverRivals(gh, snapshot, config, { log, now, previous: previousState });
    } else if (previousState?.ranking) {
      // Reuse the last known ladder so the scoreboard stays consistent offline.
      rivals = { ...previousState, ranking: rebuildRanking(previousState, snapshot), reused: true };
    } else {
      rivals = null;
    }

    if (rivals?.ranking && !rivals.ranking.entries) {
      rivals.ranking = rebuildRanking(rivals, snapshot);
    }

    momentum = computeMomentum(snapshot, config.points, rivals);
  }

  const ranking = rivals?.ranking ?? rankCluster({ self: selfEntry(snapshot), rivals: [], limits: config.rivals });
  if (rivals?.ranking && !rivals.ranking.changes) {
    rivals.ranking.changes = { delta: null, passed: [], passedBy: [], entered: [], left: [] };
  }

  const warnings = warningsFor({ snapshot, rivals, client: gh, log });
  snapshot.warnings = warnings;

  const assets = config.outDir.replace(/^\.\//, '');
  const rendered = renderAll({
    snapshot,
    momentum,
    ranking,
    config,
    now,
    warnings,
  });

  const files = {};
  for (const [name, svg] of Object.entries(rendered.files)) {
    files[path.join(root, assets, name)] = svg;
  }

  const sections = buildSections({
    snapshot,
    momentum,
    ranking,
    rivals,
    config,
    points: config.points,
    assets,
    warnings,
  });

  const output = {
    snapshot,
    rivals,
    momentum,
    ranking,
    points: weeklyPoints(snapshot, config.points),
    warnings,
    files,
    sections,
    assets,
    changedFiles: [],
    readmeChanged: false,
  };

  if (write) {
    output.changedFiles = writeIfChanged(files);

    const readmeResult = writeReadme({
      root,
      readmePath: config.readme,
      sections,
    });
    output.readmeChanged = readmeResult.changed;
    if (readmeResult.changed) output.changedFiles.push(readmeResult.file);

    if (!useMock) {
      persistState({ root, snapshot, rivals, momentum, readmeChanged: readmeResult.changed, now });
    }
    gh.saveCache?.();
  }

  return output;
}

function persistState({ root, snapshot, rivals, momentum, readmeChanged, now }) {
  const date = dayKey(now);
  const previousMomentum = readState(root, STATE_FILES.momentum, { history: [] });
  const entry = {
    date,
    at: new Date(now).toISOString(),
    score: momentum.score,
    commits: snapshot.commits.today,
    stars: snapshot.counts.stars,
    rank: rivals?.ranking?.rank ?? null,
    clusterSize: rivals?.ranking?.clusterSize ?? null,
  };
  const history = appendMomentumHistory(previousMomentum, entry);
  writeIfChanged({ [statePath(root, STATE_FILES.momentum)]: history });

  const previousFeed = readState(root, STATE_FILES.feed, { items: [] });
  const feed = mergeFeed(previousFeed, snapshot.feed);
  writeIfChanged({ [statePath(root, STATE_FILES.feed)]: feed });

  if (rivals && !rivals.reused) {
    writeIfChanged({ [statePath(root, STATE_FILES.rivals)]: compactForState(rivals) });
  }

  void readmeChanged;
}

function mockIntensity() {
  const arg = process.argv.find((a) => a.startsWith('--intensity='));
  return arg ? Math.max(0.2, Number(arg.split('=')[1]) || 1) : 1;
}

function selfEntry(snapshot) {
  return {
    slug: snapshot.repo.slug,
    repo: snapshot.repo,
    stars: snapshot.counts.stars,
    forks: snapshot.counts.forks,
    velocity: snapshot.stars?.perDay ?? 0,
    velocityEstimated: false,
    commitsLast30: snapshot.commits?.month ?? 0,
  };
}

/** Rebuild a ranking object from compacted state without hitting the network. */
function rebuildRanking(state, snapshot) {
  const entries = (state.ranking?.entries || []).map((e) => {
    const isSelf = e.isSelf || e.slug === snapshot.repo.slug;
    if (isSelf) {
      return {
        ...e,
        isSelf: true,
        name: snapshot.repo.name,
        owner: snapshot.repo.owner,
        url: snapshot.repo.url,
        stars: snapshot.counts.stars,
        forks: snapshot.counts.forks,
        velocity: snapshot.stars?.perDay ?? 0,
        velocityEstimated: false,
        commitsLast30: snapshot.commits?.month ?? 0,
      };
    }
    return {
      ...e,
      isSelf: false,
      name: e.slug.split('/')[1],
      owner: e.slug.split('/')[0],
      url: `https://github.com/${e.slug}`,
    };
  });
  const selfIndex = entries.findIndex((e) => e.isSelf);
  entries.sort((a, b) => a.rank - b.rank);
  return {
    entries,
    self: entries[selfIndex] ?? null,
    rank: state.ranking?.rank ?? null,
    clusterSize: state.ranking?.clusterSize ?? entries.length,
    leaders: selfIndex > 0 ? entries.slice(0, selfIndex).slice(-5).reverse() : [],
    nextTarget: selfIndex > 0 ? entries[selfIndex - 1] : null,
    chasing: entries.slice(selfIndex + 1, selfIndex + 4),
    percentile: state.ranking?.percentile ?? null,
    podium: (state.ranking?.rank ?? 99) <= 3,
    changes: { delta: null, passed: [], passedBy: [], entered: [], left: [] },
    stale: true,
  };
}

export { safe };
