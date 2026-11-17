/**
 * README assembly. Everything RivalMode writes lives between HTML comment
 * markers, so a human can keep writing around it and nothing is ever clobbered:
 *
 *   <!-- rivalmode:start badges -->
 *   ...generated...
 *   <!-- rivalmode:end badges -->
 *
 * Two properties matter and are both tested:
 *   1. idempotent  — running twice produces identical bytes (no commit churn);
 *   2. fenced-code safe — markers quoted inside a ``` block (including in this
 *      project's own README) are documentation, not sections, and are untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { nowMs, shortAge } from './lib/dates.mjs';

export const SECTIONS = ['badges', 'scoreboard', 'rivals', 'team', 'feed', 'conquests', 'footer'];

/** Headings and wrappers that setup itself inserts; removed again on uninstall. */
export const SCAFFOLD_HEADINGS = ['## ⚔️ Live scoreboard', '## ⚔️ The ladder', '## 🏆 This month', '## 🗡️ Recent conquests'];

export function markerStart(section) {
  return `<!-- rivalmode:start ${section} -->`;
}

export function markerEnd(section) {
  return `<!-- rivalmode:end ${section} -->`;
}

/* ------------------------------------------------------------- sections --- */

export function badgesSection({ momentum, ranking, snapshot, assets, degraded }) {
  const img = (name, alt) => `<img src="${assets}/${name}" alt="${alt}" />`;
  return [
    img('momentum.svg', `momentum ${momentum.score}`),
    img('rank.svg', ranking?.rank ? `rank ${ranking.rank} of ${ranking.clusterSize}` : 'rank'),
    img('streak.svg', `commit streak ${snapshot.commits.streak} days`),
    img('score.svg', 'points this week'),
    img('license.svg', `license ${snapshot.repo.license || 'MIT'}`),
    ...(degraded ? ['<sub>(degraded mode)</sub>'] : []),
  ].join('\n');
}

export function scoreboardSection({ snapshot, momentum, ranking, assets, warnings }) {
  const lines = [`<img src="${assets}/scoreboard.svg" alt="RivalMode scoreboard for ${snapshot.repo.slug}" width="860" />`, ''];
  lines.push(rankSentence(ranking, snapshot));
  const meter = momentumLine(momentum);
  if (meter) lines.push(`\n${meter}`);
  if (warnings?.length) {
    lines.push('');
    lines.push('> [!NOTE]');
    lines.push(`> Some numbers are stale this run — ${warnings.slice(0, 2).join('; ')}`);
  }
  lines.push('');
  const age = shortAge(snapshot.generatedAt, nowMs());
  lines.push(
    `<sub>updated ${age === 'now' ? 'just now' : `${age} ago`} · every number comes from the GitHub API, nothing is hand-edited</sub>`
  );
  return lines.join('\n');
}

export function rankSentence(ranking, snapshot) {
  if (!ranking?.rank) {
    return '**Unranked.** Rival search is disabled for this repo — the scoreboard still tracks everything of your own.';
  }
  const topic = snapshot.repo.topics?.[0];
  const where = topic ? `the \`${topic}\` cluster` : 'your topic cluster';
  if (ranking.clusterSize <= 1) {
    return '**No rivals with enough signal yet.** Add topics to the repo (and get a few stars) so RivalMode has a cluster to rank you in — until then the scoreboard tracks your own numbers only.';
  }
  if (ranking.rank === 1) {
    return `**You are #1 of ${ranking.clusterSize} in ${where}.** ${behindSentence(ranking)}`;
  }
  const ahead = ranking.nextTarget;
  const gapStars = ahead ? Math.max(1, Math.ceil((ahead.stars || 0) - (ranking.self?.stars || 0))) : 0;
  const gapVelocity = ahead ? Math.round(((ahead.velocity || 0) - (ranking.self?.velocity || 0)) * 100) / 100 : 0;
  const detail = ahead
    ? gapVelocity > 0
      ? `\`${ahead.slug}\` is **${gapVelocity}★/day faster** than you. At this pace they pull away.`
      : gapVelocity < 0
        ? `\`${ahead.slug}\` is ahead but **${Math.abs(gapVelocity)}★/day slower** — keep shipping and this flips.`
        : `\`${ahead.slug}\` is ahead on stars (${gapStars}★) but level with you on velocity.`
    : '';
  return `**You are #${ranking.rank} of ${ranking.clusterSize} in ${where}.** ${detail}`;
}

