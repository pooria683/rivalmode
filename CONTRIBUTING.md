# Contributing to RivalMode

The most useful contribution you can make is **a theme**. The cards are plain
SVG generated from a colour file, so a new look is a JSON file, no code, and it
shows up in every repo that installs RivalMode.

## Add a theme

1. Copy `themes/midnight.json` to `themes/<your-name>.json`.
2. Pick eleven colours (the contract below).
3. Add a row to the theme table in `README.md`.
4. Run `node tools/preview.mjs --theme=<your-name> --png` and look at the
   result. If text is unreadable or a bar disappears, fix the colours.
5. `npm test` and open a PR with a screenshot.

### The theme contract

```json
{
  "name": "midnight",
  "label": "Midnight",
  "dark": true,
  "background": "#0d1117",
  "panel": "#161b22",
  "border": "#30363d",
  "track": "#21262d",
  "text": "#e6edf3",
  "muted": "#8b949e",
  "accent": "#58a6ff",
  "accentSoft": "#1f6feb",
  "good": "#3fb950",
  "bad": "#f85149",
  "warn": "#d29922",
  "barColors": ["#58a6ff", "#3fb950"],
  "pattern": "grid",
  "shape": "rounded",
  "glow": true
}
```

| Key | Used for | Rules |
|:--|:--|:--|
| `background` / `panel` | card background, stat tiles | must differ enough that tiles read as tiles |
| `border` / `track` | hairlines, empty bar tracks | low contrast on purpose |
| `text` / `muted` | headlines vs labels | `text` needs ≥ 7:1 against `background` |
| `accent` / `accentSoft` | your row, today's bar, links | `accent` must survive against `panel` |
| `good` / `bad` / `warn` | momentum up, down, caveats | semantic; do not swap them |
| `barColors` | contributor bars, rival bars | 4–8 entries, all distinguishable from each other |
| `pattern` | background texture | `grid`, `scanlines`, `pitch`, or `none` |
| `shape` | card corners | `rounded` or `sharp` |
| `glow` | accent glow filter | `true` for neon, `false` for print-like |

Colour keys are **required** (`npm test` fails without them): `background`,
`panel`, `border`, `track`, `text`, `muted`, `accent`, `accentSoft`, `good`,
`bad`, `barColors`. The three style keys are optional and default to
`grid` / `rounded` / `false`.

**Hard rule:** every value is a six-digit hex colour or one of the three
enumerated strings. No gradients in the file, no external images, no fonts. The
SVGs are served through GitHub's Camo proxy, which blocks external references, so
a theme that needs them is broken by design.

### Test your theme properly

```bash
node tools/preview.mjs --theme=<name> --png   # renders every card
```

Check all five cards, not just the scoreboard: the rival ladder, the bar race,
the feed, and the badges all use your palette. Then look at a light-mode GitHub
page — a "dark" theme will still be read on a light README by some people, so
make sure your card is legible on a white surround.

## Fix a bug

Every behaviour worth keeping has a test. `npm test` runs the whole suite
offline against recorded fixtures in `tests/fixtures/api.mjs` — no token, no
network, ~1 second.

- **Scoring or ranking:** `tests/score.test.mjs`
- **SVG output:** `tests/svg.test.mjs` (golden files in `tests/golden/`)
- **README assembly:** `tests/readme.test.mjs`
- **APIs, degradation, the pipeline:** `tests/pipeline.test.mjs`

After a deliberate visual change, refresh the goldens:

```bash
UPDATE_GOLDEN=1 npm test
```

Review the diff before committing — a golden change is a design decision, not a
formality.

## Add a card

Cards live in `src/svg/`. A card is a function from data to
`{ svg, width, height }`, plus a registration in `src/render.mjs`, plus a section
in `src/render_readme.mjs`, plus a golden test.

Two design constraints:

1. **Fixed width.** 860px for full-width cards, 430px for the paired
   team/feed cards. GitHub renders README images at their intrinsic width.
2. **No external resources.** No webfonts, no `<image href>`, no CSS imports.
   Text is measured with `textWidth()` and truncated with `fitText()` — never
   trust a browser to clip it for you.

## Add a data source

Fetchers live in `src/lib/collect.mjs` and must be wrapped in `safe()`:

```js
const thing = await safe(log, 'thing', () => client.get(`/repos/${slug}/thing`), []);
```

A failed fetch degrades to an empty value plus one aggregated warning line. It
must never throw, never stall a run, and never turn into a zero that looks like
real data.

## Commit style

`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `perf:` — lowercase, imperative,
scoped where it helps (`feat(rivals):`, `fix(svg):`).

## Code of conduct

Be decent. RivalMode roasts repositories, not people; contributions that make
the game about individuals rather than projects will not be merged.
