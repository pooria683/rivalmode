/**
 * The rival ladder: everyone in your cluster, ranked by star velocity, with
 * your repo highlighted. This is the card that makes people come back.
 */
import {
  FONT_SANS,
  bar,
  cardBackground,
  escapeXml,
  chevron,
  formatCount,
  fitText,
  rect,
  svgDocument,
  text,
  textWidth,
} from './primitives.mjs';
import { colorFor } from '../lib/theme.mjs';

export const RIVALS_WIDTH = 860;

export function renderRivals({ ranking, theme, title = 'Rival ladder', maxRows = 8 }) {
  const W = RIVALS_WIDTH;
  const pad = 22;
  const rowH = 34;
  const headerH = 74;
  const entries = ranking?.entries ?? [];
  const shown = clampRows(entries, ranking?.self, maxRows);
  const footerH = 34;
  const H = pad + headerH + shown.length * rowH + footerH + (shown.length === 0 ? 30 : 0);

  const parts = [cardBackground(theme, W, H)];

  parts.push(text('RIVAL LADDER', pad, pad + 14, { size: 9.5, fill: theme.muted, weight: 700, letterSpacing: '1.4' }));
  const subtitle = ranking?.rank
    ? `#${ranking.rank} of ${ranking.clusterSize} in your topic cluster · ranked by ★/day`
    : 'Rival search is off (private repo) — showing tracked forks only';
  parts.push(text(fitText(subtitle, W - pad * 2 - 150, 12.5), pad, pad + 38, { size: 12.5, fill: theme.text, weight: 600 }));

  // "gap to #1" pill on the right
  const leader = entries[0];
  if (leader && ranking?.self) {
    const gap = Math.max(0, (leader.stars || 0) - (ranking.self.stars || 0));
    const pillW = 138;
    parts.push(rect(W - pad - pillW, pad + 22, pillW, 24, { fill: theme.panel, rx: 12, stroke: theme.border }));
    parts.push(
      text(gap === 0 ? 'top of the ladder' : `${formatCount(gap)}★ to #1`, W - pad - pillW / 2, pad + 38, {
        size: 11,
        fill: gap === 0 ? theme.good : theme.muted,
        anchor: 'middle',
        weight: 600,
      })
    );
  }

  const listY = pad + headerH - 6;
  if (shown.length === 0) {
    parts.push(text('No rivals yet. Add topics to the repo and run the rivals workflow.', pad, listY + 24, { size: 12, fill: theme.muted }));
  }

  const maxVel = Math.max(0.01, ...shown.map((e) => e.velocity || 0));
  const rankX = pad + 6;
  const nameX = pad + 40;
  const barX = W - pad - 250;
  const barW = 150;

  shown.forEach((entry, i) => {
    const y = listY + i * rowH;
    const rowFill = entry.isSelf ? theme.panel : 'none';
    if (entry.isSelf) {
      parts.push(rect(pad, y + 2, W - pad * 2, rowH - 6, { fill: rowFill, rx: 8, stroke: theme.accent, strokeWidth: 1 }));
    }
    const rankColor = entry.rank === 1 ? theme.warn : entry.isSelf ? theme.accent : theme.muted;
    parts.push(text(`#${entry.rank}`, rankX + 8, y + 20, { size: 13, fill: rankColor, weight: 700, anchor: 'middle' }));

    const label = entry.isSelf ? `${entry.name} (you)` : entry.name;
    const labelMax = entry.isSelf ? barX - nameX - 24 : barX - nameX - 74;
    const safeLabel = fitText(label, labelMax, 13, { bold: entry.isSelf });
    parts.push(text(safeLabel, nameX, y + 20, {
      size: 13,
      fill: theme.text,
      weight: entry.isSelf ? 700 : 500,
      opacity: entry.isSelf ? 1 : 0.86,
    }));
    const labelW = textWidth(safeLabel, 13, { bold: entry.isSelf });
    if (!entry.isSelf && entry.slug?.includes('/')) {
      parts.push(text(fitText(entry.slug, 96, 9.5), nameX + labelW + 7, y + 20, { size: 9.5, fill: theme.muted, opacity: 0.7 }));
    } else if (entry.isSelf) {
      // Identity badge: your repo, on your row, wherever it sits in the ladder.
      const badgeLabel = entry.commitsLast30 ? `${entry.commitsLast30} commits this month` : 'this repo';
      const bw = textWidth(badgeLabel, 9.5) + 14;
      parts.push(rect(nameX + labelW + 8, y + 8, bw, 15, { fill: theme.accent, rx: 7.5, opacity: 0.16 }));
      parts.push(text(badgeLabel, nameX + labelW + 15, y + 19, { size: 9.5, fill: theme.accent }));
    }

    // velocity bar
    const color = entry.isSelf ? theme.accent : colorFor(theme, i, entry.slug);
    const ratio = maxVel ? (entry.velocity || 0) / maxVel : 0;
    parts.push(bar(barX, y + 11, barW, 5, ratio, { fill: color, track: theme.track, rx: 2.5, opacity: entry.isSelf ? 1 : 0.75 }));
    parts.push(
      text(`${(entry.velocity || 0).toFixed(2)}★/d`, barX + barW + 12, y + 17, {
        size: 11,
        fill: entry.isSelf ? theme.text : theme.muted,
        weight: entry.isSelf ? 600 : 400,
        mono: true,
      })
    );
    parts.push(
      text(`${formatCount(entry.stars || 0)}★`, W - pad - 4, y + 17, { size: 11, fill: theme.muted, anchor: 'end', mono: true, opacity: 0.85 })
    );
  });

  // Footer: what you passed / who passed you
  const footerY = listY + shown.length * rowH + 8;
  const passed = ranking?.changes?.passed?.length ?? 0;
  const passedBy = ranking?.changes?.passedBy?.length ?? 0;
  const bits = [];
  if (passed) bits.push(`${chevronSmall(theme.good)} passed ${passed} rival${passed === 1 ? '' : 's'}`);
  if (passedBy) bits.push(`${chevronSmall(theme.bad, 'down')} passed by ${passedBy}`);
  if (!passed && !passedBy) bits.push(escaped('no rank changes since last run', theme.muted));
  parts.push(
    `<g font-size="10.5" font-family="${FONT_SANS}" fill="${theme.muted}">` +
      `<text x="${pad}" y="${footerY + 16}">${bits.join('    ')}</text></g>`
  );
  parts.push(text('source: GitHub search · star velocity, 30d', W - pad, footerY + 16, { size: 9.5, fill: theme.muted, anchor: 'end', opacity: 0.6 }));

  void cardBackground;
  return {
    svg: svgDocument({ width: W, height: Math.round(H), theme, id: 'rv', title: `${title} — RivalMode`, body: parts.join('') }),
    width: W,
    height: Math.round(H),
  };
}