function behindSentence(ranking) {
  const chasers = ranking.chasing || [];
  if (!chasers.length) return 'Nobody else is in the cluster yet.';
  const next = chasers[0];
  if ((next.velocity || 0) > (ranking.self?.velocity || 0)) {
    return `⚠️ \`${next.slug}\` is gaining faster than you (${next.velocity}★/day vs ${ranking.self?.velocity}). Hold the line.`;
  }
  return `Next up: \`${next.slug}\` at ${next.velocity}★/day. Nobody is catching you right now.`;
}

function momentumLine(momentum) {
  const arrow = momentum.direction === 'up' ? '▲' : momentum.direction === 'down' ? '▼' : '◆';
  const parts = [
    `**Momentum ${momentum.score > 0 ? '+' : ''}${momentum.score}** ${arrow} ${momentum.label}`,
    `${momentum.current.commits} commits this week vs ${momentum.previous.commits} last week`,
  ];
  if (momentum.streak > 1) parts.push(`${momentum.streak}-day streak (+${momentum.streakBonus})`);
  if (momentum.rivalBonus) parts.push(`${momentum.rivalBonus > 0 ? '+' : ''}${momentum.rivalBonus} from rival wins`);
  return parts.join(' · ');
}

export function rivalsSection({ ranking, rivals, assets }) {
  if (!ranking) return '_Rival tracking is off._';
  const lines = [
    `<img src="${assets}/rivals.svg" alt="Rival ladder — you are #${ranking.rank} of ${ranking.clusterSize}" width="860" />`,
    '',
  ];
  if (ranking.leaders?.length) {
    lines.push('**Ahead of you:**');
    for (const entry of ranking.leaders) {
      const gap = Math.max(0, Math.ceil((entry.stars || 0) - (ranking.self?.stars || 0)));
      const label = `#${entry.rank} ${entry.slug}`;
      lines.push(
        `- ${entry.url ? `[${label}](${entry.url})` : `\`${label}\``} — ${formatStars(entry.stars)}, ${entry.velocity}★/day · **${gap}★ ahead**`
      );
    }
  } else if (ranking.rank === 1) {
    lines.push('**You are the top of the ladder.** The next repo has to come for you.');
  }

  const fans = rivals?.fans || [];
  if (fans.length) {
    lines.push('');
    lines.push(
      `**${fans.length} of your stargazers are building something too:** ${fans
        .slice(0, 6)
        .map((f) => `[${f.login}](${f.url})`)
        .join(' · ')} — go star them back, that's the game.`
    );
  }

  const forks = (rivals?.forks || []).filter((f) => (f.ahead || 0) > 0);
  if (forks.length) {
    lines.push('');
    for (const fork of forks.slice(0, 2)) {
      lines.push(
        `> ⑂ [\`${fork.slug}\`](${fork.url || `https://github.com/${fork.slug}`}) is **${fork.ahead} commit${
          fork.ahead === 1 ? '' : 's'
        } ahead** of upstream. A fork is out-working you.`
      );
    }
  }
  return lines.join('\n');
}

export function teamSection({ snapshot, assets }) {
  const lines = [`<img src="${assets}/contributors.svg" alt="Contributor bar race" width="430" />`];
  const contributor = snapshot.leaderboard?.[0];
  if (contributor) {
    lines.push('');
    lines.push(
      `🥇 **${contributor.login}** leads this month with **${contributor.monthCommits || 0} commits** (${contributor.contributions} all-time).`
    );
  }
  if (snapshot.commits.streak >= 3) {
    lines.push(`🔥 **${snapshot.commits.streak}-day commit streak.** Miss a day and it resets.`);
  }
  return lines.join('\n');
}

export function feedSection({ snapshot, assets }) {
  const lines = [`<img src="${assets}/feed.svg" alt="Live event feed" width="430" />`, ''];
  const items = (snapshot.feed || []).slice(0, 10);
  if (!items.length) return `${lines[0]}\n\n_No events yet._`;
  for (const item of items) {
    const link = item.url ? `[${escapeMd(item.text)}](${item.url})` : escapeMd(item.text);
    const detail = item.detail ? ` — ${escapeMd(truncate(item.detail, 70))}` : '';
    lines.push(`- \`${shortAge(item.at, nowMs())}\` ${link}${detail}`);
  }
  return lines.join('\n');
}

