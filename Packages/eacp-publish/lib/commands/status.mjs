import { loadConfig } from '../config.mjs';
import { createBackend } from '../hosting.mjs';
import { banner, dim, fail, step, table } from '../ui.mjs';

export async function status(args) {
  const config = loadConfig();
  const backend = await createBackend(config);

  const indexText = await backend.fetchText('index.json');
  if (!indexText) fail(`nothing published yet at ${config.hosting.publicRoot}/index.json`);
  const index = JSON.parse(indexText);

  banner(`Live channels at ${config.hosting.publicRoot}`);
  for (const channel of index.channels ?? []) {
    const marker = channel.id === index.defaultChannel ? ' (default)' : '';
    step(`${channel.id}${marker}`);

    const catalogText = await backend.fetchText(`channels/${channel.id}/catalog.json`);
    if (!catalogText) {
      console.log(dim('  no catalog'));
      continue;
    }
    const catalog = JSON.parse(catalogText);
    const rows = [];
    for (const product of catalog.products ?? []) {
      rows.push([product.id, product.latestVersion, `${product.artifacts?.length ?? 0} artifact(s)`]);
    }
    const hubManifest = config.hub
      ? await backend.fetchText(`channels/${channel.id}/products/${config.hub.productId}/manifest.json`)
      : null;
    if (hubManifest) {
      const manifest = JSON.parse(hubManifest);
      rows.push([manifest.productId, manifest.version, 'hub self-update manifest']);
    }
    if (rows.length === 0) console.log(dim('  empty catalog'));
    else table(rows);
  }
}
