import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { fail } from './ui.mjs';

// eacp-publish.json holds *preferences only*. Facts about the apps (bundle
// names, build paths, versions) come from the metadata files that
// eacp_updater_add_app() emits into <build>/eacp-publish/targets/.
export function loadConfig(cwd = process.cwd()) {
  const path = join(cwd, 'eacp-publish.json');
  if (!existsSync(path)) {
    fail(`no eacp-publish.json in ${cwd} — run 'eacp-publish init' to create one`);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`eacp-publish.json is not valid JSON: ${error.message}`);
  }

  const hosting = config.hosting ?? {};
  if (!hosting.storageRoot || !hosting.publicRoot) {
    fail('eacp-publish.json needs hosting.storageRoot and hosting.publicRoot');
  }
  hosting.storageRoot = String(hosting.storageRoot).replace(/\/+$/, '');
  hosting.publicRoot = String(hosting.publicRoot).replace(/\/+$/, '');

  config.channels = config.channels ?? {};
  config.channels.default = config.channels.default ?? 'stable';
  config.signing = config.signing ?? {};
  config.build = config.build ?? {};
  config.products = config.products ?? {};

  if (!config.hub && Object.keys(config.products).length === 0) {
    fail('eacp-publish.json defines no hub and no products — nothing to publish');
  }

  return { ...config, hosting, configPath: path, root: cwd };
}

// Targets the suite publishes: hub + products, each {productId, target}.
export function publishUnits(config) {
  const units = [];
  if (config.hub) units.push({ productId: config.hub.productId, target: config.hub.target, role: 'hub' });
  for (const [productId, product] of Object.entries(config.products)) {
    units.push({ productId, target: product.target, role: 'product' });
  }
  for (const unit of units) {
    if (!unit.productId || !unit.target) {
      fail('every hub/product entry needs { "productId"?, "target" } (productId is the key for products)');
    }
  }
  return units;
}

// Metadata emitted by eacp_updater_add_app() at configure/build time.
export function readTargetMetadata(buildDir, target) {
  const path = join(buildDir, 'eacp-publish', 'targets', `${target}.json`);
  if (!existsSync(path)) {
    fail(`no publish metadata for target '${target}' (${path}).\n`
      + `  Is the app declared with eacp_updater_add_app() and built?`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

// The C++ metadata tool built from the eacp-updater library. Searched, not
// configured: its location differs between top-level and CPM-consumed builds.
export function findUpdaterTool(buildDir) {
  const queue = [buildDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name === 'eacp-updater-tool') return resolve(path);
      if (entry.isDirectory() && entry.name !== 'CMakeFiles' && !entry.name.startsWith('.')) {
        queue.push(path);
      }
    }
  }
  fail(`eacp-updater-tool not found under ${buildDir} — build the 'eacp-updater-tool' target`
    + ` (EACP_UPDATER_BUILD_TOOLS must be ON)`);
}
