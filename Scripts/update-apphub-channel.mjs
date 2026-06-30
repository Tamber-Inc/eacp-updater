#!/usr/bin/env node

import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  capture,
  cleanDir,
  env,
  log,
  readText,
  run,
  sha256File,
  writeJson,
} from './lib/cli.mjs';

const [channelArg, versionArg] = process.argv.slice(2);

const channel = normalizeChannel(channelArg ?? env('APPHUB_CHANNEL', env('CHANNEL', 'stable')));
const version = versionArg ?? env('VERSION', '2.0.0');
const storageRoot = stripTrailingSlash(
  env('APPHUB_STORAGE_ROOT', 'gs://tamber-artifacts/jamie-updater-demo'),
);
const publicRoot = stripTrailingSlash(
  env('APPHUB_PUBLIC_ROOT', 'https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo'),
);
const outDir = env('OUT_DIR', join(mkdtempSync(join(tmpdir(), 'eacp-apphub-channel-')), 'metadata'));
const channelPath = safeChannelPath(channel);
const catalogObject = `channels/${channelPath}/apphub-catalog.json`;
const installerManifestObject = `channels/${channelPath}/hub-installer.json`;
const packageName = `AppHub-${version}.pkg`;
const packageObject = `channels/${channelPath}/artifacts/${packageName}`;
const packageStorageUrl = `${storageRoot}/${packageObject}`;
const packagePublicUrl = `${publicRoot}/${packageObject}`;
const catalogUrl = `${publicRoot}/${catalogObject}`;

log(`Validate AppHub package artifact for ${channel} ${version}`);
cleanDir(outDir);
const packagePath = join(outDir, packageName);
downloadPackage(packagePath);
const packageSha256 = sha256File(packagePath);

log(`Write AppHub ${channel} channel metadata`);
const catalogPath = join(outDir, 'apphub-catalog.json');
const indexPath = join(outDir, 'index.json');
const installerManifestPath = join(outDir, 'hub-installer.json');

writeJson(catalogPath, {
  catalogVersion: Number.parseInt(version.split('.')[0], 10) || 1,
  products: [],
  signature: '',
});

writeJson(indexPath, channelIndex());

writeJson(installerManifestPath, {
  productId: 'com.tamber.AppHub',
  name: 'AppHub',
  version,
  bundleName: 'AppHub.app',
  package: {
    url: packagePublicUrl,
    sha256: packageSha256,
  },
});

log(`Upload AppHub ${channel} channel metadata`);
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
run('gcloud', [
  'storage',
  'cp',
  installerManifestPath,
  `${storageRoot}/${installerManifestObject}`,
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);

log(`Published AppHub ${channel} channel`);
console.log(JSON.stringify({
  channel,
  version,
  indexUrl: `${publicRoot}/index.json`,
  catalogUrl,
  installerManifestUrl: `${publicRoot}/${installerManifestObject}`,
  package: {
    url: packagePublicUrl,
    sha256: packageSha256,
  },
}, null, 2));

function downloadPackage(packagePath) {
  const publicResult = capture('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    packagePublicUrl,
    '--output',
    packagePath,
  ], { check: false });
  if (publicResult.status === 0) {
    return;
  }

  run('gcloud', ['storage', 'cp', packageStorageUrl, packagePath]);
}

function channelIndex() {
  const fallback = { defaultChannel: channel, channels: [] };
  const existingPath = join(outDir, 'existing-index.json');
  const existing = capture('gcloud', [
    'storage',
    'cp',
    `${storageRoot}/index.json`,
    existingPath,
  ], { check: false });
  const index = existing.status === 0 ? JSON.parse(readText(existingPath)) : fallback;
  const channels = (index.channels ?? []).filter((entry) => entry.id !== channel);
  channels.push({
    id: channel,
    name: titleForChannel(channel),
    catalogUrl,
    isDefault: (index.defaultChannel || channel) === channel,
  });
  index.defaultChannel = index.defaultChannel || channel;
  index.channels = channels.sort((left, right) => left.id.localeCompare(right.id));
  return index;
}

function normalizeChannel(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || 'stable';
}

function safeChannelPath(value) {
  return normalizeChannel(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'stable';
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function titleForChannel(value) {
  return value
    .split(/[/-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || value;
}