export function conquestsSection({ snapshot, points }) {
  const rows = [];
  for (const release of (snapshot.releases || []).slice(0, 3)) {
    rows.push(`- ◆ **released ${release.tag}** — ${shortAge(release.at, nowMs())} ago · +${points.release} pts`);
  }
  for (const pr of (snapshot.merges?.recent || []).slice(0, 3)) {
    rows.push(`- ⇄ **merged [#${pr.number}](${pr.url})** ${escapeMd(truncate(pr.title, 64))} — ${pr.author} · +${points.merge} pts`);
  }
  for (const issue of (snapshot.issues?.recent || []).slice(0, 2)) {
    rows.push(`- ● **closed [#${issue.number}](${issue.url})** ${escapeMd(truncate(issue.title, 64))} · +${points.issueClosed} pts`);
  }
  if (!rows.length) return '_Nothing conquered yet this month. Open a PR — it pays 10 points._';
  return rows.join('\n');
}

export function footerSection({ snapshot, config }) {
  const at = new Date(snapshot.generatedAt).toISOString().replace('T', ' ').slice(0, 16);
  return (
    `<sub>⚔️ [RivalMode](https://github.com/pooria683/rivalmode) · theme \`${config.theme}\` · generated ${at} UTC · ` +
    `${snapshot.repo.owner}/${snapshot.repo.name} · [uninstall is deleting one folder](https://github.com/pooria683/rivalmode#uninstall)</sub>`
  );
}

/* --------------------------------------------------------------- assemble --- */

export function buildSections(args) {
  const { config, warnings = [], assets } = args;
  return {
    badges: badgesSection({ ...args, assets }),
    scoreboard: scoreboardSection({ ...args, assets, warnings }),
    rivals: rivalsSection({ ...args, assets }),
    team: teamSection({ ...args, assets }),
    feed: feedSection({ ...args, assets }),
    conquests: conquestsSection(args),
    footer: footerSection({ ...args, config }),
  };
}

/** Wrap generated content in its markers. */
export function wrap(section, content) {
  return `${markerStart(section)}\n${content}\n${markerEnd(section)}`;
}

/**
 * Split markdown into fenced and unfenced runs, preserving exact bytes.
 * Fenced runs are opaque: markers inside them are examples, not sections.
 */
export function splitFences(markdown) {
  const segments = [];
  let index = 0;
  const re = /(?:^|\n)(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    const fenceStart = match.index + (markdown[match.index] === '\n' ? 1 : 0);
    if (fenceStart > index) segments.push({ fenced: false, text: markdown.slice(index, fenceStart) });
    segments.push({ fenced: true, text: match[1] });
    index = fenceStart + match[1].length;
  }
  if (index < markdown.length) segments.push({ fenced: false, text: markdown.slice(index) });
  if (!segments.length) segments.push({ fenced: false, text: '' });
  return segments;
}

/**
 * Replace (or append) every managed section in `markdown`.
 * Unknown text, ordering, and anything outside the markers is preserved.
 */
