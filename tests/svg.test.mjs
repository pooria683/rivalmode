import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  escapeXml,
  textWidth,
  fitText,
  formatCount,
  formatSigned,
  bar,
  seededRandom,
  svgDocument,
  pill,
} from '../src/svg/primitives.mjs';
import { renderScoreboard, renderActivityChart } from '../src/svg/scoreboard.mjs';
import { renderRivals } from '../src/svg/rivals.mjs';
import { renderContributorBars, renderFeed, formatRelative } from '../src/svg/bars.mjs';
import { renderBadge, badgeSpecs, momentumColor } from '../src/svg/badges.mjs';
import { loadTheme, listThemes, validateTheme, colorFor } from '../src/lib/theme.mjs';
import { makeSnapshot, makeRivals, makeMomentum } from '../src/lib/mock.mjs';
import { renderAll } from '../src/render.mjs';
import { DEFAULT_CONFIG } from '../src/lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(HERE, 'golden');
const FIXED_NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
process.env.RIVALMODE_NOW = String(FIXED_NOW);

function fixedFixture() {
  const { snapshot, rivals } = makeSnapshot({ now: FIXED_NOW, seed: 'golden' });
  const momentum = makeMomentum(snapshot, rivals, DEFAULT_CONFIG.points);
  const ranking = { ...rivals.ranking, changes: { passed: [], passedBy: [], entered: [], left: [], delta: 0 } };
  return { snapshot, momentum, ranking, rivals };
}

/* ------------------------------------------------------------- primitives --- */

test('escapeXml neutralises markup, quotes and control characters', () => {
  assert.equal(escapeXml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeXml("it's"), 'it&apos;s');
  assert.equal(escapeXml('a\u0000b'), 'ab');
  assert.equal(escapeXml(undefined), '');
});

test('textWidth is monotonic and honours mono', () => {
  assert.ok(textWidth('MMMM') > textWidth('iiii'));
  assert.ok(textWidth('abcdefgh', 12, { mono: true }) > 0);
  assert.ok(textWidth('bold', 12, { bold: true }) > textWidth('bold', 12));
});

test('fitText truncates with an ellipsis inside the budget', () => {
  const long = 'a very long repository description that will not fit anywhere';
  const fitted = fitText(long, 120, 12);
  assert.ok(fitted.endsWith('…'));
  assert.ok(textWidth(fitted, 12) <= 120);
  assert.equal(fitText('short', 200), 'short');
});

test('formatCount and formatSigned read like a human wrote them', () => {
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1200), '1.2k');
  assert.equal(formatCount(1_500_000), '1.5M');
  assert.equal(formatSigned(42), '+42');
  assert.equal(formatSigned(-1200), '-1.2k');
  assert.equal(formatSigned(0), '0');
});

test('bar clamps ratios and never emits negative widths', () => {
  const svg = bar(0, 0, 100, 10, -5, { fill: '#0f0' });
  assert.ok(!svg.includes('width="-'));
  const over = bar(0, 0, 100, 10, 99, { fill: '#0f0' });
  assert.ok(!/width="9\d{3}/.test(over));
});

test('seededRandom is deterministic per seed', () => {
  const a = seededRandom('rivalmode');
  const b = seededRandom('rivalmode');
  const picks = (fn) => [fn(), fn(), fn()];
  assert.deepEqual(picks(a), picks(b));
});

/* ----------------------------------------------------------------- themes --- */

test('every shipped theme is valid and complete', () => {
  for (const name of listThemes()) {
    const theme = loadTheme(name);
    assert.ok(theme.background.startsWith('#'), `${name}: background must be a hex colour`);
    assert.ok(Array.isArray(theme.barColors) && theme.barColors.length >= 4, `${name}: needs bar colours`);
  }
});

test('validateTheme rejects incomplete themes with a useful message', () => {
  assert.throws(() => validateTheme({ background: '#000' }), /missing/);
});

test('loadTheme falls back to midnight for an unknown name', () => {
  const theme = loadTheme('does-not-exist');
  assert.equal(theme.label, 'Midnight');
});

test('colorFor is stable for the same contributor', () => {
  const theme = loadTheme('midnight');
  assert.equal(colorFor(theme, 0, 'pooria683'), colorFor(theme, 0, 'pooria683'));
  assert.ok(theme.barColors.includes(colorFor(theme, 3, 'mialee')));
});

/* --------------------------------------------------------------- renderers --- */

test('scoreboard renders every stat and is valid XML-ish', () => {
  const { snapshot, momentum, ranking } = fixedFixture();
  const theme = loadTheme('midnight');
  const { svg, width, height } = renderScoreboard({ snapshot, momentum, ranking, theme, now: FIXED_NOW });
  assert.equal(width, 860);
  assert.ok(height > 300);
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('rivalmode'));
  assert.ok(svg.includes('ACTIVITY'));
  assert.ok(svg.includes('MOMENTUM'));
  // Balanced text/rect tags catch most accidental markup bugs.
  assert.equal((svg.match(/<text /g) || []).length, (svg.match(/<\/text>/g) || []).length);
  assert.ok((svg.match(/<rect /g) || []).length > 20);
});

