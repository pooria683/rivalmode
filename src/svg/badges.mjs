/**
 * Shields-style badges generated from scratch. Three shapes, one shared
 * measure-and-centre routine, no dependency on shields.io (so the badge keeps
 * working when shields.io is down, and shows your own numbers, not a third
 * party's).
 */
import { FONT_SANS, escapeXml, round, textWidth } from './primitives.mjs';

const HEIGHT = 20;
const PAD = 6;
const FONT_SIZE = 11;

/**
 * @param {{label:string,value:string,color?:string,labelColor?:string,logo?:string}} spec
 */
export function renderBadge({ label, value, color = '#4c1', labelColor = '#555', logo = '', theme = null }) {
  const labelText = String(label ?? '');
  const valueText = String(value ?? '');
  const labelW = Math.round(textWidth(labelText, FONT_SIZE) + PAD * 2 + (logo ? 12 : 0));
  const valueW = Math.round(textWidth(valueText, FONT_SIZE) + PAD * 2);
  const totalW = labelW + valueW;
  const lg = logo ? 2 : 0;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${HEIGHT}" viewBox="0 0 ${totalW} ${HEIGHT}" ` +
    `role="img" aria-label="${escapeXml(`${labelText}: ${valueText}`)}">` +
    `<title>${escapeXml(`${labelText}: ${valueText}`)}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${totalW}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${labelW}" height="${HEIGHT}" fill="${escapeXml(labelColor)}"/>` +
    `<rect x="${labelW}" width="${valueW}" height="${HEIGHT}" fill="${escapeXml(color)}"/>` +
    `<rect width="${totalW}" height="${HEIGHT}" fill="url(#s)"/>` +
    '</g>' +
    `<g fill="#fff" text-anchor="middle" font-family="${FONT_SANS}" font-size="${FONT_SIZE}">` +
    (logo ? logoMarkup(logo, 6, lg) : '') +
    `<text x="${round(labelW / 2 + lg)}" y="14" fill="#010101" fill-opacity=".3">${escapeXml(labelText)}</text>` +
    `<text x="${round(labelW / 2 + lg)}" y="13">${escapeXml(labelText)}</text>` +
    `<text x="${round(labelW + valueW / 2)}" y="14" fill="#010101" fill-opacity=".3">${escapeXml(valueText)}</text>` +
    `<text x="${round(labelW + valueW / 2)}" y="13">${escapeXml(valueText)}</text>` +
    '</g></svg>'
  );
}

/** A tiny inline glyph so badges don't need image requests. */
function logoMarkup(logo, x, y) {
  const marks = {
    bolt: `<path transform="translate(${x},${y}) scale(0.5)" d="M13 1L3 13h6l-1 10 10-13h-6z" fill="#fff"/>`,
    trophy: `<path transform="translate(${x},${y}) scale(0.5)" d="M8 2h12v6a6 6 0 0 1-12 0zM6 4H3v3a4 4 0 0 0 4 4M22 4h3v3a4 4 0 0 1-4 4M11 16h6v3h-6zM8 21h12v3H8z" fill="#fff"/>`,
    flame: `<path transform="translate(${x},${y}) scale(0.5)" d="M14 1c1 6 7 7 7 14a7 7 0 0 1-14 0c0-4 3-5 3-9 2 1 3 3 3 5 1-3 1-6 1-10z" fill="#fff"/>`,
    star: `<path transform="translate(${x},${y}) scale(0.5)" d="M14 1l4 8 9 1-7 7 2 9-8-4-8 4 2-9-7-7 9-1z" fill="#fff"/>`,
  };
  if (marks[logo]) return marks[logo];
  return `<text x="${x + 3}" y="14" font-size="10">${escapeXml(logo)}</text>`;
}

/** Semantic colours that read on GitHub's light and dark themes alike. */
export const BADGE_COLORS = {
  green: '#2ea043',
  brightgreen: '#4c1',
  blue: '#0969da',
  purple: '#8250df',
  orange: '#bc4c00',
  red: '#cf222e',
  yellow: '#9a6700',
  grey: '#57606a',
  darkgrey: '#30363d',
  pink: '#bf3989',
  teal: '#0d9488',
};

export function momentumColor(score) {
  if (score >= 50) return BADGE_COLORS.brightgreen;
  if (score >= 15) return BADGE_COLORS.green;
  if (score > -15) return BADGE_COLORS.yellow;
  if (score > -50) return BADGE_COLORS.orange;
  return BADGE_COLORS.red;
}

/** The badge row from the README, as a list of specs so tests can assert on them. */
export function badgeSpecs({ momentum, ranking, snapshot, license = 'MIT' }) {
  const specs = [];
  specs.push({
    file: 'momentum.svg',
    spec: {
      label: 'momentum',
      value: `${momentum.score > 0 ? '+' : ''}${momentum.score} ${momentum.label}`,
      color: momentumColor(momentum.score),
      logo: momentum.direction === 'up' ? 'flame' : momentum.direction === 'down' ? 'bolt' : 'trophy',
    },
  });
  specs.push({
    file: 'rank.svg',
    spec: {
      label: 'rank',
      value: ranking?.rank ? `#${ranking.rank} of ${ranking.clusterSize}` : 'unranked',
      color: ranking?.rank === 1 ? BADGE_COLORS.brightgreen : ranking?.podium ? BADGE_COLORS.purple : BADGE_COLORS.blue,
      logo: 'trophy',
    },
  });
  specs.push({
    file: 'streak.svg',
    spec: {
      label: 'commit streak',
      value: snapshot.commits.streak ? `${snapshot.commits.streak}d streak` : 'no streak',
      color: snapshot.commits.streak >= 7 ? BADGE_COLORS.brightgreen : snapshot.commits.streak > 0 ? BADGE_COLORS.green : BADGE_COLORS.grey,
      logo: 'flame',
    },
  });
  specs.push({
    file: 'score.svg',
    spec: {
      label: 'rivalmode',
      value: `${Math.round(momentum.current.weighted ?? 0)} pts this week`,
      color: BADGE_COLORS.darkgrey,
      logo: '⚔',
    },
  });
  specs.push({
    file: 'license.svg',
    spec: { label: 'license', value: license || 'none', color: BADGE_COLORS.blue },
  });
  return specs;
}
