/**
 * The main scoreboard card: rank headline, five stat tiles, a 60-day activity
 * chart, momentum gauge and a footer with warnings.
 *
 * Layout is fixed-width (860px) so it renders identically on GitHub, in the
 * README preview, and in snapshot tests.
 */
import {
  bar,
  cardBackground,
  chevron,
  circle,
  escapeXml,
  fitText,
  formatCount,
  formatSigned,
  line,
  rect,
  svgDocument,
  text,
  textWidth,
} from './primitives.mjs';
import { shortAge } from '../lib/dates.mjs';

export const SCOREBOARD_WIDTH = 860;

export function renderScoreboard({ snapshot, momentum, ranking, theme, now = Date.now(), warnings = [], title }) {
  const W = SCOREBOARD_WIDTH;
  const pad = 22;
  const headerH = 78;
  const tilesY = pad + headerH;
  const tilesH = 76;
  const chartY = tilesY + tilesH + 18;
  const chartH = 96;
  const footerY = chartY + chartH + 16;
  const warningH = warnings.length ? 20 + warnings.slice(0, 2).length * 15 : 0;
  const H = footerY + 30 + warningH + pad;

  const parts = [];
  parts.push(cardBackground(theme, W, H));

  /* header ------------------------------------------------------------- */
  const repoLabel = `${snapshot.repo.owner}/${snapshot.repo.name}`;
  parts.push(circle(pad + 5, pad + 12, 5, { fill: theme.accent }));
  parts.push(text(title || 'RivalMode', pad + 18, pad + 16, { size: 12, fill: theme.muted, weight: 600, letterSpacing: '1.6' }));
  parts.push(text(repoLabel, pad + 18 + textWidth(title || 'RivalMode', 12, { bold: true }) + 34, pad + 16, {
    size: 12,
    fill: theme.muted,
    opacity: 0.75,
  }));

  // Rank headline
  const headline = !ranking?.rank
    ? 'Rival tracking off'
    : ranking.clusterSize <= 1
      ? 'Waiting for rivals'
      : ranking.rank === 1
        ? `You are #1 in ${clusterLabel(snapshot)}`
        : `You are #${ranking.rank} in ${clusterLabel(snapshot)}`;
  parts.push(text(fitText(headline, W - pad * 2 - 200, 26, { bold: true }), pad, pad + 48, { size: 26, fill: theme.text, weight: 700 }));
  const headlineW = textWidth(headline, 26, { bold: true });

  // "who's ahead" line
  const next = ranking?.nextTarget;
  const aheadLine =
    ranking?.clusterSize <= 1
      ? 'No comparable repos found yet — add topics, then run the rivals workflow'
      : next
        ? `▲ ${next.slug} is ${gapWords(ranking.self, next)}`
        : ranking?.rank === 1
          ? 'Defending the top spot — nobody in the cluster is ahead'
          : 'Not ranked yet — run the rivals workflow';
  parts.push(text(fitText(aheadLine, W - pad * 2 - 210, 13), pad, pad + 70, {
    size: 13,
    fill: ranking?.rank === 1 ? theme.good : theme.muted,
  }));

  /* momentum capsule (top right) --------------------------------------- */
  const capsuleW = 178;
  const capsuleX = W - pad - capsuleW;
  const capsuleY = pad + 30;
  parts.push(rect(capsuleX, capsuleY, capsuleW, 52, { fill: theme.panel, rx: 10, stroke: theme.border }));
  parts.push(text('MOMENTUM', capsuleX + 14, capsuleY + 18, { size: 9.5, fill: theme.muted, weight: 700, letterSpacing: '1.3' }));
  const mColor = momentum.direction === 'up' ? theme.good : momentum.direction === 'down' ? theme.bad : theme.muted;
  const mValue = `${momentum.score > 0 ? '+' : ''}${momentum.score}`;
  parts.push(text(mValue, capsuleX + 14, capsuleY + 42, { size: 21, fill: mColor, weight: 700 }));
  parts.push(chevron(capsuleX + 30 + textWidth(mValue, 21, { bold: true }), capsuleY + 35, 5, momentum.direction, mColor));
  parts.push(text(momentum.label, capsuleX + 50 + textWidth(mValue, 21, { bold: true }), capsuleY + 42, { size: 11, fill: theme.muted }));
  // gauge track
  const gaugeX = capsuleX + 14;
  const gaugeW = capsuleW - 28;
  const gaugeY = capsuleY + 46;
  parts.push(bar(gaugeX, gaugeY, gaugeW, 3, (momentum.score + 100) / 250, { fill: mColor, track: theme.track, rx: 1.5 }));

  /* stat tiles --------------------------------------------------------- */
  const tiles = [
    { label: 'COMMITS TODAY', value: snapshot.commits.today, sub: `${snapshot.commits.week} this week`, color: theme.accent },
    { label: 'MERGES / DAY', value: snapshot.merges.perDay, sub: `${snapshot.counts.openPRs} PRs open`, color: theme.good },
    { label: 'STARS', value: snapshot.counts.stars, sub: momentum.current.stars ? `${formatSigned(momentum.current.stars)}★ this week` : 'no new stars', color: theme.warn },
    { label: 'STREAK', value: `${snapshot.commits.streak}d`, sub: snapshot.commits.streak ? 'keep it alive' : 'start one today', color: theme.accent },
    { label: 'BRANCHES', value: snapshot.counts.branches, sub: `${snapshot.counts.contributors} contributors`, color: theme.muted },
  ];
  const tileGap = 10;
  const tileW = (W - pad * 2 - tileGap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = pad + i * (tileW + tileGap);
    parts.push(rect(x, tilesY, tileW, tilesH, { fill: theme.panel, rx: 10, stroke: theme.border }));
    parts.push(text(tile.label, x + 12, tilesY + 18, { size: 8.8, fill: theme.muted, weight: 700, letterSpacing: '1.1' }));
    parts.push(text(String(tile.value), x + 12, tilesY + 46, { size: 24, fill: tile.color, weight: 700 }));
    parts.push(text(fitText(tile.sub, tileW - 24, 10), x + 12, tilesY + 63, { size: 10, fill: theme.muted }));
  });

  /* activity chart ----------------------------------------------------- */
  parts.push(text('ACTIVITY', pad, chartY - 4, { size: 9.5, fill: theme.muted, weight: 700, letterSpacing: '1.3' }));
  parts.push(text('last 30 days · commits', pad + 74, chartY - 4, { size: 9.5, fill: theme.muted, opacity: 0.7 }));
  const chart = renderActivityChart(snapshot.activity, theme, {
    x: pad,
    y: chartY + 8,
    w: W - pad * 2 - 200,
    h: chartH - 6,
  });
  parts.push(chart.markup);

  // right side: streak dots + latest commit
  const sideX = W - pad - 190;
  parts.push(renderStreakDots(theme, { x: sideX, y: chartY + 10, w: 190, activity: snapshot.activity }));
  const latest = snapshot.commits.latest;
  parts.push(text('LATEST', sideX, chartY + 56, { size: 9, fill: theme.muted, weight: 700, letterSpacing: '1.2' }));
  parts.push(
    text(fitText(latest ? latest.message : 'no commits yet', 178, 10.5), sideX, chartY + 71, {
      size: 10.5,
      fill: latest ? theme.text : theme.muted,
      opacity: latest ? 0.95 : 1,
    })
  );
  if (latest) {
    const age = shortAge(latest.at, now);
    parts.push(text(`${latest.name} · ${age === 'now' ? 'just now' : `${age} ago`}`, sideX, chartY + 85, { size: 9.5, fill: theme.muted }));
  }

  /* footer ------------------------------------------------------------- */
  parts.push(line(pad, footerY, W - pad, footerY, { stroke: theme.border, opacity: 0.8 }));
  const footerBits = [
    `${snapshot.counts.openPRs} open PRs`,
    `${snapshot.counts.forks} forks`,
    `updated ${ageLabel(snapshot.generatedAt, now)}`,
  ];
  parts.push(text(footerBits.join('  ·  '), pad, footerY + 19, { size: 10.5, fill: theme.muted }));
  const left = `rivalmode`;
  parts.push(text(left, W - pad, footerY + 19, { size: 10.5, fill: theme.muted, anchor: 'end', opacity: 0.7 }));

  if (warnings.length) {
    let y = footerY + 36;
    for (const warning of warnings.slice(0, 2)) {
      parts.push(circle(pad + 3, y - 3.5, 2.4, { fill: theme.warn }));
      parts.push(text(fitText(warning, W - pad * 2 - 14, 9.5), pad + 12, y, { size: 9.5, fill: theme.warn, opacity: 0.9 }));
      y += 15;
    }
  }

  return {
    svg: svgDocument({
      width: W,
      height: Math.round(H),
      theme,
      id: 'sb',
      title: `${snapshot.repo.slug} — RivalMode scoreboard`,
      body: parts.join(''),
    }),
    width: W,
    height: Math.round(H),
  };
}

