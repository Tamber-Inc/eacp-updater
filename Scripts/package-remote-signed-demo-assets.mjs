#!/usr/bin/env node

import { join } from 'node:path';

import {
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
  buildSignedComponentPkg,
  ensureTamberSigningIdentity,
  notarizeAndStapleApps,
  notarizeAndStaplePkgs,
  signPath,
  validateStapledApp,
  verifyGatekeeperApp,
  verifyAppHubDeploymentTarget,
  verifyAppHubPrivilegedHelper,
  verifyCodeSignature,
  verifyMachODeploymentTargetAtMost,
} from './lib/macos-signing.mjs';
import {
  findCatalogAppBundle,
  generateCatalogFromProducts,
  readGeneratedCatalog,
} from './lib/apphub-generated-catalog.mjs';

const version = env('VERSION', '1.0.0');
const releaseTag = env('RELEASE_TAG', `remote-demo-v${version}`);
const releaseBaseUrl = env(
  'RELEASE_BASE_URL',
  `https://github.com/Tamber-Inc/eacp-updater/releases/download/${releaseTag}`,
);
const outDir = env('OUT_DIR', join(repoRoot, 'dist', 'remote-signed-demo'));
const buildDir = env('BUILD_DIR', join(repoRoot, 'build-remote-signed-demo'));
const macOSDeploymentTarget = env('EACP_MACOS_DEPLOYMENT_TARGET', '11.0');
const channel = normalizeChannel(env('APPHUB_CHANNEL', env('CHANNEL', 'stable')));
const storageRoot = stripTrailingSlash(env('APPHUB_STORAGE_ROOT', 'gs://tamber-artifacts/jamie-updater-demo'));
const publicRoot = stripTrailingSlash(env('APPHUB_PUBLIC_ROOT', 'https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo'));

const appHubZip = 'AppHub-remote-demo.app.zip';
const appHubPkg = `AppHub-${version}.pkg`;
const demoZip = `TamberLocalUpdateDemo-${version}.app.zip`;
const demoAppName = 'Tamber Local Update Demo.app';
const demoBinaryName = 'Tamber Local Update Demo';
const productId = 'com.tamber.RealUpdateDemo';
const channelPath = safeChannelPath(channel);
const installerManifestName = 'hub-installer.json';
const appHubPkgObject = `channels/${channelPath}/artifacts/${appHubPkg}`;
const installerManifestObject = `channels/${channelPath}/${installerManifestName}`;
requireMacOS('Remote signed demo packaging');

log('Import Tamber Developer ID signing identity');
ensureTamberSigningIdentity();

