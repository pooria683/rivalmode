import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SECTIONS,
  buildSections,
  spliceSections,
  stripSections,
  wrap,
  writeReadme,
  markerStart,
  splitFences,
} from '../src/render_readme.mjs';
import { makeSnapshot, makeRivals, makeMomentum } from '../src/lib/mock.mjs';
import { DEFAULT_CONFIG } from '../src/lib/config.mjs';

const FIXED_NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
// Relative labels ("updated 4m ago") must not drift between runs, or the
// golden snapshot would need updating every hour.
process.env.RIVALMODE_NOW = String(FIXED_NOW);

function fixture(overrides = {}) {
  const { snapshot, rivals } = makeSnapshot({ now: FIXED_NOW, seed: 'readme' });
  const momentum = makeMomentum(snapshot, rivals, DEFAULT_CONFIG.points);
  const config = { ...DEFAULT_CONFIG, ...overrides.config };
  const sections = buildSections({
    snapshot,
    momentum,
    ranking: rivals.ranking,
    rivals,
    config,
    points: config.points,
    assets: config.outDir,
    warnings: overrides.warnings || [],
  });
  return { snapshot, momentum, rivals, config, sections };
}

test('every managed section is present and wrapped in matching markers', () => {
  const { sections } = fixture();
  assert.deepEqual(Object.keys(sections).sort(), [...SECTIONS].sort());
  for (const name of SECTIONS) {
    assert.ok(sections[name].length > 0, `${name} must not be empty`);
  }
});

test('README snapshot: the generated sections are stable', () => {
  const { sections } = fixture();
  const rendered = SECTIONS.map((name) => wrap(name, sections[name])).join('\n\n');
  const goldenPath = path.join(import.meta.dirname, 'golden', 'readme-sections.md');
  if (process.env.UPDATE_GOLDEN === '1' || !fs.existsSync(goldenPath)) {
    fs.writeFileSync(goldenPath, `${rendered}\n`);
  }
  assert.equal(rendered, fs.readFileSync(goldenPath, 'utf8').replace(/\n$/, ''));
});

test('generated README contains the numbers a reader cares about', () => {
  const { sections, snapshot, momentum, rivals } = fixture();
  const all = Object.values(sections).join('\n');
  assert.ok(all.includes(snapshot.repo.slug));
  assert.ok(all.includes(`#${rivals.ranking.rank} of ${rivals.ranking.clusterSize}`));
  assert.ok(all.includes(`${momentum.score}`));
  assert.ok(all.includes('assets/rivalmode/scoreboard.svg'));
  assert.ok(all.includes('Contributor of the week') === false, 'the recap owns that phrase');
  // The roast hook must survive into the README.
  assert.match(sections.rivals, /behind|ahead|top of the ladder/i);
});

test('splicing preserves human text around the markers', () => {
  const { sections } = fixture();
  const before = `# My project\n\nHand-written intro that must survive.\n\n${wrap('badges', 'old badges')}\n\nClosing thoughts.\n`;
  const after = spliceSections(before, sections);
  assert.ok(after.includes('Hand-written intro that must survive.'));
  assert.ok(after.includes('Closing thoughts.'));
  assert.ok(after.includes(markerStart('badges')));
  assert.ok(!after.includes('old badges'));
  assert.ok(after.includes(markerStart('scoreboard')), 'missing sections are appended');
});

test('splicing is idempotent', () => {
  const { sections } = fixture();
  const once = spliceSections('# t\n\nhello\n', sections);
  const twice = spliceSections(once, sections);
  assert.equal(once, twice);
});

test('splicing never appends the same section twice', () => {
  const { sections } = fixture();
  const once = spliceSections('', sections);
  const twice = spliceSections(once, sections);
  for (const name of SECTIONS) {
    const count = (twice.match(new RegExp(markerStart(name), 'g')) || []).length;
    assert.equal(count, 1, `${name} appears ${count} times`);
  }
});

test('stripSections removes everything and leaves the prose intact', () => {
  const { sections } = fixture();
  const doc = spliceSections('# Title\n\nIntro.\n\n## After\n\nOutro.\n', sections);
  const stripped = stripSections(doc);
  assert.ok(stripped.includes('# Title'));
  assert.ok(stripped.includes('Intro.'));
  assert.ok(stripped.includes('Outro.'));
  assert.ok(!stripped.includes('rivalmode:start'));
  assert.ok(!stripped.includes('assets/rivalmode'));
});

test('missing sections are appended in a readable order', () => {
  const { sections } = fixture();
  const doc = spliceSections('# t\n', sections);
  const order = ['badges', 'scoreboard', 'rivals', 'team', 'feed', 'conquests', 'footer'].map((n) =>
    doc.indexOf(markerStart(n))
  );
  assert.ok(order.every((i) => i >= 0), 'all sections present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections appear in the documented order');
});