function chevronSmall(color, direction = 'up') {
  return direction === 'up' ? `<tspan fill="${color}">▲</tspan>` : `<tspan fill="${color}">▼</tspan>`;
}

/** Escape a plain string for inclusion inside hand-built markup. */
function escaped(value, fill) {
  return `<tspan fill="${fill}">${escapeXml(value)}</tspan>`;
}

/**
 * Show the interesting slice of a long ladder: always the top few, always you,
 * always your nearest neighbours.
 */
function clampRows(entries, self, maxRows) {
  if (entries.length <= maxRows) return entries;
  const selfIndex = entries.findIndex((e) => e.isSelf);
  if (selfIndex < 0) return entries.slice(0, maxRows);
  const keep = new Set();
  for (let i = 0; i < Math.min(2, entries.length); i += 1) keep.add(i);
  for (let i = Math.max(0, selfIndex - 1); i <= Math.min(entries.length - 1, selfIndex + 1); i += 1) keep.add(i);
  for (let i = 0; i < maxRows; i += 1) if (entries[i]) keep.add(i);
  const sorted = [...keep].sort((a, b) => a - b);
  let out = sorted.map((i) => entries[i]);
  if (out.length > maxRows) {
    const selfPos = out.findIndex((e) => e.isSelf);
    const start = Math.max(0, Math.min(selfPos - Math.floor(maxRows / 2), out.length - maxRows));
    out = out.slice(start, start + maxRows);
  }
  return out;
}
