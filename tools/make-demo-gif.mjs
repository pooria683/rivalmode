/**
 * Builds the animated demo GIF for the README.
 *
 * It is a real render of RivalMode's own SVG cards — not a screenshot, not a
 * mockup — driven through a scripted timeline: a push arrives, the numbers move,
 * then a rival overtakes and the card roasts you about it.
 *
 *   node tools/make-demo-gif.mjs
 *
 * Needs the devDependencies (@resvg/resvg-js, gifenc). The runtime never does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;
import { renderScoreboard } from '../src/svg/scoreboard.mjs';
import { loadTheme } from '../src/lib/theme.mjs';
import { computeMomentum } from '../src/lib/score.mjs';
import { FONT_SANS, rect, text, circle } from '../src/svg/primitives.mjs';
import { dayKeysBetween } from '../src/lib/dates.mjs';

const FRAME_SIZE = 640; // 760 at 1:1, scaled down to keep the GIF light
const W = FRAME_SIZE;
const H = Math.round((FRAME_SIZE / 760) * 486);
const CHROME = 36;
const PAD = 20;
const SCALE = 2; // supersample for smoother text, then box-downscale in the encoder
const FPS = 6;
const OUT = path.join('assets', 'demo', 'rivalmode-demo.gif');
const TOAST_Y = Math.round((FRAME_SIZE / 760) * 404);

const theme = loadTheme('midnight');
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);

/* ------------------------------------------------------------- timeline --- */

// Durations, in order: sit idle, a push lands, the card is committed, then a
// rival overtakes and the README tells you about it.
const STAGES = [
  { until: 1.3, kind: 'idle' },
  { until: 2.3, kind: 'push' },
  { until: 1.0, kind: 'rival' },
  { until: 2.4, kind: 'roast' },
];

const TOTAL_SECONDS = STAGES.reduce((sum, s) => sum + s.until, 0);

function stageAt(t) {
  let acc = 0;
  for (const stage of STAGES) {
    acc += stage.until;
    if (t <= acc) return stage.kind;
  }
  return STAGES[STAGES.length - 1].kind;
}

function frames() {
  const out = [];
  const count = Math.round(TOTAL_SECONDS * FPS);
  for (let i = 0; i < count; i += 1) {
    const t = i / FPS;
    out.push({ t, stage: stageAt(t) });
  }
  return out;
}

/* ---------------------------------------------------------------- data --- */

const baseActivity = (() => {
  const keys = dayKeysBetween(new Date(NOW - 29 * 86400000), new Date(NOW));
  const pattern = [3, 1, 4, 6, 2, 7, 5, 3, 8, 4, 2, 6, 9, 5, 3, 7, 4, 2, 5, 8, 6, 3, 7, 9, 4, 6, 8, 5, 7];
  return Object.fromEntries(keys.map((k, i) => [k, pattern[i % pattern.length]]));
})();

const MESSAGES = [
  'feat(svg): momentum gauge with a streak bonus',
  'fix: don’t crash when search rate-limits',
  'feat(rivals): catch forks that out-commit you',
  'test: golden snapshot for the scoreboard',
  'feat: roast line when a rival overtakes',
];

function snapshotFor(frame) {
  const step = frame.stage === 'idle' ? 0 : frame.stage === 'push' ? 1 : 2;
  const activity = { ...baseActivity };
  const todayKey = dayKeysBetween(new Date(NOW), new Date(NOW))[0];
  activity[todayKey] = step === 0 ? 2 : step === 1 ? 7 : 11;
  const last7 = Object.values(activity).slice(-7).reduce((a, b) => a + b, 0);
  const prev7 = Object.values(activity).slice(-14, -7).reduce((a, b) => a + b, 0);
  const progress = Math.min(1, frame.t / TOTAL_SECONDS);

  return {
    schema: 1,
    generatedAt: new Date(NOW - 40 * 1000).toISOString(),
    repo: {
      owner: 'you',
      name: 'your-repo',
      slug: 'you/your-repo',
      topics: ['github-actions', 'readme'],
      language: 'JavaScript',
      license: 'MIT',
      stars: 184 + Math.round(progress * 12),
    },
    degraded: false,
    private: false,
    counts: {
      branches: 6 + step,
      openPRs: 3,
      openIssues: 5,
      stars: 184 + Math.round(progress * 12),
      forks: 12,
      watchers: 9,
      contributors: 6,
    },
    commits: {
      today: activity[todayKey],
      week: last7,
      month: last7 + 40,
      last7,
      prev7,
      byDay: activity,
      streak: 6 + step,
      truncated: false,
      latest: step === 0
        ? { at: new Date(NOW - 42 * 60000).toISOString(), name: 'mialee', message: MESSAGES[0] }
        : { at: new Date(NOW - 30000).toISOString(), name: 'you', message: MESSAGES[Math.min(step, MESSAGES.length - 1)] },
      authors: [],
    },
    merges: { last30: 41, today: 2, week: 11, perDay: 1.4, byDay: {}, recent: [] },
    stars: { total: 184, last30: 26, perDay: 0.87, recent: [], truncated: false },
    issues: { last30: 9, last7: 3, recent: [] },
    releases: [],
    leaderboard: [],
    activity,
    feed: [],
    warnings: [],
  };
}