test('scoreboard has a fixed height for a given snapshot (layout stability)', () => {
  const { snapshot, momentum, ranking } = fixedFixture();
  const theme = loadTheme('paper');
  const a = renderScoreboard({ snapshot, momentum, ranking, theme, now: FIXED_NOW });
  const b = renderScoreboard({ snapshot, momentum, ranking, theme, now: FIXED_NOW + 5 * 3600 * 1000 });
  assert.equal(a.height, b.height, 'time passing must not reflow the card');
});

test('scoreboard shows warnings verbatim', () => {
  const { snapshot, momentum, ranking } = fixedFixture();
  const { svg } = renderScoreboard({
    snapshot,
    momentum,
    ranking,
    theme: loadTheme('midnight'),
    now: FIXED_NOW,
    warnings: ['rate limit reached', 'private repo'],
  });
  assert.ok(svg.includes('rate limit reached'));
});

test('activity chart renders nothing for an empty window (not a crash)', () => {
  assert.equal(renderActivityChart({}, loadTheme('midnight'), { x: 0, y: 0, w: 100, h: 50 }).markup, '');
});

test('rivals card highlights you and survives an empty cluster', () => {
  const { ranking } = fixedFixture();
  const theme = loadTheme('synthwave');
  const { svg } = renderRivals({ ranking, theme });
  assert.ok(svg.includes('(you)'));
  assert.ok(svg.includes('RIVAL LADDER'));

  const empty = renderRivals({ ranking: { entries: [], rank: null, clusterSize: 0 }, theme });
  assert.ok(empty.svg.includes('No rivals yet'));

  const noRanking = renderRivals({ ranking: null, theme });
  assert.ok(noRanking.svg.includes('Rival search is off'));
});

test('rivals card does not emit escaped markup in its footer', () => {
  const { ranking } = fixedFixture();
  const { svg } = renderRivals({ ranking, theme: loadTheme('midnight') });
  assert.ok(!svg.includes('&lt;tspan'));
  assert.ok(svg.includes('no rank changes since last run'));
});

test('contributor bars degrade to an empty state', () => {
  const theme = loadTheme('midnight');
  const { svg } = renderContributorBars({ snapshot: { leaderboard: [], generatedAt: new Date(FIXED_NOW).toISOString() }, theme });
  assert.ok(svg.includes('No commits this month'));
});

test('feed renders relative timestamps and empty state', () => {
  const theme = loadTheme('terminal');
  const { snapshot } = fixedFixture();
  const { svg } = renderFeed({ snapshot, theme });
  assert.ok(svg.includes('LIVE FEED'));
  const empty = renderFeed({ snapshot: { feed: [], generatedAt: snapshot.generatedAt }, theme });
  assert.ok(empty.svg.includes('Nothing yet'));
  assert.equal(formatRelative(new Date(FIXED_NOW - 90000).toISOString(), FIXED_NOW), '1m');
});