log('Configure release build');
run('cmake', [
  '-S',
  repoRoot,
  '-B',
  buildDir,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_DEPLOYMENT_TARGET=${macOSDeploymentTarget}`,
  `-DEACP_APPHUB_VERSION=${version}`,
  `-DEACP_REAL_UPDATE_DEMO_VERSION=${version}`,
  `-DEACP_CATALOG_DEFAULT_VERSION=${version}`,
  '-DEACP_APPHUB_DISABLE_DEV_CATALOG=ON',
  `-DEACP_APPHUB_DEMO_MANIFEST_URL=${releaseBaseUrl}/manifest.json`,
  `-DEACP_APPHUB_MANIFEST_URL=${releaseBaseUrl}/hub-manifest.json`,
]);

log('Build signed-demo targets');
run('cmake', [
  '--build',
  buildDir,
  '--target',
  'AppHub',
  'RealUpdateDemo',
  'eacp-apphub-local-catalog',
]);

const appHubApp = join(buildDir, 'Demos', 'AppHub', 'AppHub.app');
const appHubHelper = join(
  appHubApp,
  'Contents',
  'Library',
  'LaunchServices',
  'com.tamber.AppHub.PrivilegedHelper',
);
const demoApp = join(buildDir, 'Demos', 'RealUpdateDemo', demoAppName);
const generatedCatalog = readGeneratedCatalog(buildDir);

log('Sign AppHub helper and app');
signPath(appHubHelper);
signPath(appHubApp);
verifyAppHubDeploymentTarget(appHubApp, macOSDeploymentTarget);
verifyAppHubPrivilegedHelper(appHubApp);

log('Sign Demo App');
signPath(demoApp);
verifyMachODeploymentTargetAtMost(
  join(demoApp, 'Contents', 'MacOS', demoBinaryName),
  macOSDeploymentTarget,
);

log(`Sign ${generatedCatalog.products.length} AppHub catalog apps`);
const catalogAppBundles = [];
for (const product of generatedCatalog.products) {
  const appBundle = findCatalogAppBundle(buildDir, product);
  catalogAppBundles.push(appBundle);
  signPath(appBundle);
  verifyCodeSignature(appBundle);
}

log('Notarize and staple release apps');
notarizeAndStapleApps([appHubApp, demoApp, ...catalogAppBundles]);

cleanDir(outDir);

log('Build signed AppHub installer package');
const appHubPkgPath = join(outDir, appHubPkg);
buildSignedComponentPkg({
  component: appHubApp,
  output: appHubPkgPath,
});

log('Notarize and staple AppHub installer package');
notarizeAndStaplePkgs([appHubPkgPath]);

log('Verify Demo App version');
run(join(demoApp, 'Contents', 'MacOS', demoBinaryName), ['--version']);

log('Package release assets');
run('ditto', ['-c', '-k', '--keepParent', appHubApp, join(outDir, appHubZip)]);
run('ditto', ['-c', '-k', '--keepParent', demoApp, join(outDir, demoZip)]);

log('Verify packaged AppHub artifact');
const packagedVerifyDir = join(buildDir, 'packaged-apphub-verify');
cleanDir(packagedVerifyDir);
run('ditto', ['-x', '-k', join(outDir, appHubZip), packagedVerifyDir]);
const packagedAppHub = join(packagedVerifyDir, 'AppHub.app');
verifyCodeSignature(packagedAppHub);
verifyAppHubDeploymentTarget(packagedAppHub, macOSDeploymentTarget);
verifyAppHubPrivilegedHelper(packagedAppHub);
validateStapledApp(packagedAppHub);
verifyGatekeeperApp(packagedAppHub);

log('Verify packaged catalog app artifacts');
const packagedAppsVerifyDir = join(buildDir, 'packaged-catalog-apps-verify');
cleanDir(packagedAppsVerifyDir);
generateCatalogFromProducts({
  buildDir,
  products: generatedCatalog.products,
  outDir,
  catalogPath: join(outDir, 'apphub-catalog.json'),
  catalogVersion: Number.parseInt(version.split('.')[0], 10) || 1,
  channel: 'stable',
  releaseBaseUrl,
});
for (const product of generatedCatalog.products) {
  const artifactName = `${product.id}-${product.latestVersion}.app.zip`;
  run('ditto', ['-x', '-k', join(outDir, artifactName), packagedAppsVerifyDir]);
  const packagedApp = join(packagedAppsVerifyDir, product.bundleName);
  verifyCodeSignature(packagedApp);
  validateStapledApp(packagedApp);
  verifyGatekeeperApp(packagedApp);
}

const demoSha = sha256File(join(outDir, demoZip));
const appHubSha = sha256File(join(outDir, appHubZip));
const appHubPkgSha = sha256File(appHubPkgPath);
const manifest = {
  productId,
  name: 'Tamber Local Update Demo',
  version,
  bundleName: demoAppName,
  artifact: {
    url: `${releaseBaseUrl}/${demoZip}`,
    sha256: demoSha,
  },
};
writeJson(join(outDir, 'manifest.json'), manifest);

const hubManifest = {
  productId: 'com.tamber.AppHub',
  name: 'AppHub',
  version,
  bundleName: 'AppHub.app',
  artifact: {
    url: `${releaseBaseUrl}/${appHubZip}`,
    sha256: appHubSha,
  },
};
writeJson(join(outDir, 'hub-manifest.json'), hubManifest);

const installerManifest = {
  productId: 'com.tamber.AppHub',
  name: 'AppHub',
  version,
  bundleName: 'AppHub.app',
  package: {
    url: `${publicRoot}/${appHubPkgObject}`,
    sha256: appHubPkgSha,
  },
};
writeJson(join(outDir, installerManifestName), installerManifest);

log(`Upload AppHub installer package ${version} to ${channel} bucket`);
run('gcloud', [
  'storage',
  'cp',
  appHubPkgPath,
  `${storageRoot}/${appHubPkgObject}`,
  '--cache-control=no-cache,max-age=0',
]);
run('gcloud', [
  'storage',
  'cp',
  join(outDir, installerManifestName),
  `${storageRoot}/${installerManifestObject}`,
  '--content-type=application/json',
  '--cache-control=no-cache,max-age=0',
]);

const catalog = JSON.parse(readText(join(outDir, 'apphub-catalog.json')));

log('Release assets');
run('ls', ['-lh', outDir]);
console.log(JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(hubManifest, null, 2));
console.log(JSON.stringify(installerManifest, null, 2));
console.log(JSON.stringify(catalog, null, 2));

function normalizeChannel(value) {
  return value.trim() || 'stable';
}

function safeChannelPath(value) {
  return normalizeChannel(value).replace(/[^A-Za-z0-9._-]/g, '-');
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
