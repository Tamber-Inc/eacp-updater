#!/usr/bin/env node

import { join } from 'node:path';

import {
  cleanDir,
  env,
  log,
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
  verifyAppHubDeploymentTarget,
  verifyAppHubPrivilegedHelper,
  verifyCodeSignature,
  verifyGatekeeperApp,
} from './lib/macos-signing.mjs';

const version = env('VERSION', '2.0.0');
const releaseTag = env('RELEASE_TAG', 'remote-demo-v1');
const releaseBaseUrl = env(
  'RELEASE_BASE_URL',
  `https://github.com/Tamber-Inc/eacp-updater/releases/download/${releaseTag}`,
);
const outDir = env('OUT_DIR', join(repoRoot, 'dist', 'remote-hub-update'));
const buildDir = env('BUILD_DIR', join(repoRoot, `build-remote-hub-update-${version}`));
const macOSDeploymentTarget = env('EACP_MACOS_DEPLOYMENT_TARGET', '11.0');
const channel = normalizeChannel(env('APPHUB_CHANNEL', env('CHANNEL', 'stable')));
const storageRoot = stripTrailingSlash(env('APPHUB_STORAGE_ROOT', 'gs://tamber-artifacts/jamie-updater-demo'));
const publicRoot = stripTrailingSlash(env('APPHUB_PUBLIC_ROOT', 'https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo'));

const appHubAppName = 'AppHub.app';
const appHubBinaryName = 'AppHub';
const appHubZip = `AppHub-${version}.app.zip`;
const appHubPkg = `AppHub-${version}.pkg`;
const productId = 'com.tamber.AppHub';
const channelPath = safeChannelPath(channel);
const installerManifestName = 'hub-installer.json';
const appHubPkgObject = `channels/${channelPath}/artifacts/${appHubPkg}`;
const installerManifestObject = `channels/${channelPath}/${installerManifestName}`;

requireMacOS('Remote AppHub update publishing');

log('Import Tamber Developer ID signing identity');
ensureTamberSigningIdentity();

log(`Configure AppHub ${version}`);
run('cmake', [
  '-S',
  repoRoot,
  '-B',
  buildDir,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_DEPLOYMENT_TARGET=${macOSDeploymentTarget}`,
  `-DEACP_APPHUB_VERSION=${version}`,
  '-DEACP_APPHUB_DISABLE_DEV_CATALOG=ON',
  `-DEACP_APPHUB_DEMO_MANIFEST_URL=${releaseBaseUrl}/manifest.json`,
  `-DEACP_APPHUB_MANIFEST_URL=${releaseBaseUrl}/hub-manifest.json`,
]);

log(`Build AppHub ${version}`);
run('cmake', ['--build', buildDir, '--target', 'AppHub']);

const appHubApp = join(buildDir, 'Demos', 'AppHub', appHubAppName);
const appHubHelper = join(
  appHubApp,
  'Contents',
  'Library',
  'LaunchServices',
  'com.tamber.AppHub.PrivilegedHelper',
);

log(`Sign AppHub ${version}`);
signPath(appHubHelper);
signPath(appHubApp);
verifyAppHubDeploymentTarget(appHubApp, macOSDeploymentTarget);
verifyAppHubPrivilegedHelper(appHubApp);

log(`Notarize and staple AppHub ${version}`);
notarizeAndStapleApps([appHubApp]);

log(`Build signed AppHub installer package ${version}`);
cleanDir(outDir);
const appHubPkgPath = join(outDir, appHubPkg);
buildSignedComponentPkg({
  component: appHubApp,
  output: appHubPkgPath,
});

log(`Notarize and staple AppHub installer package ${version}`);
notarizeAndStaplePkgs([appHubPkgPath]);

log('Verify AppHub version');
run(join(appHubApp, 'Contents', 'MacOS', appHubBinaryName), ['--version']);

log(`Package AppHub ${version}`);
run('ditto', ['-c', '-k', '--keepParent', appHubApp, join(outDir, appHubZip)]);

log(`Verify packaged AppHub ${version}`);
const packagedVerifyDir = join(buildDir, 'packaged-apphub-verify');
cleanDir(packagedVerifyDir);
run('ditto', ['-x', '-k', join(outDir, appHubZip), packagedVerifyDir]);
const packagedAppHub = join(packagedVerifyDir, appHubAppName);
verifyCodeSignature(packagedAppHub);
verifyAppHubDeploymentTarget(packagedAppHub, macOSDeploymentTarget);
verifyAppHubPrivilegedHelper(packagedAppHub);
validateStapledApp(packagedAppHub);
verifyGatekeeperApp(packagedAppHub);

const appHubSha = sha256File(join(outDir, appHubZip));
const appHubPkgSha = sha256File(appHubPkgPath);
const manifest = {
  productId,
  name: appHubBinaryName,
  version,
  bundleName: appHubAppName,
  artifact: {
    url: `${releaseBaseUrl}/${appHubZip}`,
    sha256: appHubSha,
  },
};
writeJson(join(outDir, 'hub-manifest.json'), manifest);

const installerManifest = {
  productId,
  name: appHubBinaryName,
  version,
  bundleName: appHubAppName,
  package: {
    url: `${publicRoot}/${appHubPkgObject}`,
    sha256: appHubPkgSha,
  },
};
writeJson(join(outDir, installerManifestName), installerManifest);

log('Update release Hub manifest and app artifact');
run('gh', [
  'release',
  'upload',
  releaseTag,
  join(outDir, appHubZip),
  appHubPkgPath,
  join(outDir, 'hub-manifest.json'),
  join(outDir, installerManifestName),
  '--repo',
  'Tamber-Inc/eacp-updater',
  '--clobber',
]);

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

log(`Published AppHub ${version}`);
console.log(JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(installerManifest, null, 2));

function normalizeChannel(value) {
  return value.trim() || 'stable';
}

function safeChannelPath(value) {
  return normalizeChannel(value).replace(/[^A-Za-z0-9._-]/g, '-');
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