/* ----------------------------------------------------------------- badges --- */

test('badge is a self-contained 20px shield', () => {
  const svg = renderBadge({ label: 'momentum', value: '+42 on fire', color: '#4c1' });
  assert.ok(svg.includes('height="20"'));
  assert.ok(svg.includes('momentum'));
  assert.ok(svg.includes('+42 on fire'));
  assert.ok(svg.includes('role="img"'));
  assert.ok(!svg.includes('href="http'), 'badges must not fetch external resources (Camo would block them)');
});

test('badge escapes hostile labels', () => {
  const svg = renderBadge({ label: '<img src=x>', value: '"quoted"', color: '#000' });
  assert.ok(!svg.includes('<img src=x>'));
  assert.ok(svg.includes('&lt;img src=x&gt;'));
});

test('badge colours follow momentum', () => {
  assert.equal(momentumColor(80), '#4c1');
  assert.equal(momentumColor(0), '#9a6700');
  assert.equal(momentumColor(-90), '#cf222e');
});

test('badgeSpecs produces the five README badges', () => {
  const { snapshot, momentum, ranking } = fixedFixture();
  const specs = badgeSpecs({ momentum, ranking, snapshot, license: 'MIT' });
  assert.deepEqual(
    specs.map((s) => s.file),
    ['momentum.svg', 'rank.svg', 'streak.svg', 'score.svg', 'license.svg']
  );
  assert.ok(specs[1].spec.value.startsWith('#'));
});

/* ---------------------------------------------------------------- goldens --- */

test('renderAll emits every expected file and nothing external', () => {
  const { snapshot, momentum, ranking } = fixedFixture();
  const { files } = renderAll({ snapshot, momentum, ranking, config: { ...DEFAULT_CONFIG, theme: 'midnight' }, now: FIXED_NOW });
  assert.deepEqual(Object.keys(files).sort(), [
    'contributors.svg',
    'feed.svg',
    'license.svg',
    'momentum.svg',
    'rank.svg',
    'rivals.svg',
    'score.svg',
    'scoreboard.svg',
    'streak.svg',
  ]);
  for (const [name, svg] of Object.entries(files)) {
    assert.ok(svg.startsWith('<svg'), `${name} must start with <svg`);
    assert.ok(!/@import|url\(http|<script/i.test(svg), `${name} must not pull in external or active content`);
  }
});

test('golden files match the committed snapshots', (t) => {
  const { snapshot, momentum, ranking } = fixedFixture();
  const { files } = renderAll({ snapshot, momentum, ranking, config: { ...DEFAULT_CONFIG, theme: 'midnight' }, now: FIXED_NOW });
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  if (process.env.UPDATE_GOLDEN === '1') {
    for (const [name, svg] of Object.entries(files)) {
      fs.writeFileSync(path.join(GOLDEN_DIR, name), `${svg}\n`);
    }
    t.diagnostic('golden files updated');
    return;
  }

  for (const [name, svg] of Object.entries(files)) {
    const golden = path.join(GOLDEN_DIR, name);
    if (!fs.existsSync(golden)) {
      fs.writeFileSync(golden, `${svg}\n`);
      t.diagnostic(`created missing golden ${name}`);
      continue;
    }
    assert.equal(svg, fs.readFileSync(golden, 'utf8').replace(/\n$/, ''), `golden mismatch in ${name} (run UPDATE_GOLDEN=1 npm test)`);
  }
});

test('svgDocument escapes the title and sets a viewBox', () => {
  const svg = svgDocument({ width: 10, height: 10, theme: loadTheme('paper'), body: '', title: 'a & b <c>' });
  assert.ok(svg.includes('viewBox="0 0 10 10"'));
  assert.ok(svg.includes('a &amp; b &lt;c&gt;'));
});

test('pill measures itself around its label', () => {
  const wide = pill(0, 0, 'a long status label');
  const narrow = pill(0, 0, 'ok');
  assert.ok(wide.width > narrow.width);
});
