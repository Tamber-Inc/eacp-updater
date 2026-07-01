#!/usr/bin/env node

import { extname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  capture,
  fileExists,
  readText,
  run,
  sha256File,
  writeJson,
} from './lib/cli.mjs';
import {
  catalogUrl,
  channelArtifactObject,
  channelCatalogObject,
  configuredChannel,
  configuredProduct,
  configuredVersion,
  emptyChannelIndex,
  loadPublishConfig,
  objectPublicUrl,
  objectStorageUrl,
  upsertChannel,
} from './lib/apphub-publish-config.mjs';

const { positionals, options } = parseArgs(process.argv.slice(2));
const [filePath, versionArg, channelArg] = positionals;

if (!filePath || !versionArg) {
  throw new Error('Usage: publish-artifact.mjs <filepath> <version> [channel] [--product <id>]');
}
if (!fileExists(filePath)) {
  throw new Error(`Artifact does not exist: ${filePath}`);
}

const config = loadPublishConfig(options.config);
const version = configuredVersion(versionArg);
const channel = configuredChannel(config, channelArg);
const product = configuredProduct(config, options.product, filePath);
const extension = extname(filePath) || '.blob';
const artifactName = `${product.id}-${version}${extension}`;
const artifactObject = channelArtifactObject(channel, artifactName);
const catalogObject = channelCatalogObject(channel);
const artifactUrl = objectPublicUrl(config, artifactObject);
const currentCatalogUrl = catalogUrl(config, channel);
const workDir = mkdtempSync(join(tmpdir(), 'eacp-publish-artifact-'));
const catalogPath = join(workDir, 'apphub-catalog.json');
const indexPath = join(workDir, 'index.json');

downloadOrDefault(objectStorageUrl(config, catalogObject), catalogPath, {
  catalogVersion: Number.parseInt(version.split('.')[0], 10) || 1,
  products: [],
  signature: '',
});

const catalog = JSON.parse(readText(catalogPath));
const nextCatalog = replaceCatalogProduct(catalog, {
  id: product.id,
  name: product.name,
  kind: product.kind,
  bundleName: product.bundleName,
  channel,
  latestVersion: version,
  dependencies: product.dependencies,
  artifacts: [
    {
      platform: 'MacOS',
      architecture: 'Universal',
      url: artifactUrl,
      sha256: sha256File(filePath),
      signature: '',
    },
  ],
});
nextCatalog.catalogVersion = Math.max(
  Number(nextCatalog.catalogVersion) || 0,
  Number.parseInt(version.split('.')[0], 10) || 1,
);
writeJson(catalogPath, nextCatalog);

downloadOrDefault(objectStorageUrl(config, 'index.json'), indexPath, emptyChannelIndex(config, channel));
const index = JSON.parse(readText(indexPath));
writeJson(indexPath, upsertChannel(index, config, channel));

run('gcloud', [
  'storage',
  'cp',
  filePath,
  objectStorageUrl(config, artifactObject),
  '--cache-control=no-cache,max-age=0',
]);
run('gcloud', [
  'storage',
  'cp',
  catalogPath,
  objectStorageUrl(config, catalogObject),
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);
run('gcloud', [
  'storage',
  'cp',
  indexPath,
  objectStorageUrl(config, 'index.json'),
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);

console.log(JSON.stringify({ product: nextCatalog.products.find((entry) => entry.id === product.id), catalogUrl: currentCatalogUrl }, null, 2));

function replaceCatalogProduct(catalog, product) {
  return {
    ...catalog,
    products: [
      ...(catalog.products ?? []).filter((entry) => entry.id !== product.id),
      product,
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function downloadOrDefault(source, destination, fallback) {
  const result = capture('gcloud', [
    'storage',
    'cp',
    source,
    destination,
  ], { check: false });
  if (result.status !== 0) writeJson(destination, fallback);
}

function parseArgs(args) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--product') {
      options.product = args[++i];
      continue;
    }
    if (args[i] === '--config') {
      options.config = args[++i];
      continue;
    }
    positionals.push(args[i]);
  }
  return { positionals, options };
}
