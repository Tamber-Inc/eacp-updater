#!/usr/bin/env node

import { join } from 'node:path';

import {
  eacpSourceDir,
  capture,
  cleanDir,
  env,
  log,
  readText,
  repoRoot,
  requireMacOS,
  run,
  sha256File,
  writeJson,
} from './lib/cli.mjs';
import {
  findCatalogAppBundle,
} from './lib/apphub-generated-catalog.mjs';
import {
  catalogProducts,
  replaceCatalogProduct,
} from './lib/apphub-catalog.mjs';
import {
  ensureTamberSigningIdentity,
  notarizeAndStapleApps,
  signPath,
  validateStapledApp,
  verifyCodeSignature,
  verifyGatekeeperApp,
  verifyMachODeploymentTargetAtMost,
} from './lib/macos-signing.mjs';

const version = env('VERSION', '2.0.0');
const channel = normalizeChannel(env('APPHUB_CHANNEL', env('CHANNEL', 'stable')));
const storageRoot = stripTrailingSlash(
  env('APPHUB_STORAGE_ROOT', 'gs://tamber-artifacts/jamie-updater-demo'),
);
const publicRoot = stripTrailingSlash(
  env('APPHUB_PUBLIC_ROOT', 'https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo'),
);
const channelPath = safeChannelPath(channel);
const releaseBaseUrl = `${publicRoot}/channels/${channelPath}/artifacts`;
const catalogObject = `channels/${channelPath}/apphub-catalog.json`;
const catalogUrl = `${publicRoot}/${catalogObject}`;
const productId = envNonEmpty('APPHUB_CATALOG_PRODUCT_ID', 'com.eacp.maze');
const target = envNonEmpty('APPHUB_CATALOG_TARGET', 'Maze');
const outDir = env('OUT_DIR', join(repoRoot, `dist/generated-catalog-${target}-${version}`));
const buildDir = env('BUILD_DIR', join(repoRoot, `build-generated-catalog-${target}-${version}`));
const macOSDeploymentTarget = env('EACP_MACOS_DEPLOYMENT_TARGET', '11.0');

requireMacOS(`Generated catalog app update publishing for ${productId}`);

log(`Download current AppHub catalog for ${channel}`);
cleanDir(outDir);
const catalogPath = join(outDir, 'apphub-catalog.json');
downloadCatalog();

const catalog = JSON.parse(readText(catalogPath));
const productIndex = catalog.products.findIndex((product) => product.id === productId);
const currentProduct = productIndex >= 0
  ? catalog.products[productIndex]
  : productFromKnownCatalog(productId);
if (currentProduct.kind !== 'App') {
  throw new Error(`Product ${productId} is ${currentProduct.kind}, not App`);
}

log('Import Tamber Developer ID signing identity');
ensureTamberSigningIdentity();

log(`Configure ${currentProduct.name} ${version}`);
run('cmake', [
  '-S',
  repoRoot,
  '-B',
  buildDir,
  `-DEACP_SOURCE_DIR=${eacpSourceDir()}`,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_DEPLOYMENT_TARGET=${macOSDeploymentTarget}`,
  `-DEACP_CATALOG_DEFAULT_VERSION=${version}`,
  '-DEACP_APPHUB_DISABLE_DEV_CATALOG=ON',
]);

log(`Build ${currentProduct.name} ${version}`);
run('cmake', ['--build', buildDir, '--target', target]);

const appBundle = findCatalogAppBundle(buildDir, currentProduct);
const binaryName = appExecutableName(appBundle);

log(`Sign ${currentProduct.name} ${version}`);
signPath(appBundle);
verifyCodeSignature(appBundle);
verifyMachODeploymentTargetAtMost(
  join(appBundle, 'Contents', 'MacOS', binaryName),
  macOSDeploymentTarget,
);

log(`Notarize and staple ${currentProduct.name} ${version}`);
notarizeAndStapleApps([appBundle]);

const zipName = `${productId}-${version}.app.zip`;
const zipPath = join(outDir, zipName);

log(`Package ${currentProduct.name} ${version}`);
run('ditto', ['-c', '-k', '--keepParent', appBundle, zipPath]);

log(`Verify packaged ${currentProduct.name} ${version}`);
const packagedVerifyDir = join(buildDir, 'packaged-app-verify');
cleanDir(packagedVerifyDir);
run('ditto', ['-x', '-k', zipPath, packagedVerifyDir]);
const packagedApp = join(packagedVerifyDir, currentProduct.bundleName);
verifyCodeSignature(packagedApp);
validateStapledApp(packagedApp);
verifyGatekeeperApp(packagedApp);

const productEntry = {
  ...currentProduct,
  channel,
  latestVersion: version,
  artifacts: [
    {
      platform: 'MacOS',
      architecture: 'Universal',
      url: `${releaseBaseUrl}/${zipName}`,
      sha256: sha256File(zipPath),
      signature: '',
    },
  ],
};

const nextCatalog = replaceCatalogProduct({
  ...catalog,
  catalogVersion: Math.max(
    Number(catalog.catalogVersion) || 0,
    Number.parseInt(version.split('.')[0], 10) || 1,
  ),
}, productEntry);
writeJson(catalogPath, nextCatalog);
const indexPath = join(outDir, 'index.json');
writeChannelIndex(indexPath);

log(`Upload ${currentProduct.name} ${version} and updated ${channel} catalog`);
run('gcloud', [
  'storage',
  'cp',
  zipPath,
  `${storageRoot}/channels/${channelPath}/artifacts/${zipName}`,
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

log(`Published ${currentProduct.name} ${version} to ${channel}`);
console.log(JSON.stringify(productEntry, null, 2));

function downloadCatalog() {
  const result = capture('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    catalogUrl,
  ], { check: false });
  if (result.status === 0) {
    writeJson(catalogPath, JSON.parse(result.stdout));
    return;
  }

  const gcloudResult = capture('gcloud', [
    'storage',
    'cp',
    `${storageRoot}/${catalogObject}`,
    catalogPath,
  ], { check: false });
  if (gcloudResult.status === 0) return;

  writeJson(catalogPath, {
    catalogVersion: Number.parseInt(version.split('.')[0], 10) || 1,
    products: [],
    signature: '',
  });
}

function writeChannelIndex(indexPath) {
  const fallback = {
    defaultChannel: channel,
    channels: [],
  };
  const existing = capture('gcloud', [
    'storage',
    'cp',
    `${storageRoot}/index.json`,
    indexPath,
  ], { check: false });
  const index = existing.status === 0 ? JSON.parse(readText(indexPath)) : fallback;
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

function envNonEmpty(name, fallback) {
  const value = env(name, fallback);
  return value && value.trim() ? value : fallback;
}

function productFromKnownCatalog(productId) {
  const product = Object.values(catalogProducts)
    .find((entry) => entry.id === productId);
  if (!product) {
    throw new Error(`Product ${productId} does not exist in ${catalogUrl}`);
  }

  return {
    id: product.id,
    name: product.name,
    kind: product.kind,
    bundleName: product.bundleName,
    channel,
    latestVersion: version,
    dependencies: product.dependencies ?? [],
    artifacts: [],
  };
}

function appExecutableName(appBundle) {
  const result = capture('/usr/libexec/PlistBuddy', [
    '-c',
    'Print:CFBundleExecutable',
    join(appBundle, 'Contents', 'Info.plist'),
  ]);
  return result.stdout.trim();
}