function rankingFor(frame) {
  const overtaken = frame.stage === 'rival' || frame.stage === 'roast';

  const self = {
    slug: 'you/your-repo',
    name: 'your-repo',
    stars: 184,
    velocity: 0.87,
    commitsLast30: 57,
    isSelf: true,
    rank: overtaken ? 4 : 3,
  };
  // The script: you sit at #3 on 0.87★/day. nova-labs is just behind you at
  // 0.79 and then gets a burst to 1.06 — enough to pass you, which is the moment
  // the README tells you about it.
  const others = [
    { slug: 'acme/scoreboard-kit', name: 'scoreboard-kit', stars: 412, velocity: 2.17, commitsLast30: 71 },
    { slug: 'tinyfish/readme-runner', name: 'readme-runner', stars: 331, velocity: 1.61, commitsLast30: 44 },
    { slug: 'nova-labs/repo-hype', name: 'repo-hype', stars: 289, velocity: overtaken ? 1.06 : 0.79, commitsLast30: overtaken ? 46 : 38 },
    { slug: 'grainstack/devboard', name: 'devboard', stars: 240, velocity: 0.71, commitsLast30: 30 },
    { slug: 'hexbyte/trophywall', name: 'trophywall', stars: 190, velocity: 0.62, commitsLast30: 21 },
    { slug: 'quietpixel/live-badges', name: 'live-badges', stars: 121, velocity: 0.4, commitsLast30: 15 },
  ];

  const entries = [...others, self]
    .map((e) => ({ ...e, isSelf: e.slug === self.slug }))
    .sort((a, b) => b.velocity - a.velocity)
    .map((e, i) => ({ ...e, rank: i + 1 }));
  const selfIndex = entries.findIndex((e) => e.isSelf);

  return {
    entries,
    self: entries[selfIndex],
    rank: entries[selfIndex].rank,
    clusterSize: entries.length,
    leaders: entries.slice(0, selfIndex).slice(-3).reverse(),
    nextTarget: selfIndex > 0 ? entries[selfIndex - 1] : null,
    chasing: entries.slice(selfIndex + 1, selfIndex + 3),
    percentile: 60,
    podium: false,
    changes: overtaken ? { passed: [], passedBy: [{ slug: 'nova-labs/repo-hype' }] } : { passed: [], passedBy: [] },
  };
}

/* ---------------------------------------------------------------- frames --- */

function momentumFor(frame) {
  const snapshot = snapshotFor(frame);
  return computeMomentum(snapshot, undefined, {
    summary: { passed: 0, passedBy: frame.stage === 'rival' || frame.stage === 'roast' ? 1 : 0 },
  });
}

function chromeMarkup(frame) {
  const parts = [];
  parts.push(rect(0, 0, W, H, { fill: theme.background }));
  // window chrome
  parts.push(rect(0, 0, W, CHROME, { fill: theme.panel }));
  parts.push('<line x1="0" y1="' + CHROME + '" x2="' + W + '" y2="' + CHROME + '" stroke="' + theme.border + '" stroke-width="1"/>');
  ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
    parts.push(circle(18 + i * 18, CHROME / 2, 5, { fill: color }));
  });
  // url bar
  const url = 'github.com/you/your-repo';
  const barW = 300;
  parts.push(rect(W / 2 - barW / 2, 9, barW, 18, { fill: theme.background, rx: 9, stroke: theme.border }));
  parts.push(text(url, W / 2, 22, { size: 11, fill: theme.muted, anchor: 'middle', mono: true }));

  // file header
  const headerY = CHROME + 20;
  parts.push(text('README.md', PAD, headerY + 4, { size: 12, fill: theme.muted, weight: 700, letterSpacing: '0.6' }));
  parts.push(circle(PAD + 88, headerY, 3.5, { fill: frame.stage === 'idle' ? theme.muted : theme.good }));
  parts.push(
    text(frame.stage === 'idle' ? 'waiting for a push' : 'bot committed 12s ago', PAD + 98, headerY + 4, {
      size: 11,
      fill: frame.stage === 'idle' ? theme.muted : theme.good,
    })
  );
  // right-hand "live" pill
  const liveW = 64;
  parts.push(rect(W - PAD - liveW, headerY - 11, liveW, 20, { fill: theme.panel, rx: 10, stroke: theme.border }));
  parts.push(circle(W - PAD - liveW + 12, headerY - 1, 3, { fill: theme.bad, opacity: 0.9 }));
  parts.push(text('LIVE', W - PAD - liveW + 22, headerY + 3, { size: 9.5, fill: theme.muted, weight: 700, letterSpacing: '1' }));

  // footer note
  parts.push(
    text('rendered by a GitHub Action · no servers, no tokens, no accounts', PAD, H - 10, {
      size: 10.5,
      fill: theme.muted,
      opacity: 0.8,
    })
  );
  parts.push(text('rivalmode', W - PAD, H - 10, { size: 10.5, fill: theme.muted, anchor: 'end', opacity: 0.6 }));
  return parts.join('');
}

