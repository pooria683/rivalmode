/**
 * Themes are plain JSON (see themes/), so a new look is a 20-line file and no
 * code. CONTRIBUTING.md explains the contract.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const THEMES_DIR = path.resolve(HERE, '..', '..', 'themes');

export const REQUIRED_KEYS = [
  'background',
  'panel',
  'border',
  'track',
  'text',
  'muted',
  'accent',
  'accentSoft',
  'good',
  'bad',
  'barColors',
];

export function listThemes(dir = THEMES_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadTheme(name = 'midnight', dir = THEMES_DIR) {
  const fallback = path.join(dir, 'midnight.json');
  const file = path.join(dir, `${name}.json`);
  const target = fs.existsSync(file) ? file : fallback;
  if (!fs.existsSync(target)) throw new Error(`RivalMode: no theme found for "${name}" and no fallback`);
  return validateTheme(JSON.parse(fs.readFileSync(target, 'utf8')));
}

export function validateTheme(theme) {
  const missing = REQUIRED_KEYS.filter((key) => theme?.[key] === undefined);
  if (missing.length) throw new Error(`RivalMode: theme is missing ${missing.join(', ')}`);
  if (!Array.isArray(theme.barColors) || theme.barColors.length === 0) {
    throw new Error('RivalMode: theme.barColors must be a non-empty array');
  }
  return {
    name: 'custom',
    label: 'Custom',
    dark: true,
    warn: theme.accentSoft,
    pattern: 'grid',
    shape: 'rounded',
    glow: false,
    ...theme,
  };
}

/** Deterministic bar colour for a name, so the same person keeps their colour. */
export function colorFor(theme, index, key = '') {
  const colors = theme.barColors;
  if (!key) return colors[index % colors.length];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return colors[(hash + index) % colors.length];
}
