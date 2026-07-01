#!/usr/bin/env node

import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  capture,
  cleanDir,
  log,
  readText,
  run,
  sha256File,
  writeJson,
} from './lib/cli.mjs';
import {
  catalogUrl,
  channelArtifactObject,
  channelCatalogObject,
  channelInstallerManifestObject,
  configuredChannel,
  configuredVersion,
  emptyChannelIndex,
  loadPublishConfig,
  objectPublicUrl,
  objectStorageUrl,
  requireHubConfig,
  templateName,
  upsertChannel,
} from './lib/apphub-publish-config.mjs';

const { positionals, options } = parseArgs(process.argv.slice(2));
const [channelArg, versionArg] = positionals;

const config = loadPublishConfig(options.config);
const hub = requireHubConfig(config);
const channel = configuredChannel(config, channelArg);
const version = configuredVersion(versionArg);
const outDir = process.env.OUT_DIR ?? join(mkdtempSync(join(tmpdir(), 'eacp-apphub-channel-')), 'metadata');
const catalogObject = channelCatalogObject(channel);
const installerManifestObject = channelInstallerManifestObject(config, channel);
const packageName = templateName(hub.packageNameTemplate, {
  name: hub.name,
  productId: hub.productId,
  version,
});
const packageObject = channelArtifactObject(channel, packageName);
const packageStorageUrl = objectStorageUrl(config, packageObject);
const packagePublicUrl = objectPublicUrl(config, packageObject);
const currentCatalogUrl = catalogUrl(config, channel);

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
  productId: hub.productId,
  name: hub.name,
  version,
  bundleName: hub.bundleName,
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
run('gcloud', [
  'storage',
  'cp',
  installerManifestPath,
  objectStorageUrl(config, installerManifestObject),
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);

log(`Published AppHub ${channel} channel`);
console.log(JSON.stringify({
  channel,
  version,
  indexUrl: objectPublicUrl(config, 'index.json'),
  catalogUrl: currentCatalogUrl,
  installerManifestUrl: objectPublicUrl(config, installerManifestObject),
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
  const fallback = emptyChannelIndex(config, channel);
  const existingPath = join(outDir, 'existing-index.json');
  const existing = capture('gcloud', [
    'storage',
    'cp',
    objectStorageUrl(config, 'index.json'),
    existingPath,
  ], { check: false });
  const index = existing.status === 0 ? JSON.parse(readText(existingPath)) : fallback;
  return upsertChannel(index, config, channel);
}

function parseArgs(args) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--config') {
      options.config = args[++i];
      continue;
    }
    positionals.push(args[i]);
  }
  return { positionals, options };
}
