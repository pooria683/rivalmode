/**
 * Contributor bar race for the current month. Re-rendered every hour, so the
 * bars visibly grow as people push. Contributors without commits this month
 * keep their row (greyed) so the roster doesn't jump around.
 */
import { bar, cardBackground, fitText, formatCount, rect, svgDocument, text, textWidth } from './primitives.mjs';
import { colorFor } from '../lib/theme.mjs';

export const BARS_WIDTH = 430;

export function renderContributorBars({ snapshot, theme, limit = 6, width = BARS_WIDTH }) {
  const W = width;
  const pad = 18;
  const rowH = 26;
  const headerH = 54;

  const contributors = (snapshot.leaderboard || [])
    .slice()
    .sort((a, b) => (b.monthCommits || 0) - (a.monthCommits || 0) || b.contributions - a.contributions);
  const withCommits = contributors.filter((c) => (c.monthCommits || 0) > 0);
  const rows = (withCommits.length ? withCommits : contributors).slice(0, limit);

  const emptyH = rows.length ? 0 : 26;
  const H = pad + headerH + rows.length * rowH + emptyH + 16;
  const parts = [cardBackground(theme, W, H)];

  const monthName = new Date(snapshot.generatedAt).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  parts.push(text('BAR RACE', pad, pad + 12, { size: 9.5, fill: theme.muted, weight: 700, letterSpacing: '1.4' }));
  parts.push(text(`${monthName} · commits per contributor`, pad, pad + 32, { size: 12, fill: theme.text, weight: 600 }));
  const total = rows.reduce((sum, r) => sum + (r.monthCommits || 0), 0);
  parts.push(
    text(`${formatCount(total)} commits`, W - pad, pad + 30, { size: 11, fill: theme.muted, anchor: 'end', mono: true })
  );

  if (!rows.length) {
    parts.push(text('No commits this month yet — the race starts with you.', pad, pad + headerH + 14, { size: 11, fill: theme.muted }));
  }

  const max = Math.max(1, ...rows.map((r) => r.monthCommits || 0));
  const nameW = 96;
  const barX = pad + nameW + 6;
  const valueW = 34;
  const barW = W - pad * 2 - nameW - valueW - 6;

  rows.forEach((contributor, i) => {
    const y = pad + headerH + i * rowH;
    const color = colorFor(theme, i, contributor.login);
    parts.push(text(fitText(contributor.login, nameW, 11.5), pad, y + 15, { size: 11.5, fill: theme.text, opacity: 0.9 }));
    const ratio = (contributor.monthCommits || 0) / max;
    parts.push(bar(barX, y + 5, barW, 12, ratio, { fill: color, track: theme.track, rx: 3, opacity: i === 0 ? 1 : 0.8 }));
    parts.push(
      text(String(contributor.monthCommits || 0), W - pad, y + 15, { size: 12, fill: i === 0 ? theme.text : theme.muted, weight: i === 0 ? 700 : 500, anchor: 'end', mono: true })
    );
  });

  return {
    svg: svgDocument({ width: W, height: Math.round(H), theme, id: 'br', title: 'Contributor bar race — RivalMode', body: parts.join('') }),
    width: W,
    height: Math.round(H),
  };
}

export const FEED_WIDTH = 430;

/** Last N events, timestamped, with the actor's initial as a colour chip. */
export function renderFeed({ snapshot, theme, width = FEED_WIDTH, limit = 6 }) {
  const W = width;
  const pad = 18;
  const rowH = 32;
  const headerH = 54;
  const items = (snapshot.feed || []).slice(0, limit);
  const H = pad + headerH + Math.max(1, items.length) * rowH + 14;
  const parts = [cardBackground(theme, W, H)];

  parts.push(text('LIVE FEED', pad, pad + 12, { size: 9.5, fill: theme.muted, weight: 700, letterSpacing: '1.4' }));
  const starCount = items.filter((i) => i.type === 'WatchEvent').length;
  parts.push(text('the last things that happened', pad, pad + 32, { size: 12, fill: theme.text, weight: 600 }));
  parts.push(
    text(`updated hourly${starCount ? ` · ${starCount}★` : ''}`, W - pad, pad + 31, { size: 10, fill: theme.muted, anchor: 'end', opacity: 0.85 })
  );

  if (!items.length) {
    parts.push(text('Nothing yet. Push something.', pad, pad + headerH + 16, { size: 11, fill: theme.muted }));
  }

  items.forEach((item, i) => {
    const y = pad + headerH + i * rowH;
    const color = colorFor(theme, i, item.actor);
    // actor chip
    parts.push(rect(pad, y + 2, 20, 20, { fill: color, rx: 10, opacity: 0.22 }));
    parts.push(text(initials(item.actor), pad + 10, y + 16, { size: 9.5, fill: theme.text, anchor: 'middle', weight: 700 }));

    const when = formatRelative(item.at, snapshot.generatedAt);
    const whenW = textWidth(when, 9.5, { mono: true });
    const maxText = W - pad * 2 - 28 - whenW - 10;
    parts.push(text(fitText(item.text, maxText, 11.5), pad + 28, y + 12, { size: 11.5, fill: theme.text, opacity: 0.92 }));
    if (item.detail) {
      parts.push(text(fitText(item.detail, maxText, 10), pad + 28, y + 24, { size: 10, fill: theme.muted }));
    }
    parts.push(text(when, W - pad, y + 14, { size: 9.5, fill: theme.muted, anchor: 'end', mono: true, opacity: 0.9 }));
  });

  return {
    svg: svgDocument({ width: W, height: Math.round(H), theme, id: 'fd', title: 'Live event feed — RivalMode', body: parts.join('') }),
    width: W,
    height: Math.round(H),
  };
}

function initials(login = '?') {
  const clean = String(login).replace(/[^a-zA-Z0-9]/g, '');
  return (clean.slice(0, 2) || '?').toUpperCase();
}

export function formatRelative(at, now) {
  const diff = Math.max(0, new Date(now).getTime() - new Date(at).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