export function spliceSections(markdown, sections, { order = SECTIONS, appendMissing = true } = {}) {
  const segments = splitFences(String(markdown ?? ''));

  // 1. Replace sections that already exist.
  for (const segment of segments) {
    if (segment.fenced) continue;
    for (const name of order) {
      const content = sections[name];
      if (content == null) continue;
      const re = new RegExp(`${escapeRe(markerStart(name))}[\\s\\S]*?${escapeRe(markerEnd(name))}`);
      if (re.test(segment.text)) segment.text = segment.text.replace(re, () => wrap(name, content));
    }
  }

  // 2. Append the ones that were never installed.
  if (appendMissing) {
    const missing = order.filter(
      (name) => sections[name] != null && !segments.some((seg) => !seg.fenced && seg.text.includes(markerStart(name)))
    );
    if (missing.length) {
      const blocks = [];
      for (const name of missing) {
        if (name === 'team') {
          blocks.push(
            '## 🏆 This month',
            `<table><tr><td valign="top">\n\n${wrap(name, sections.team)}\n\n</td><td valign="top">\n\n${wrap(
              'feed',
              sections.feed ?? ''
            )}\n\n</td></tr></table>`
          );
        } else if (name === 'feed') {
          continue; // placed beside team above
        } else if (name === 'rivals') {
          blocks.push('## ⚔️ The ladder', wrap(name, sections[name]));
        } else if (name === 'conquests') {
          blocks.push('## 🗡️ Recent conquests', wrap(name, sections[name]));
        } else {
          blocks.push(wrap(name, sections[name]));
        }
      }
      const tail = segments[segments.length - 1];
      tail.text = `${tail.text.replace(/\s+$/, '')}\n\n${blocks.join('\n\n')}\n`;
    }
  }

  return normalizeBlankLines(segments.map((seg) => seg.text).join(''));
}

/** Remove every managed section — the uninstall path. */
export function stripSections(markdown) {
  const segments = splitFences(String(markdown ?? ''));
  for (const segment of segments) {
    if (segment.fenced) continue;
    for (const name of SECTIONS) {
      const re = new RegExp(`\\n?${escapeRe(markerStart(name))}[\\s\\S]*?${escapeRe(markerEnd(name))}\\n?`, 'g');
      segment.text = segment.text.replace(re, '\n');
    }
    // Any table left with no content at all (the paired team/feed wrapper).
    segment.text = segment.text.replace(/<table>[\s\S]*?<\/table>/g, (block) =>
      block.replace(/<[^>]+>/g, '').trim() === '' ? '' : block
    );
    segment.text = pruneEmptyScaffold(segment.text);
  }
  return normalizeBlankLines(segments.map((seg) => seg.text).join(''));
}

/**
 * Drop a scaffold heading when nothing is left under it. Only headings setup
 * itself wrote are candidates, so a human's empty heading stays put.
 */
function pruneEmptyScaffold(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!SCAFFOLD_HEADINGS.includes(lines[i].trim())) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    let hasBody = false;
    while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) {
      if (lines[j].trim()) {
        hasBody = true;
        break;
      }
      j += 1;
    }
    if (hasBody) out.push(lines[i]);
    else i = j - 1;
  }
  return out.join('\n');
}

function normalizeBlankLines(text) {
  return `${String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '')}\n`;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeMd(value) {
  // Escape only what can break a paragraph or a link; over-escaping makes feed
  // lines unreadable when copy-pasted as plain text.
  return String(value ?? '').replace(/([\\`*_[\]<>|])/g, '\\$1');
}

function truncate(value, max) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatStars(n) {
  const num = Number(n) || 0;
  return num >= 1000 ? `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k★` : `${num}★`;
}

/** Read + splice + write. Returns whether the file changed. */
export function writeReadme({ root = '.', readmePath, sections, order }) {
  const file = path.resolve(root, readmePath || 'README.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const after = spliceSections(before, sections, { order });
  if (before === after) return { changed: false, file, content: after };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  return { changed: true, file, content: after };
}
