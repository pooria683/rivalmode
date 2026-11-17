/**
 * Renders the same scoreboard in every theme and stacks them into one PNG for
 * the README's Themes section. Composition happens in SVG (vector in, one
 * raster at the end) so the result stays crisp and needs no image library.
 *
 *   node tools/make-theme-showcase.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderScoreboard } from '../src/svg/scoreboard.mjs';
import { loadTheme, listThemes } from '../src/lib/theme.mjs';
import { makeSnapshot, makeRivals, makeMomentum } from '../src/lib/mock.mjs';
import { DEFAULT_CONFIG } from '../src/lib/config.mjs';

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const OUT = path.join('assets', 'screenshots', 'themes.png');
const CARD_W = 780;
const GAP = 22;
const LABEL_H = 26;

const { snapshot } = makeSnapshot({ now: NOW, seed: 'showcase' });
const { rivals, ranking } = makeRivals({ now: NOW, self: snapshot });
const momentum = makeMomentum(snapshot, rivals, DEFAULT_CONFIG.points);

const themes = listThemes();
const cards = themes.map((name) => {
  const theme = loadTheme(name);
  const card = renderScoreboard({ snapshot, momentum, ranking, theme, now: NOW, title: 'RivalMode' });
  const height = Math.round((CARD_W * card.height) / card.width);
  return { name, theme, inner: stripWrapper(card.svg), cardW: card.width, cardH: card.height, height };
});

const totalH = GAP + cards.reduce((sum, c) => sum + LABEL_H + c.height + GAP, 0);
const totalW = CARD_W + GAP * 2;

const body = [];
body.push(`<rect width="${totalW}" height="${totalH}" fill="#f6f8fa"/>`);
let y = GAP;
for (const card of cards) {
  body.push(
    `<text x="${GAP + 2}" y="${y + 15}" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" font-weight="600" fill="#24292f">${card.theme.label}</text>`
  );
  const scale = CARD_W / card.cardW;
  body.push(
    `<g transform="translate(${GAP} ${y + LABEL_H}) scale(${scale})">${card.inner}</g>`
  );
  y += LABEL_H + card.height + GAP;
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
  body.join('') +
  '</svg>';

const png = new Resvg(svg, {
  // 1.5x is plenty for a README image and keeps the file well under 250 KB.
  fitTo: { mode: 'width', value: Math.round(totalW * 1.5) },
  font: { loadSystemFonts: true },
}).render().asPng();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`✔ ${OUT} (${Math.round(png.length / 1024)} KB, ${cards.length} themes)`);

/** Keep the card's own <defs> (unique ids per card) but drop the outer <svg>. */
function stripWrapper(svg) {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}
