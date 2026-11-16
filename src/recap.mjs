/**
 * The Monday recap. This is the shareable artefact: a friendly week-in-review
 * with real numbers, the top contributor, and — if a rival gained on you — one
 * (1) roast, clearly labelled. Roasts stay about the repo, never a person.
 */
import { DAY, isoWeekLabel, shortDate } from './lib/dates.mjs';
import { weeklyPoints } from './lib/score.mjs';

export function buildRecap({ snapshot, momentum, ranking, rivals, history = [], feed = [], config, now = Date.now() }) {
  const points = weeklyPoints(snapshot, config.points);
  const weekStart = new Date(now - 7 * DAY);
  const rankThen = pickRankAt(history, weekStart);

  const contributors = (snapshot.leaderboard || []).filter((c) => (c.monthCommits || 0) > 0);
  const top = contributors[0] || snapshot.leaderboard?.[0] || null;

  const starsThisWeek = (snapshot.stars?.recent || []).filter((s) => s.at && new Date(s.at).getTime() >= weekStart.getTime());
  const newContributors = (snapshot.leaderboard || []).filter((c) => (c.monthCommits || 0) > 0 && c.contributions <= (c.monthCommits || 0));

  const changes = ranking?.changes || { passed: [], passedBy: [] };
  const roast = buildRoast({ ranking, momentum, changes, rivals });

  const week = isoWeekLabel(now);
  return {
    week,
    weekStart: weekStart.toISOString(),
    weekEnd: new Date(now).toISOString(),
    repo: snapshot.repo,
    points,
    momentum,
    rank: ranking?.rank ?? null,
    clusterSize: ranking?.clusterSize ?? null,
    rankChange: rankThen != null && ranking?.rank != null ? rankThen - ranking.rank : null,
    topContributor: top
      ? { login: top.login, commits: top.monthCommits || 0, allTime: top.contributions, url: top.url }
      : null,
    committers: contributors.slice(0, 5).map((c) => ({ login: c.login, commits: c.monthCommits || 0 })),
    newStars: starsThisWeek.length,
    newContributors: newContributors.length,
    commits: snapshot.commits?.week ?? 0,
    prevCommits: snapshot.commits?.prev7 ?? 0,
    merges: snapshot.merges?.week ?? 0,
    releases: (snapshot.releases || []).filter((r) => new Date(r.at) >= weekStart).length,
    issuesClosed: snapshot.issues?.last7 ?? 0,
    streak: snapshot.commits?.streak ?? 0,
    passed: changes.passed || [],
    passedBy: changes.passedBy || [],
    rivalsTracked: rivals?.rivals?.length ?? ranking?.entries?.length - 1 ?? 0,
    fans: (rivals?.fans || []).slice(0, 3),
    roast,
    highlights: buildHighlights({ feed, snapshot, weekStart }),
  };
}

function pickRankAt(history, when) {
  const target = when.toISOString().slice(0, 10);
  const candidates = (history || []).filter((h) => h.date <= target && h.rank != null);
  return candidates.length ? candidates[candidates.length - 1].rank : null;
}

function buildHighlights({ feed, snapshot, weekStart }) {
  const items = (feed || []).filter((f) => new Date(f.at) >= weekStart);
  const pushes = items.filter((f) => f.type === 'PushEvent').length;
  const stars = items.filter((f) => f.type === 'WatchEvent').length;
  const prs = items.filter((f) => f.type === 'PullRequestEvent').length;
  return { events: items.length, pushes, stars, prs };
}

/**
 * The roast. One line, honest, never mean, and only about the repo's own data.
 * If nothing bad happened, it brags instead — which is also shareable.
 */
export function buildRoast({ ranking, momentum, changes, rivals }) {
  const passedBy = changes?.passedBy?.[0];
  const passed = changes?.passed?.[0];

  if (passedBy) {
    const name = passedBy.slug || 'a rival';
    return {
      tone: 'roast',
      text: `\`${name}\` passed you this week. You shipped ${momentum.current.commits} commits; they shipped more. Consider this a formal challenge.`,
    };
  }
  if (passed) {
    return {
      tone: 'brag',
      text: `You overtook \`${passed.slug || 'a rival'}\` and nobody has passed you back. ${ranking?.nextTarget ? `Next target: \`${ranking.nextTarget.slug}\`.` : 'You are the top of the ladder.'}`,
    };
  }
  const faster = (rivals?.rivals || [])
    .filter((r) => (r.velocity || 0) > (ranking?.self?.velocity ?? Infinity))
    .sort((a, b) => b.velocity - a.velocity)[0];
  if (faster) {
    return {
      tone: 'warn',
      text: `\`${faster.slug}\` is gaining ${Math.round((faster.velocity - (ranking?.self?.velocity ?? 0)) * 100) / 100}★/day faster than you. They are coming.`,
    };
  }
  if (momentum.direction === 'down') {
    return {
      tone: 'roast',
      text: `Momentum fell to ${momentum.score} — fewer commits than last week. The only thing standing between you and a rival is a \`git push\`.`,
    };
  }
  if (momentum.score > 30) {
    return { tone: 'brag', text: `Momentum at ${momentum.score > 0 ? '+' : ''}${momentum.score}. Whatever you did this week, do it again.` };
  }
  return {
    tone: 'flat',
    text: 'A quiet week, rank unchanged. Repositories are won on the boring weeks — keep the streak alive.',
  };
}

