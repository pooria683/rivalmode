/**
 * Turn "something went sideways" into one honest line on the card.
 * RivalMode never hides a failed fetch behind a zero: a 0 is a fact, a failure
 * is a caveat, and people can tell the difference.
 *
 * Warnings are aggregated by kind — ten failed lookups are one sentence, not
 * ten, because a README full of caveats is worse than a README with one.
 */
const RULES = [
  { match: /star velocity|stargazers/i, text: 'rival star velocity is estimated (some lookups were skipped)' },
  { match: /fork comparison/i, text: 'fork commit counts are partial this run' },
  { match: /topic search|search budget|rate limit/i, text: 'rival search was rate-limited — reusing the last ladder' },
  { match: /fan lookup|users\//i, text: 'stargazer profiles were partly unavailable' },
  { match: /merged pull requests|closed issues/i, text: 'some PR/issue counts are incomplete' },
  { match: /commit history/i, text: 'commit history was truncated — daily counts are a lower bound' },
  { match: /contributors/i, text: 'contributor list was truncated' },
];

export function warningsFor({ snapshot, rivals, client, log }) {
  const raw = [...(log?.warnings || [])];
  const warnings = [];
  const seenRules = new Set();

  for (const message of raw) {
    const rule = RULES.find((r) => r.match.test(message));
    if (rule) {
      if (!seenRules.has(rule.text)) {
        seenRules.add(rule.text);
        warnings.push(rule.text);
      }
      continue;
    }
    push(shortClean(message));
  }

  if (snapshot?.degraded) push('private repo: rival search disabled, showing your own numbers only');
  if (snapshot?.commits?.truncated) push('commit history truncated at 400 — daily counts are a lower bound');
  if (rivals?.reused) push('rival ladder cached from the last daily run');

  const stats = client?.stats?.();
  if (stats?.searchExhausted) push('GitHub search budget exhausted — the ladder updates again at the next reset');

  function push(msg) {
    if (msg && !warnings.includes(msg)) warnings.push(msg);
  }

  return warnings.slice(0, 4);
}

function shortClean(message) {
  const text = String(message)
    .replace(/^[a-z0-9 _-]+:\s*/i, (m) => (m.length < 40 ? m : ''))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 96 ? `${text.slice(0, 95)}…` : text;
}