function ageLabel(at, now) {
  const age = shortAge(at, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

function clusterLabel(snapshot) {
  const topic = snapshot.repo.topics?.[0];
  if (topic) return `#${topic}`;
  if (snapshot.repo.language) return `${snapshot.repo.language.toLowerCase()} repos`;
  return 'your cluster';
}

function gapWords(self, target) {
  if (!self || !target) return 'ahead';
  const dv = Math.round(((target.velocity || 0) - (self.velocity || 0)) * 100) / 100;
  const stars = Math.max(1, Math.ceil((target.stars || 0) - (self.stars || 0)));
  if (dv > 0.01) return `gaining ${dv}★/day — ${stars}★ ahead`;
  if (dv < -0.01) return `slower than you by ${Math.abs(dv)}★/day — ${stars}★ ahead`;
  return `${stars}★ ahead, level on velocity`;
}

/** 30 bar columns with a 7-day moving average line. */
export function renderActivityChart(activity, theme, { x, y, w, h }) {
  const entries = Object.entries(activity || {}).slice(-30);
  if (!entries.length) return { markup: '' };
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const slot = w / entries.length;
  const gap = Math.max(1.5, slot * 0.24);
  const barW = Math.max(2, slot - gap);
  const parts = [];

  // gridlines
  for (let i = 0; i <= 2; i += 1) {
    const gy = y + (h / 2) * i;
    parts.push(line(x, gy, x + w, gy, { stroke: theme.border, opacity: 0.45, dash: '2 4' }));
  }

  const points = [];
  entries.forEach(([key, value], i) => {
    const bx = x + i * slot + gap / 2;
    const bh = value === 0 ? 2 : Math.max(3, (value / max) * (h - 6));
    const by = y + h - bh;
    const isToday = i === entries.length - 1;
    parts.push(
      rect(bx, by, barW, bh, {
        fill: value === 0 ? theme.track : isToday ? theme.accent : theme.accentSoft,
        rx: Math.min(2.5, barW / 2),
        opacity: value === 0 ? 0.7 : isToday ? 1 : 0.55 + 0.45 * (value / max),
      })
    );
    points.push([bx + barW / 2, by]);
  });

  // peak marker
  const peakIndex = entries.reduce((best, [, v], i, arr) => (v > arr[best][1] ? i : best), 0);
  if (entries[peakIndex][1] > 0) {
    const px = x + peakIndex * slot + slot / 2;
    const py = y + h - Math.max(3, (entries[peakIndex][1] / max) * (h - 6));
    parts.push(text(String(entries[peakIndex][1]), px, py - 5, { size: 9, fill: theme.muted, anchor: 'middle', weight: 600 }));
  }
  parts.push(text('today', x + w, y + h + 12, { size: 8.5, fill: theme.muted, anchor: 'end', opacity: 0.8 }));
  parts.push(text(entries[0][0].slice(5), x, y + h + 12, { size: 8.5, fill: theme.muted, opacity: 0.8 }));

  return { markup: parts.join(''), points, max };
}

/** 14 little squares: did we commit? Keeps streaks visually addictive. */
export function renderStreakDots(theme, { x, y, w, activity }) {
  const keys = Object.keys(activity || {}).slice(-14);
  const parts = [text('STREAK', x, y + 2, { size: 9, fill: theme.muted, weight: 700, letterSpacing: '1.2' })];
  const size = 11;
  const gap = (w - keys.length * size) / Math.max(1, keys.length - 1);
  keys.forEach((key, i) => {
    const value = activity[key] || 0;
    const dx = x + i * (size + gap);
    parts.push(
      rect(dx, y + 12, size, size, {
        fill: value > 0 ? theme.good : theme.track,
        rx: 2.5,
        opacity: value > 0 ? Math.min(1, 0.45 + value * 0.18) : 0.9,
      })
    );
    if (i === keys.length - 1) {
      parts.push(rect(dx - 1, y + 11, size + 2, size + 2, { fill: 'none', stroke: theme.accent, rx: 3, strokeWidth: 1, opacity: 0.8 }));
    }
  });
  return parts.join('');
}
