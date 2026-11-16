/**
 * Install and uninstall.
 *
 * Install writes: .rivalmode/config.json (if absent), the three workflows,
 * a stub README with section markers if there's no README, and an intro
 * scaffold if the README exists but has never been touched by RivalMode.
 *
 * Uninstall deletes `.rivalmode/`, the workflows, and every generated SVG, then
 * strips the managed sections from the README. Nothing else is touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, HOME_DIR, configPath, loadConfig, saveConfig, stateDir } from './lib/config.mjs';
import { SECTIONS, spliceSections, stripSections, wrap } from './render_readme.mjs';
import { THEMES_DIR, listThemes } from './lib/theme.mjs';

export const WORKFLOW_FILES = ['scoreboard.yml', 'rivals.yml', 'weekly-recap.yml', 'rivalmode-setup.yml'];

const README_SCAFFOLD = `# {title}

{tagline}

<!-- rivalmode:intro -->
> **This README updates itself.** Commits, merges, stars and rivals are pulled
> from the GitHub API every hour and drawn into the cards below.
<!-- /rivalmode:intro -->

`;

/**
 * @param {string} root
 * @param {{repo?:string, theme?:string, title?:string, readme?:string, force?:boolean, private?:boolean}} options
 */
export function setupRepo(root = '.', { repo = '', theme = '', title = '', readme = '', force = false, private: privateMode } = {}) {
  const log = [];
  const config = loadConfig(root).repo ? loadConfig(root) : { ...DEFAULT_CONFIG };

  if (repo) config.repo = repo;
  if (theme) {
    if (!listThemes().includes(theme)) {
      throw new Error(`unknown theme "${theme}" — available: ${listThemes().join(', ')}`);
    }
    config.theme = theme;
  }
  if (title) config.title = title;
  if (readme) config.readme = readme;
  if (privateMode !== undefined) config.private = Boolean(privateMode);

  const existed = fs.existsSync(configPath(root));
  const configFile = saveConfig(config, root);
  log.push(`${existed ? 'updated' : 'created'} ${rel(root, configFile)}`);

  // Ensure the state dir exists so the first run has somewhere to write.
  fs.mkdirSync(stateDir(root), { recursive: true });
  const keep = path.join(stateDir(root), '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');

  // Workflows ship with the template. When setup runs inside another repo we
  // copy them from the RivalMode source tree; inside RivalMode itself they are
  // already in place.
  const workflowDir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let installed = 0;
  for (const file of WORKFLOW_FILES) {
    const target = path.join(workflowDir, file);
    const source = path.join(sourceRoot, '.github', 'workflows', file);
    if (fs.existsSync(target) && !force) continue;
    if (fs.existsSync(source) && path.resolve(source) !== path.resolve(target)) {
      fs.copyFileSync(source, target);
      installed += 1;
    } else if (!fs.existsSync(target)) {
      log.push(`warning: no template workflow for ${file}`);
    }
  }
  if (installed) log.push(`installed ${installed} workflow(s) in .github/workflows/`);

  // README scaffolding + markers. We deliberately write placeholders rather
  // than fake numbers: the first workflow run replaces them with real data.
  const readmeFile = path.join(root, config.readme);
  const sections = placeholderSections(config);

  if (!fs.existsSync(readmeFile)) {
    const scaffold = README_SCAFFOLD.replace('{title}', config.title).replace(
      '{tagline}',
      'A live, self-updating scoreboard for this repository — powered by [RivalMode](https://github.com/pooria683/rivalmode).'
    );
    fs.mkdirSync(path.dirname(readmeFile), { recursive: true });
    fs.writeFileSync(readmeFile, spliceSections(scaffold, sections));
    log.push(`created ${rel(root, readmeFile)} with section markers`);
  } else {
    const before = fs.readFileSync(readmeFile, 'utf8');
    const hasMarkers = SECTIONS.some((name) => before.includes(`rivalmode:start ${name}`));
    if (hasMarkers) {
      log.push(`kept existing sections in ${rel(root, readmeFile)}`);
    } else {
      const after = `${before.replace(/\s+$/, '')}\n\n## ⚔️ Live scoreboard\n\n${spliceSections('', sections).replace(/^\n+/, '')}`;
      fs.writeFileSync(readmeFile, after);
      log.push(`added scoreboard sections to ${rel(root, readmeFile)}`);
    }
  }

  return {
    root: path.resolve(root),
    config: rel(root, configFile),
    theme: config.theme,
    themes: listThemes(),
    log,
  };
}

export function uninstallRepo(root = '.', { dryRun = false } = {}) {
  const log = [];
  const config = loadConfig(root);

  // 1. strip README sections
  const readmeFile = path.join(root, config.readme);
  if (fs.existsSync(readmeFile)) {
    const before = fs.readFileSync(readmeFile, 'utf8');
    const after = stripSections(before);
    if (after !== before) {
      if (!dryRun) fs.writeFileSync(readmeFile, after);
      log.push(`${dryRun ? 'would strip' : 'stripped'} managed sections from ${rel(root, readmeFile)}`);
    }
  }

  // 2. remove workflows
  for (const file of WORKFLOW_FILES) {
    const target = path.join(root, '.github', 'workflows', file);
    if (fs.existsSync(target)) {
      if (!dryRun) fs.unlinkSync(target);
      log.push(`${dryRun ? 'would delete' : 'deleted'} ${rel(root, target)}`);
    }
  }

  // 3. remove generated assets
  const assetsDir = path.join(root, config.outDir);
  if (fs.existsSync(assetsDir)) {
    if (!dryRun) fs.rmSync(assetsDir, { recursive: true, force: true });
    log.push(`${dryRun ? 'would delete' : 'deleted'} ${rel(root, assetsDir)}/`);
  }

  // 4. remove state + config
  const home = path.join(root, HOME_DIR);
  if (fs.existsSync(home)) {
    if (!dryRun) fs.rmSync(home, { recursive: true, force: true });
    log.push(`${dryRun ? 'would delete' : 'deleted'} ${rel(root, home)}/`);
  }

  if (!log.length) log.push('nothing to remove — this repo is already clean');
  return { root: path.resolve(root), dryRun, log };
}

function rel(root, file) {
  return path.relative(path.resolve(root), path.resolve(file)) || '.';
}

/** Empty-but-valid sections for a repo that has never run the pipeline. */
export function placeholderSections(config = DEFAULT_CONFIG) {
  const pending = '_⏳ Waiting for the first workflow run — this section fills itself in._';
  return {
    badges: '_⏳ badges appear after the first run_',
    scoreboard: pending,
    rivals: pending,
    team: pending,
    feed: pending,
    conquests: pending,
    footer: `<sub>⚔️ Powered by [RivalMode](https://github.com/pooria683/rivalmode) · theme \`${config.theme}\`</sub>`,
  };
}

export { THEMES_DIR };