export function recapMarkdown(recap, { config, snapshot } = {}) {
  const { repo } = recap;
  const lines = [];
  const place = recap.rank ? `#${recap.rank} of ${recap.clusterSize}` : 'unranked';
  const rankMove =
    recap.rankChange == null
      ? ''
      : recap.rankChange > 0
        ? ` (▲${recap.rankChange} this week)`
        : recap.rankChange < 0
          ? ` (▼${Math.abs(recap.rankChange)} this week)`
          : ' (no change)';

  lines.push(`## ⚔️ RivalMode weekly recap — ${recap.week}`);
  lines.push('');
  lines.push(`Here's what \`${repo.slug}\` did between **${shortDate(recap.weekStart)}** and **${shortDate(recap.weekEnd)}**.`);
  lines.push('');
  lines.push('| | |');
  lines.push('|:--|:--|');
  lines.push(`| **Points earned** | **${recap.points.total}** |`);
  lines.push(`| Momentum | ${signed(recap.momentum.score)} (${recap.momentum.label}) |`);
  lines.push(`| Commits | ${recap.commits} this week (${delta(recap.commits, recap.prevCommits)} vs last week) |`);
  lines.push(`| Merged PRs | ${recap.merges} |`);
  lines.push(`| Issues closed | ${recap.issuesClosed} |`);
  lines.push(`| Releases | ${recap.releases} |`);
  lines.push(`| New stars | ${recap.newStars}★ |`);
  lines.push(`| Commit streak | ${recap.streak} day${recap.streak === 1 ? '' : 's'} |`);
  lines.push(`| Cluster rank | **${place}**${rankMove} |`);
  lines.push('');

  if (recap.topContributor) {
    lines.push(
      `### 🏆 Contributor of the week: [${recap.topContributor.login}](${recap.topContributor.url})`
    );
    lines.push('');
    lines.push(
      `${recap.topContributor.commits} commits this month (${recap.topContributor.allTime} all-time). ${
        recap.committers.length > 1
          ? `Chasing: ${recap.committers
              .slice(1)
              .map((c) => `\`${c.login}\` (${c.commits})`)
              .join(', ')}.`
          : 'Nobody is close.'
      }`
    );
    lines.push('');
  }

  lines.push(`### ${recap.roast.tone === 'brag' ? '😤 The good news' : recap.roast.tone === 'flat' ? '📈 Where you stand' : '🔥 The roast'}`);
  lines.push('');
  lines.push(`> ${recap.roast.text}`);
  lines.push('');

  if (recap.passed.length || recap.passedBy.length) {
    lines.push('### Ladder moves');
    lines.push('');
    for (const p of recap.passed) lines.push(`- ✅ you passed \`${p.slug}\``);
    for (const p of recap.passedBy) lines.push(`- ⚠️ \`${p.slug}\` passed you`);
    lines.push('');
  }

  if (recap.fans.length) {
    lines.push(`### 💛 Fans worth following`);
    lines.push('');
    lines.push(recap.fans.map((f) => `[${f.login}](${f.url})`).join(' · '));
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `<sub>Generated by [RivalMode](https://github.com/pooria683/rivalmode) for \`${repo.slug}\` · theme \`${config?.theme ?? 'midnight'}\` · ` +
      `${recap.rivalsTracked} rivals tracked · numbers from the GitHub API, nothing hand-edited.</sub>`
  );
  void snapshot;
  return `${lines.join('\n')}\n`;
}

function signed(n) {
  const num = Number(n) || 0;
  return `${num > 0 ? '+' : ''}${num}`;
}

function delta(now, before) {
  const diff = (Number(now) || 0) - (Number(before) || 0);
  if (diff === 0) return 'flat';
  return `${diff > 0 ? '+' : ''}${diff}`;
}
