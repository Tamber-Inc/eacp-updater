#!/usr/bin/env node

import { basename, extname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  capture,
  env,
  fileExists,
  readText,
  run,
  sha256File,
  writeJson,
} from './lib/cli.mjs';

const [filePath, versionArg, channelArg] = process.argv.slice(2);

if (!filePath || !versionArg) {
  throw new Error('Usage: publish-artifact.mjs <filepath> <version> [channel]');
}
if (!fileExists(filePath)) {
  throw new Error(`Artifact does not exist: ${filePath}`);
}

const version = versionArg;
const channel = normalizeChannel(channelArg ?? env('APPHUB_CHANNEL', env('CHANNEL', 'stable')));
const product = productFor(filePath);
const storageRoot = stripTrailingSlash(
  env('APPHUB_STORAGE_ROOT', 'gs://tamber-artifacts/jamie-updater-demo'),
);
const publicRoot = stripTrailingSlash(
  env('APPHUB_PUBLIC_ROOT', 'https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo'),
);
const channelPath = safeChannelPath(channel);
const extension = extname(filePath) || '.blob';
const artifactName = `${product.id}-${version}${extension}`;
const artifactObject = `channels/${channelPath}/artifacts/${artifactName}`;
const catalogObject = `channels/${channelPath}/apphub-catalog.json`;
const artifactUrl = `${publicRoot}/${artifactObject}`;
const catalogUrl = `${publicRoot}/${catalogObject}`;
const workDir = mkdtempSync(join(tmpdir(), 'eacp-publish-artifact-'));
const catalogPath = join(workDir, 'apphub-catalog.json');
const indexPath = join(workDir, 'index.json');

downloadOrDefault(`${storageRoot}/${catalogObject}`, catalogPath, {
  catalogVersion: Number.parseInt(version.split('.')[0], 10) || 1,
  products: [],
  signature: '',
});

const catalog = JSON.parse(readText(catalogPath));
const nextCatalog = replaceCatalogProduct(catalog, {
  id: product.id,
  name: product.name,
  kind: product.kind,
  bundleName: '',
  channel,
  latestVersion: version,
  dependencies: [],
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

downloadOrDefault(`${storageRoot}/index.json`, indexPath, {
  defaultChannel: channel,
  channels: [],
});
const index = JSON.parse(readText(indexPath));
const channels = (index.channels ?? []).filter((entry) => entry.id !== channel);
channels.push({
  id: channel,
  name: titleForChannel(channel),
  catalogUrl,
  isDefault: (index.defaultChannel || channel) === channel,
});
index.defaultChannel = index.defaultChannel || channel;
index.channels = channels.sort((left, right) => left.id.localeCompare(right.id));
writeJson(indexPath, index);

run('gcloud', [
  'storage',
  'cp',
  filePath,
  `${storageRoot}/${artifactObject}`,
  '--cache-control=no-cache,max-age=0',
]);
run('gcloud', [
  'storage',
  'cp',
  catalogPath,
  `${storageRoot}/${catalogObject}`,
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);
run('gcloud', [
  'storage',
  'cp',
  indexPath,
  `${storageRoot}/index.json`,
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);

console.log(JSON.stringify({ product: nextCatalog.products.find((entry) => entry.id === product.id), catalogUrl }, null, 2));

function productFor(path) {
  const id = env('APPHUB_PRODUCT_ID', '').trim();
  if (!id) {
    throw new Error('APPHUB_PRODUCT_ID is required to publish a generic artifact.');
  }
  return {
    id,
    name: env('APPHUB_PRODUCT_NAME', id),
    kind: env('APPHUB_PRODUCT_KIND', inferKind(path)),
  };
}

function replaceCatalogProduct(catalog, product) {
  return {
    ...catalog,
    products: [
      ...(catalog.products ?? []).filter((entry) => entry.id !== product.id),
      product,
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function inferKind(path) {
  return extname(path).toLowerCase() === '.app' ? 'App' : 'Blob';
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

function normalizeChannel(channel) {
  const trimmed = String(channel ?? '').trim();
  return trimmed || 'stable';
}

function safeChannelPath(channel) {
  return normalizeChannel(channel)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'stable';
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function titleForChannel(channel) {
  return channel
    .split(/[/-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || channel;
}
