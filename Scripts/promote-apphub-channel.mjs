#!/usr/bin/env node

import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  capture,
  log,
  readText,
  run,
  writeJson,
} from './lib/cli.mjs';
import {
  catalogUrl,
  channelCatalogObject,
  channelInstallerManifestObject,
  emptyChannelIndex,
  loadPublishConfig,
  normalizeChannel,
  objectPublicUrl,
  objectStorageUrl,
  upsertChannel,
} from './lib/apphub-publish-config.mjs';

const { positionals, options } = parseArgs(process.argv.slice(2));
const [sourceChannelArg, targetChannelArg] = positionals;

if (!sourceChannelArg || !targetChannelArg) {
  throw new Error('Usage: promote-apphub-channel.mjs <source-channel> <target-channel> --config <path>');
}

const config = loadPublishConfig(options.config);
const sourceChannel = normalizeChannel(sourceChannelArg);
const targetChannel = normalizeChannel(targetChannelArg);
if (sourceChannel === targetChannel) {
  throw new Error('Source and target channels must be different.');
}

const workDir = mkdtempSync(join(tmpdir(), 'eacp-promote-apphub-channel-'));

const sourceCatalogObject = channelCatalogObject(sourceChannel);
const targetCatalogObject = channelCatalogObject(targetChannel);
const sourceInstallerObject = channelInstallerManifestObject(config, sourceChannel);
const targetInstallerObject = channelInstallerManifestObject(config, targetChannel);
const targetCatalogUrl = catalogUrl(config, targetChannel);

log(`Download ${sourceChannel} AppHub catalog`);
const catalogPath = join(workDir, 'apphub-catalog.json');
run('gcloud', [
  'storage',
  'cp',
  objectStorageUrl(config, sourceCatalogObject),
  catalogPath,
]);

const catalog = JSON.parse(readText(catalogPath));
const promotedCatalog = promoteCatalog(catalog, targetChannel);
writeJson(catalogPath, promotedCatalog);

log(`Upload ${targetChannel} AppHub catalog`);
run('gcloud', [
  'storage',
  'cp',
  catalogPath,
  objectStorageUrl(config, targetCatalogObject),
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);

const installerManifestPath = join(workDir, 'hub-installer.json');
const promotedInstaller = promoteOptionalObject(
  objectStorageUrl(config, sourceInstallerObject),
  installerManifestPath,
  objectStorageUrl(config, targetInstallerObject),
);

log(`Update channel index for ${targetChannel}`);
const indexPath = join(workDir, 'index.json');
downloadOrDefault(objectStorageUrl(config, 'index.json'), indexPath, emptyChannelIndex(config, targetChannel));
const index = JSON.parse(readText(indexPath));
writeJson(indexPath, upsertChannel(index, config, targetChannel));

run('gcloud', [
  'storage',
  'cp',
  indexPath,
  objectStorageUrl(config, 'index.json'),
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);

log(`Promoted ${sourceChannel} to ${targetChannel}`);
console.log(JSON.stringify({
  sourceChannel,
  targetChannel,
  indexUrl: objectPublicUrl(config, 'index.json'),
  catalogUrl: targetCatalogUrl,
  installerManifestUrl: promotedInstaller
    ? objectPublicUrl(config, targetInstallerObject)
    : '',
}, null, 2));

function promoteCatalog(catalog, channel) {
  return {
    ...catalog,
    products: (catalog.products ?? []).map((product) => ({
      ...product,
      channel,
    })),
  };
}

function promoteOptionalObject(source, localPath, target) {
  const download = capture('gcloud', [
    'storage',
    'cp',
    source,
    localPath,
  ], { check: false });
  if (download.status !== 0) {
    return false;
  }

  run('gcloud', [
    'storage',
    'cp',
    localPath,
    target,
    '--content-type=application/json',
    '--cache-control=no-cache,max-age=0',
  ]);
  return true;
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
    if (args[i] === '--config') {
      options.config = args[++i];
      continue;
    }
    positionals.push(args[i]);
  }
  return { positionals, options };
}
