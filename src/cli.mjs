#!/usr/bin/env node
/**
 * RivalMode CLI.
 *
 *   node src/cli.mjs scoreboard        # hourly job: numbers, cards, README
 *   node src/cli.mjs rivals            # daily job: rival discovery + ladder
 *   node src/cli.mjs recap             # weekly job: write the recap markdown
 *   node src/cli.mjs setup             # install into this repo (idempotent)
 *   node src/cli.mjs uninstall         # remove everything it wrote
 *   node src/cli.mjs doctor            # check token, permissions, config
 *
 * Flags: --root=DIR --mock --intensity=1.4 --theme=paper --json --no-write
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from './pipeline.mjs';
import { createLog } from './lib/collect.mjs';
import { loadConfig, saveConfig, parseRepoSlug, DEFAULT_CONFIG, HOME_DIR } from './lib/config.mjs';
import { listThemes } from './lib/theme.mjs';
import { buildRecap, recapMarkdown } from './recap.mjs';
import { setupRepo, uninstallRepo } from './setup.mjs';
import { STATE_FILES, readState } from './lib/state.mjs';

const argv = process.argv.slice(2);
const command = (argv.find((a) => !a.startsWith('-')) || 'help').toLowerCase();
const flags = parseFlags(argv);

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  if (flags.has('debug')) console.error(err.stack);
  process.exit(1);
});

async function main() {
  const root = path.resolve(flags.get('root') || '.');

  switch (command) {
    case 'scoreboard':
    case 'rivals':
    case 'full':
      return runPipeline(root);
    case 'recap':
      return runRecap(root);
    case 'setup':
      return runSetup(root);
    case 'uninstall':
      return runUninstall(root);
    case 'themes':
      return printThemes();
    case 'doctor':
      return runDoctor(root);
    case 'help':
    case '--help':
    case '-h':
      return printHelp();
    default:
      throw new Error(`unknown command "${command}" — try \`node src/cli.mjs help\``);
  }
}

async function runPipeline(root) {
  const log = createLog(flags.has('json'));
  const config = loadConfig(root);
  if (flags.get('theme')) config.theme = flags.get('theme');

  const started = Date.now();
  const result = await run({
    root,
    config,
    now: Date.now(),
    log,
    write: !flags.has('no-write'),
    mock: flags.has('mock'),
    mode: command === 'rivals' ? 'rivals' : command === 'full' ? 'full' : 'scoreboard',
  });

  const payload = {
    ok: true,
    mode: command,
    repo: result.snapshot.repo.slug,
    momentum: result.momentum.score,
    rank: result.ranking?.rank ?? null,
    clusterSize: result.ranking?.clusterSize ?? null,
    changedFiles: result.changedFiles.map((f) => path.relative(root, f)),
    readmeChanged: result.readmeChanged,
    warnings: result.warnings,
    elapsedMs: Date.now() - started,
  };

  if (flags.has('json')) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('');
    console.log(`⚔  ${payload.repo}`);
    console.log(`   momentum ${result.momentum.score > 0 ? '+' : ''}${result.momentum.score} (${result.momentum.label})`);
    console.log(`   rank     ${payload.rank ? `#${payload.rank} of ${payload.clusterSize}` : 'unranked'}`);
    console.log(`   today    ${result.snapshot.commits.today} commits · ${result.snapshot.commits.streak}d streak`);
    console.log(`   wrote    ${payload.changedFiles.length} file(s)${payload.readmeChanged ? ' (README updated)' : ''}`);
    for (const warning of result.warnings) console.log(`   ! ${warning}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        `### RivalMode \`${command}\``,
        '',
        `| | |`,
        `|---|---|`,
        `| Repo | \`${payload.repo}\` |`,
        `| Momentum | **${result.momentum.score}** (${result.momentum.label}) |`,
        `| Rank | ${payload.rank ? `#${payload.rank} of ${payload.clusterSize}` : 'unranked'} |`,
        `| Commits today | ${result.snapshot.commits.today} |`,
        `| Streak | ${result.snapshot.commits.streak} days |`,
        `| Files written | ${payload.changedFiles.length} |`,
        ...(payload.warnings.length ? ['', '**Warnings**', ...payload.warnings.map((w) => `- ${w}`)] : []),
        '',
      ].join('\n')
    );
  }

  const outFile = flags.get('out');
  if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
}

async function runRecap(root) {
  const config = loadConfig(root);
  const log = createLog(flags.has('json'));
  const rivalsState = readState(root, STATE_FILES.rivals, null);
  const momentumState = readState(root, STATE_FILES.momentum, { history: [] });
  const feedState = readState(root, STATE_FILES.feed, { items: [] });

  // The recap reads committed state, so it works even if APIs are down today.
  const result = await run({
    root,
    config,
    log,
    write: false,
    mock: flags.has('mock'),
    mode: 'scoreboard',
  });

  const recap = buildRecap({
    snapshot: result.snapshot,
    momentum: result.momentum,
    ranking: result.ranking,
    rivals: rivalsState,
    history: momentumState.history || [],
    feed: feedState.items || [],
    config,
    now: Date.now(),
  });
  const markdown = recapMarkdown(recap, { config, snapshot: result.snapshot });

  const outFile = path.resolve(root, flags.get('out') || 'tmp/recap.md');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, markdown);

  if (flags.has('json')) console.log(JSON.stringify({ ok: true, file: outFile, recap }, null, 2));
  else console.log(`✎ wrote ${path.relative(root, outFile)} (${markdown.length} chars)`);
}

function runSetup(root) {
  const result = setupRepo(root, {
    repo: flags.get('repo') || '',
    theme: flags.get('theme') || '',
    title: flags.get('title') || '',
    readme: flags.get('readme') || '',
    force: flags.has('force'),
    private: flags.has('private') ? true : undefined,
  });
  if (flags.has('json')) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  console.log(`\n⚔  RivalMode installed into ${path.basename(root)}`);
  for (const line of result.log) console.log(`   ${line}`);
  console.log(`\n   Next: commit and push. The first scoreboard lands within one workflow run.`);
  console.log(`   Local preview without network: node src/cli.mjs scoreboard --mock\n`);
}

function runUninstall(root) {
  const result = uninstallRepo(root, { dryRun: flags.has('dry-run') });
  if (flags.has('json')) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  console.log(`\n⚔  RivalMode removed from ${path.basename(root)}`);
  for (const line of result.log) console.log(`   ${line}`);
  console.log('');
}

function printThemes() {
  const themes = listThemes();
  if (flags.has('json')) {
    console.log(JSON.stringify(themes));
    return;
  }
  console.log(`\nAvailable themes: ${themes.join(', ')}`);
  console.log(`Set one with: node src/cli.mjs setup --theme=<name>\n`);
}

async function runDoctor(root) {
  const { GithubClient } = await import('./lib/github.mjs');
  const config = loadConfig(root);
  const client = new GithubClient({ token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '' });
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

  check('node >= 20', Number(process.versions.node.split('.')[0]) >= 20, process.versions.node);
  check('token present', client.authenticated, client.authenticated ? 'GITHUB_TOKEN / GH_TOKEN found' : 'no token: rate limit is 60 req/hour');

  let repo = null;
  try {
    const slug = parseRepoSlug(config.repo || process.env.GITHUB_REPOSITORY || 'pooria683/rivalmode');
    repo = await client.get(`/repos/${slug.owner}/${slug.name}`);
    check(`read ${slug.slug}`, Boolean(repo), repo ? `stars ${repo.stargazers_count}` : 'not readable');
    if (repo) {
      check('rival search available', !repo.private, repo.private ? 'private: degraded mode' : 'public repo');
      check('topics set', (repo.topics || []).length > 0, (repo.topics || []).join(', ') || 'no topics — the ladder needs at least one');
    }
  } catch (err) {
    check('repo lookup', false, err.message);
  }

  check('config exists', fs.existsSync(path.join(root, HOME_DIR, 'config.json')), '.rivalmode/config.json');
  const themes = listThemes();
  check('theme exists', themes.includes(config.theme), `${config.theme} (${themes.length} installed)`);

  const stats = client.stats();
  check('API budget', stats.remaining === null || stats.remaining > 50, `${stats.remaining ?? '?'} remaining`);

  if (flags.has('json')) {
    console.log(JSON.stringify({ ok: checks.every((c) => c.ok), checks }, null, 2));
    return;
  }
  console.log('');
  for (const c of checks) console.log(`   ${c.ok ? '✔' : '✖'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log('');
}

function printHelp() {
  console.log(`
⚔  RivalMode — gamify any GitHub repo, rendered in its own README.

   node src/cli.mjs setup        install: config, workflows, README sections
   node src/cli.mjs scoreboard   hourly job (numbers, cards, README)
   node src/cli.mjs rivals       daily job (rival discovery, ladder)
   node src/cli.mjs recap        weekly job (writes tmp/recap.md)
   node src/cli.mjs doctor       check token, repo access, topics, theme
   node src/cli.mjs themes       list installed themes
   node src/cli.mjs uninstall    remove everything RivalMode wrote

   Flags
   --root=DIR        run against another checkout
   --mock            use deterministic sample data (no network)
   --theme=NAME      override the theme for this run
   --no-write        render and report, change nothing on disk
   --json            machine-readable output
   --out=FILE        write the post-run JSON summary / recap markdown

   Examples
   node src/cli.mjs scoreboard --mock --theme=synthwave --out=tmp/run.json
   node src/cli.mjs rivals --root=../my-project
`);
  void saveConfig;
  void DEFAULT_CONFIG;
}

function parseFlags(list) {
  const map = new Map();
  for (const raw of list) {
    if (!raw.startsWith('--')) continue;
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    map.set(key, rest.length ? rest.join('=') : true);
  }
  return {
    get: (key) => map.get(key),
    has: (key) => map.has(key),
  };
}