test('degraded runs say so instead of showing a fake zero rank', () => {
  const { snapshot, momentum, config } = fixture();
  const sections = buildSections({
    snapshot,
    momentum,
    ranking: null,
    rivals: { enabled: false, forks: [], fans: [], ranking: null },
    config,
    points: config.points,
    assets: config.outDir,
    warnings: ['rate limit reached'],
  });
  assert.match(sections.scoreboard, /Unranked/);
  assert.match(sections.scoreboard, /rate limit reached/);
  assert.match(sections.rivals, /Rival tracking is off/);
});

test('a repo that is #1 gets a brag, not a bug', () => {
  const { snapshot, momentum, rivals, config } = fixture();
  const top = { ...rivals.ranking, rank: 1, leaders: [], chasing: rivals.ranking.entries.filter((e) => !e.isSelf) };
  const sections = buildSections({ snapshot, momentum, ranking: top, rivals, config, points: config.points, assets: config.outDir });
  assert.match(sections.scoreboard, /You are #1/);
  assert.match(sections.rivals, /top of the ladder/i);
});

test('markers inside a fenced code block are documentation, not sections', () => {
  const { sections } = fixture();
  const documented = [
    '# t',
    '',
    '```markdown',
    '<!-- rivalmode:start scoreboard -->',
    '...generated...',
    '<!-- rivalmode:end scoreboard -->',
    '```',
    '',
    'Real section follows:',
    '',
    wrap('badges', 'old badges'),
    '',
  ].join('\n');

  const out = spliceSections(documented, sections);
  // The example block must survive byte for byte.
  assert.ok(out.includes('```markdown\n<!-- rivalmode:start scoreboard -->\n...generated...\n<!-- rivalmode:end scoreboard -->\n```'));
  // The real section was replaced.
  assert.ok(!out.includes('old badges'));
  // Exactly one *live* scoreboard section.
  const live = splitFences(out).filter((seg) => !seg.fenced && seg.text.includes(markerStart('scoreboard'))).length;
  assert.equal(live, 1);
});

test('splitFences round-trips a document unchanged', () => {
  const doc = 'a\n\n```js\nconst x = 1;\n```\n\nb\n~~~\nplain\n~~~\nend';
  const rejoined = splitFences(doc).map((s) => s.text).join('');
  assert.equal(rejoined, doc);
  const fenced = splitFences(doc).filter((s) => s.fenced);
  assert.equal(fenced.length, 2);
});

test('uninstall restores a README that setup scaffolded', () => {
  const { sections } = fixture();
  const original = '# My project\n\nHand-written intro.\n';
  const installed = spliceSections(original, sections);
  assert.ok(installed.includes('## ⚔️ The ladder'));
  const stripped = stripSections(installed);
  assert.equal(stripped, original, 'uninstall must leave the README exactly as it found it');
  assert.ok(!stripped.includes('<table'), 'empty table wrappers are removed');
  assert.ok(!stripped.includes('<table'), 'empty table wrappers are removed');
});

test('uninstall keeps a heading a human actually used', () => {
  const { sections } = fixture();
  const original = '# t\n\n## ⚔️ The ladder\n\nMy own words about ladders.\n';
  const stripped = stripSections(spliceSections(original, sections));
  assert.ok(stripped.includes('## ⚔️ The ladder'));
  assert.ok(stripped.includes('My own words about ladders.'));
});

test('writeReadme only writes when bytes change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rivalmode-readme-'));
  const { sections } = fixture();
  const first = writeReadme({ root: dir, sections });
  assert.equal(first.changed, true);
  const second = writeReadme({ root: dir, sections });
  assert.equal(second.changed, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('counts read like English, not like a database dump', () => {
  const { snapshot, momentum, rivals, config } = fixture();
  const one = {
    ...momentum,
    current: { ...momentum.current, commits: 1 },
    previous: { ...momentum.previous, commits: 0 },
  };
  const sections = buildSections({
    snapshot: { ...snapshot, commits: { ...snapshot.commits, streak: 1 } },
    momentum: one,
    ranking: rivals.ranking,
    rivals,
    config,
    points: config.points,
    assets: config.outDir,
  });
  assert.ok(sections.scoreboard.includes('1 commit this week vs 0 last week'), sections.scoreboard);
  assert.ok(!sections.scoreboard.includes('1 commits'));
  // The badge is an image; what we can assert on is its alt text.
  assert.ok(!sections.badges.includes('1 days'));
  assert.ok(sections.badges.includes('commit streak 1d'));
});

test('markdown escaping keeps feed lines readable', () => {
  const { snapshot, momentum, rivals, config } = fixture();
  const withTricky = {
    ...snapshot,
    feed: [{ type: 'PushEvent', actor: 'x', at: snapshot.generatedAt, text: 'fix: a_b * c', detail: 'ok' }],
  };
  const sections = buildSections({
    snapshot: withTricky,
    momentum,
    ranking: rivals.ranking,
    rivals,
    config,
    points: config.points,
    assets: config.outDir,
  });
  assert.ok(sections.feed.includes('a\\_b'), 'underscores are escaped');
  assert.ok(!sections.feed.includes('\\(ok\\)'), 'parentheses are left alone');
});
