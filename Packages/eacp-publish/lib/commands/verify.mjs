import { createHash } from 'node:crypto';

import { loadConfig } from '../config.mjs';
import { createBackend } from '../hosting.mjs';
import { banner, fail, ok, step } from '../ui.mjs';

// Downloads everything a fresh user's hub would download and checks it:
// catalog parses, every artifact is reachable, every sha256 matches.
export async function verify(args) {
  const config = loadConfig();
  const backend = await createBackend(config);
  const channel = args.options.channel ?? config.channels.default;

  step(`Verify channel '${channel}'`);

  const indexText = await backend.fetchText('index.json');
  if (!indexText) fail('index.json is missing');
  const index = JSON.parse(indexText);
  if (!(index.channels ?? []).some((entry) => entry.id === channel)) {
    fail(`index.json does not list channel '${channel}'`);
  }
  ok('index.json lists the channel');

  const catalogText = await backend.fetchText(`channels/${channel}/catalog.json`);
  if (!catalogText) fail('catalog.json is missing');
  const catalog = JSON.parse(catalogText);
  ok(`catalog.json parses (${catalog.products.length} products)`);

  let failures = 0;
  for (const product of catalog.products) {
    for (const artifact of product.artifacts ?? []) {
      const response = await fetch(artifact.url, { cache: 'no-store' });
      if (!response.ok) {
        console.error(`  ✗ ${product.id}: ${artifact.url} → HTTP ${response.status}`);
        failures += 1;
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== artifact.sha256) {
        console.error(`  ✗ ${product.id}: sha256 mismatch (${sha.slice(0, 12)}… != ${artifact.sha256.slice(0, 12)}…)`);
        failures += 1;
      } else {
        ok(`${product.id} ${product.latestVersion}: artifact downloads and sha256 matches`);
      }
    }
  }

  if (failures > 0) fail(`${failures} problem(s) found`);
  banner(`Channel '${channel}' verifies clean — a fresh install would succeed`);
}
