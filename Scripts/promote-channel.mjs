#!/usr/bin/env node

import { basename, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  capture,
  env,
  readText,
  run,
  writeJson,
} from './lib/cli.mjs';

const [sourceArg, targetArg] = process.argv.slice(2);

if (!sourceArg || !targetArg) {
  throw new Error('Usage: promote-channel.mjs <source-channel> <target-channel>');
}

const sourceChannel = normalizeChannel(sourceArg);
const targetChannel = normalizeChannel(targetArg);
const storageRoot = stripTrailingSlash(
  env('APPHUB_STORAGE_ROOT', 'gs://tamber-artifacts/jamie-updater-demo'),
);
const publicRoot = stripTrailingSlash(
  env('APPHUB_PUBLIC_ROOT', 'https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo'),
);
const sourcePath = safeChannelPath(sourceChannel);
const targetPath = safeChannelPath(targetChannel);
const sourceCatalogObject = `channels/${sourcePath}/apphub-catalog.json`;
const targetCatalogObject = `channels/${targetPath}/apphub-catalog.json`;
const sourceCatalogUrl = `${publicRoot}/${sourceCatalogObject}`;
const targetCatalogUrl = `${publicRoot}/${targetCatalogObject}`;
const workDir = mkdtempSync(join(tmpdir(), 'eacp-promote-channel-'));
const catalogPath = join(workDir, 'apphub-catalog.json');
const indexPath = join(workDir, 'index.json');

const sourceCatalog = downloadJson(sourceCatalogUrl, `${storageRoot}/${sourceCatalogObject}`);
const targetCatalog = {
  ...sourceCatalog,
  products: sourceCatalog.products.map(promoteProduct),
};
writeJson(catalogPath, targetCatalog);
writeChannelIndex(indexPath);

run('gcloud', [
  'storage',
  'cp',
  catalogPath,
  `${storageRoot}/${targetCatalogObject}`,
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

console.log(JSON.stringify({
  sourceChannel,
  targetChannel,
  catalogUrl: targetCatalogUrl,
  products: targetCatalog.products.map((product) => ({
    id: product.id,
    latestVersion: product.latestVersion,
  })),
}, null, 2));

function promoteProduct(product) {
  return {
    ...product,
    channel: targetChannel,
    artifacts: (product.artifacts ?? []).map(promoteArtifact),
  };
}

function promoteArtifact(artifact) {
  const sourcePrefix = `${publicRoot}/channels/${sourcePath}/artifacts/`;
  if (!artifact.url.startsWith(sourcePrefix)) {
    return artifact;
  }

  const fileName = basename(new URL(artifact.url).pathname);
  const sourceObject = `${storageRoot}/channels/${sourcePath}/artifacts/${fileName}`;
  const targetObject = `${storageRoot}/channels/${targetPath}/artifacts/${fileName}`;
  run('gcloud', [
    'storage',
    'cp',
    sourceObject,
    targetObject,
    '--cache-control=no-cache,max-age=0',
  ]);

  return {
    ...artifact,
    url: `${publicRoot}/channels/${targetPath}/artifacts/${fileName}`,
  };
}

function downloadJson(publicUrl, storageUrl) {
  const publicResult = capture('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    publicUrl,
  ], { check: false });
  if (publicResult.status === 0) return JSON.parse(publicResult.stdout);

  const fallbackPath = join(workDir, 'download.json');
  run('gcloud', ['storage', 'cp', storageUrl, fallbackPath]);
  return JSON.parse(readText(fallbackPath));
}

function writeChannelIndex(indexPath) {
  const existing = capture('gcloud', [
    'storage',
    'cp',
    `${storageRoot}/index.json`,
    indexPath,
  ], { check: false });
  const index = existing.status === 0
    ? JSON.parse(readText(indexPath))
    : { defaultChannel: targetChannel, channels: [] };
  const channels = (index.channels ?? []).filter((entry) => entry.id !== targetChannel);
  channels.push({
    id: targetChannel,
    name: titleForChannel(targetChannel),
    catalogUrl: targetCatalogUrl,
    isDefault: (index.defaultChannel || targetChannel) === targetChannel,
  });
  index.defaultChannel = index.defaultChannel || targetChannel;
  index.channels = channels.sort((left, right) => left.id.localeCompare(right.id));
  writeJson(indexPath, index);
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
