# Launch notes

Ready-to-post copy for the first release. Numbers below are placeholders —
fill them from the live README on the day, never invent them.

---

## The hook (X / Bluesky / Mastodon)

> My repo roasts me when a rival passes it.
>
> I built RivalMode: a GitHub Action that draws a live scoreboard into your
> README — commits, streaks, star velocity, and the repos in your topic cluster
> that are gaining on you.
>
> No servers. No accounts. No tokens. Click "Use this template" and it's on.
> [link]

**Attach:** `assets/demo/rivalmode-demo.gif` (the overtake moment is at ~4.5s,
so a trimmed clip or a GIF starting mid-way works better than the full loop).

**Pin the reply:** a screenshot of the README at the moment a fork out-committed
you, with the `⚠️ A RIVAL JUST PASSED YOU` line visible.

---

## Show HN / r/webdev

**Title:** Show HN: RivalMode – my repo's README roasts me when a rival passes it

**Body:**

> I kept shipping to a repo nobody looked at, which is a hard thing to keep
> doing. RivalMode makes the repo score itself: every hour a workflow pulls the
> repo's own numbers, renders them as SVG cards, and commits them back into the
> README.
>
> Two things made it more than a badge wall:
>
> **Rivals.** Once a day it searches your topics for repos your own size, ranks
> everyone by star velocity, and draws the ladder with you highlighted. Being
> "#4,000 in `github-actions`" is true and useless; being #4 of 12 repos your
> own size is a game you can win this month. It also compares forks against
> upstream — a fork with more commits than you is the purest rivalry there is.
>
> **The roast.** When someone passes you, the README says so, and the Monday
> recap posts a week-in-review comment with one honest line about how the week
> went.
>
> The whole thing is one Node file, zero runtime dependencies, hand-written SVG,
> and it degrades honestly: private repos get their own numbers, rate limits get
> a footnote, and a failed fetch never becomes a zero.
>
> It's MIT and it's meant to be beaten by the repo above you: [link]

**First comment (the technical bit):**

> Implementation notes people usually ask about:
>
> - **State lives in the repo.** `.rivalmode/state/*.json` is committed by the
>   bot, so there's no database and `git log` is the audit trail.
> - **Idempotent writes.** If a run produces identical bytes, nothing is
>   committed. A second run is a literal no-op — there's a CI test for that.
> - **Rate limits.** Conditional requests with ETags, a committed cache, and
>   search only once a day. The hourly job usually costs a handful of calls.
> - **The README is the only UI.** Generation is confined to HTML comment
>   markers, so you can keep writing around it. Markers quoted inside code
>   fences are ignored.
> - **Zero runtime dependencies.** The SVG is hand-written, so there's no
>   package to install and nothing to break.

---

## Checklist before posting

- [ ] The live README shows a real rank with at least three rivals in the cluster
- [ ] `assets/demo/rivalmode-demo.gif` is under 1.5 MB and plays in the GitHub
      mobile app
- [ ] Topics are set on the repo (this is what makes the ladder work)
- [ ] The weekly recap issue exists and has one comment
- [ ] `npm test` is green on `main`
- [ ] The "Use this template" link resolves to
      `github.com/pooria683/rivalmode/generate`