/** Toast that appears when a rival overtakes — the "roast" moment. */
function toastMarkup(frame) {
  const age = frame.t - 3.4;
  if (age < 0) return '';
  const pop = Math.min(1, age / 0.25);
  const w = 384;
  const h = 58;
  const x = PAD;
  const y = TOAST_Y - (1 - pop) * 8;
  const parts = [];
  parts.push(rect(x, y, w, h, { fill: theme.panel, rx: 10, stroke: theme.bad, strokeWidth: 1.2, opacity: 0.2 + 0.8 * pop }));
  parts.push(rect(x + 1, y + 1, 4, h - 2, { fill: theme.bad, rx: 2, opacity: pop }));
  parts.push(text('⚠ A RIVAL JUST PASSED YOU', x + 16, y + 20, { size: 9.5, fill: theme.bad, weight: 700, letterSpacing: '1.2', opacity: pop }));
  parts.push(text('nova-labs/repo-hype took #3. You are #4.', x + 16, y + 38, { size: 13, fill: theme.text, weight: 600, opacity: pop }));
  parts.push(text('1.06★/day vs your 0.87 — one good week and it is yours.', x + 16, y + 51, { size: 10.5, fill: theme.muted, opacity: pop }));
  return parts.join('');
}

function renderFrame(frame) {
  const snapshot = snapshotFor(frame);
  const ranking = rankingFor(frame);
  const momentum = momentumFor(frame);

  const card = renderScoreboard({ snapshot, momentum, ranking, theme, now: NOW, title: 'RivalMode' });
  const cardScale = (W - PAD * 2) / card.width;
  const cardY = CHROME + 34;

  const body =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_SANS}">` +
    chromeMarkup(frame) +
    `<g transform="translate(${PAD} ${cardY}) scale(${cardScale})">${stripSvgWrapper(card.svg, card.width, card.height)}</g>` +
    toastMarkup(frame) +
    '</svg>';
  return body;
}

/** Inline a rendered card into the larger canvas. */
function stripSvgWrapper(svg, width, height) {
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  // Namespace ids so multiple cards on one canvas never collide.
  return `<svg x="0" y="0" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${inner}</svg>`;
}

/* ------------------------------------------------------------------ main --- */

const all = frames();
const encoder = GIFEncoder();

// Build one palette from real rendered pixels (sampled across the timeline) so
// antialiasing, glows and the toast all land on colours that exist. A single
// global palette keeps every frame fully self-contained AND small.
const palette = buildPaletteFromFrames();

// Frames where nothing visible changes are redundant: collapse them into one
// so the GIF spends its bytes on the moments that actually move.
const kept = all.filter((frame, i) => i === 0 || frame.stage !== all[i - 1].stage || frame.t - all[i - 1].t < 0.26);

for (let index = 0; index < kept.length; index += 1) {
  const rgba = rasterise(renderFrame(kept[index]));
  const indexed = applyPalette(rgba, palette, 'rgb444');
  encoder.writeFrame(indexed, W, H, {
    palette,
    delay: Math.round(1000 / FPS),
    repeat: index === 0 ? 0 : undefined,
    dispose: 1,
  });
  process.stdout.write(`\r  frame ${index + 1}/${kept.length}`);
}

// Hold the final frame so the roast is readable.
const holdRgba = rasterise(renderFrame(all[all.length - 1]));
const holdIndexed = applyPalette(holdRgba, palette, 'rgb444');
for (let hold = 0; hold < 20; hold += 1) {
  encoder.writeFrame(holdIndexed, W, H, { palette, delay: 100, dispose: 1 });
}

encoder.finish();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encoder.bytes());
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`\n✔ ${OUT} (${kb} KB, ${kept.length} frames)`);

/** Sample real frames and quantise them into one shared palette. */
function buildPaletteFromFrames() {
  const samples = [];
  const step = Math.max(1, Math.floor(all.length / 8));
  for (let i = 0; i < all.length; i += step) {
    const rgba = rasterise(renderFrame(all[i]));
    // Every 3rd pixel is plenty of signal and keeps quantize() fast.
    for (let p = 0; p < rgba.length; p += 4 * 3) {
      samples.push(rgba[p], rgba[p + 1], rgba[p + 2], 255);
    }
  }
  return quantize(new Uint8Array(samples), 48, { format: 'rgb444' });
}

/** Render an SVG string to downsampled RGBA at the final size. */
function rasterise(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(W * SCALE) },
    font: { loadSystemFonts: true },
    background: theme.background,
  });
  const png = resvg.render();
  return downscale(png.pixels, png.width, png.height, SCALE);
}

/** Box-filter downsample from supersampled RGBA to final size. */
function downscale(pixels, width, height, factor) {
  if (factor === 1) return pixels;
  const outW = Math.floor(width / factor);
  const outH = Math.floor(height / factor);
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const sx = x * factor + dx;
          const sy = y * factor + dy;
          const i = (sy * width + sx) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
          n += 1;
        }
      }
      const o = (y * outW + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}
