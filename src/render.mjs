/**
 * Render all SVGs for a snapshot + ranking. Pure: takes data, returns files.
 */
import { renderScoreboard } from './svg/scoreboard.mjs';
import { renderRivals } from './svg/rivals.mjs';
import { renderContributorBars, renderFeed } from './svg/bars.mjs';
import { badgeSpecs, renderBadge } from './svg/badges.mjs';
import { loadTheme } from './lib/theme.mjs';

/**
 * @returns {Record<string, string>} filename -> svg source
 */
export function renderAll({ snapshot, momentum, ranking, config, now = Date.now(), warnings = [] }) {
  const theme = typeof config.theme === 'string' ? loadTheme(config.theme) : config.theme;
  const files = {};

  const scoreboard = renderScoreboard({
    snapshot,
    momentum,
    ranking,
    theme,
    now,
    warnings,
    title: config.title,
  });
  files['scoreboard.svg'] = scoreboard.svg;

  files['rivals.svg'] = renderRivals({ ranking, theme, maxRows: 8 }).svg;
  files['contributors.svg'] = renderContributorBars({ snapshot, theme }).svg;
  files['feed.svg'] = renderFeed({ snapshot, theme }).svg;

  for (const { file, spec } of badgeSpecs({
    momentum,
    ranking,
    snapshot,
    license: snapshot.repo.license || 'MIT',
  })) {
    files[file] = renderBadge(spec);
  }

  return { files, theme, sizes: { scoreboard, width: scoreboard.width, height: scoreboard.height } };
}
