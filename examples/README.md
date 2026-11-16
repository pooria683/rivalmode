# Example configurations

RivalMode's defaults suit a small JS project. These five are tuned for the
categories most people actually ship. To use one:

```bash
cp examples/cli/config.json .rivalmode/config.json
node src/cli.mjs scoreboard
```

| Category | File | Signature tuning |
|:--|:--|:--|
| **App / SaaS** | `app/config.json` | stars and forks weigh heavily — distribution is the game |
| **CLI tool** | `cli/config.json` | a release is worth 40 — shipping installable software is the point |
| **Skill / agent / bot** | `skill/config.json` | commit-weighted; newer rivals allowed in, because the space moves weekly |
| **Site / docs / list** | `site/config.json` | commits weigh 1, issues closed weigh 6 — maintenance, not churn |
| **Library / SDK** | `library/config.json` | merges and releases dominate; a 14-point merge rewards review |

Every value here is optional. `rivals.fallbackTopics` is only used when your repo
has no GitHub topics of its own — set topics and that is what defines your
cluster.

**A note on fairness:** point tables are per-repo, so you can tune what "winning"
means for your kind of project. Rival ranking is always the same measure for
everyone (star velocity), so the ladder stays comparable even when two neighbours
score differently.
