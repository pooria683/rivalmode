/**
 * Dev helper: render every card from mock data so you can eyeball a theme
 * without touching GitHub. Optionally writes PNGs (needs @resvg/resvg-js,
 * which is a devDependency only — the runtime never imports it).
 *
 *   node tools/preview.mjs                 # all themes -> tmp/preview/*.svg
 *   node tools/preview.mjs --theme paper --png
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeSnapshot, makeRivals, makeMomentum } from '../src/lib/mock.mjs';
import { renderAll } from '../src/render.mjs';
import { listThemes } from '../src/lib/theme.mjs';
import { DEFAULT_CONFIG } from '../src/lib/config.mjs';

const args = process.argv.slice(2);
const wantPng = args.includes('--png');
const themeArg = valueOf('--theme');
const only = valueOf('--only');
const outRoot = path.join('tmp', 'preview');

const themes = themeArg ? [themeArg] : listThemes();

for (const theme of themes) {
  const config = { ...DEFAULT_CONFIG, theme, mock: true, title: 'RivalMode' };
  const { snapshot, rivals } = makeSnapshot({ intensity: 1 });
  const momentum = makeMomentum(snapshot, rivals, config.points);
  const ranking = { ...rivals.ranking, changes: { passed: [{ slug: 'acme/scoreboard-kit' }], passedBy: [] } };
  const { files } = renderAll({ snapshot, momentum, ranking, config, warnings: [] });
  const dir = path.join(outRoot, theme);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, svg] of Object.entries(files)) {
    if (only && !name.includes(only)) continue;
    fs.writeFileSync(path.join(dir, name), svg);
  }
  console.log(`rendered ${path.join(dir, '*.svg')}`);
}

if (wantPng) {
  const { Resvg } = await import('@resvg/resvg-js');
  for (const theme of themes) {
    const dir = path.join(outRoot, theme);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      if (only && !file.includes(only)) continue;
      const svg = fs.readFileSync(path.join(dir, file), 'utf8');
      const png = new Resvg(svg, { font: { loadSystemFonts: true }, background: 'transparent' }).render().asPng();
      fs.writeFileSync(path.join(dir, file.replace(/\.svg$/, '.png')), png);
    }
    console.log(`png'd ${dir}`);
  }
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : '';
}
