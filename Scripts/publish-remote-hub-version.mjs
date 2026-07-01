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
  channelArtifactObject,
  configuredChannel,
  configuredRelease,
  configuredVersion,
  loadPublishConfig,
  objectPublicUrl,
  objectStorageUrl,
  requireHubConfig,
  templateName,
} from './lib/apphub-publish-config.mjs';
import {
  buildSignedComponentPkg,
  ensureTamberSigningIdentity,
  notarizeAndStapleApps,
  notarizeAndStaplePkgs,
  signPath,
  validateStapledApp,
  verifyCodeSignature,
  verifyGatekeeperApp,
  verifyMachODeploymentTargetAtMost,
} from './lib/macos-signing.mjs';

const { options } = parseArgs(process.argv.slice(2));
const config = loadPublishConfig(options.config);
const hub = requireHubConfig(config);
const version = configuredVersion();
const channel = configuredChannel(config);
const release = configuredRelease(config);
const outDir = envString('OUT_DIR', join(repoRoot, 'dist', 'remote-hub-update'));
const buildDir = envString('BUILD_DIR', join(repoRoot, `build-remote-hub-update-${version}`));
const macOSDeploymentTarget = envString(
  'EACP_MACOS_DEPLOYMENT_TARGET',
  requiredString(config, 'macOSDeploymentTarget', 'macOSDeploymentTarget'),
);

const appHubAppName = hub.bundleName;
const appHubBinaryName = requiredString(hub, 'binaryName', 'hub.binaryName');
const appHubZip = templateName(requiredString(hub, 'zipNameTemplate', 'hub.zipNameTemplate'), {
  name: hub.name,
  productId: hub.productId,
  version,
});
const appHubPkg = templateName(hub.packageNameTemplate, {
  name: hub.name,
  productId: hub.productId,
  version,
});
const appHubPkgObject = channelArtifactObject(channel, appHubPkg);

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
  cmakeDefine(requiredString(hub, 'versionDefine', 'hub.versionDefine'), version),
  ...optionalCmakeDefines(hub, release.baseUrl),
]);

log(`Build AppHub ${version}`);
run('cmake', ['--build', buildDir, '--target', requiredString(hub, 'cmakeTarget', 'hub.cmakeTarget')]);

const appHubApp = join(buildDir, ...pathParts(hub.buildRelativePath, 'hub.buildRelativePath'));
const appHubHelper = hub.helperRelativePath
  ? join(appHubApp, ...pathParts(hub.helperRelativePath, 'hub.helperRelativePath'))
  : '';

log(`Sign AppHub ${version}`);
if (appHubHelper) signPath(appHubHelper);
signPath(appHubApp);
verifyMachODeploymentTargetAtMost(
  join(appHubApp, 'Contents', 'MacOS', appHubBinaryName),
  macOSDeploymentTarget,
);
if (appHubHelper) {
  verifyMachODeploymentTargetAtMost(appHubHelper, macOSDeploymentTarget);
}

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
verifyMachODeploymentTargetAtMost(
  join(packagedAppHub, 'Contents', 'MacOS', appHubBinaryName),
  macOSDeploymentTarget,
);
if (hub.helperRelativePath) {
  const packagedHelper = join(
    packagedAppHub,
    ...pathParts(hub.helperRelativePath, 'hub.helperRelativePath'),
  );
  verifyCodeSignature(packagedHelper);
  verifyMachODeploymentTargetAtMost(packagedHelper, macOSDeploymentTarget);
}
validateStapledApp(packagedAppHub);
verifyGatekeeperApp(packagedAppHub);

const appHubSha = sha256File(join(outDir, appHubZip));
const appHubPkgSha = sha256File(appHubPkgPath);
const manifest = {
  productId: hub.productId,
  name: appHubBinaryName,
  version,
  bundleName: appHubAppName,
  artifact: {
    url: `${release.baseUrl}/${appHubZip}`,
    sha256: appHubSha,
  },
};
const hubManifestName = requiredString(hub, 'manifestName', 'hub.manifestName');
const installerManifestName = hub.installerManifestName || 'hub-installer.json';
writeJson(join(outDir, hubManifestName), manifest);

const installerManifest = {
  productId: hub.productId,
  name: appHubBinaryName,
  version,
  bundleName: appHubAppName,
  package: {
    url: objectPublicUrl(config, appHubPkgObject),
    sha256: appHubPkgSha,
  },
};
writeJson(join(outDir, installerManifestName), installerManifest);

log('Update release Hub manifest and app artifact');
run('gh', [
  'release',
  'upload',
  release.tag,
  join(outDir, appHubZip),
  appHubPkgPath,
  join(outDir, hubManifestName),
  join(outDir, installerManifestName),
  '--repo',
  release.repo,
  '--clobber',
]);

log(`Upload AppHub installer package ${version} to ${channel} bucket`);
run('gcloud', [
  'storage',
  'cp',
  appHubPkgPath,
  objectStorageUrl(config, appHubPkgObject),
  '--cache-control=no-cache,max-age=0',
]);

log(`Update ${channel} AppHub channel metadata`);
const updateChannelArgs = [
  'Scripts/update-apphub-channel.mjs',
  channel,
  version,
];
if (options.config) updateChannelArgs.push('--config', options.config);
run(process.execPath, updateChannelArgs);

log(`Published AppHub ${version}`);
console.log(JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(installerManifest, null, 2));

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--config') {
      options.config = args[++i];
    }
  }
  return { options };
}

function cmakeDefine(name, value) {
  return `-D${name}=${value}`;
}

function optionalCmakeDefines(hubConfig, baseUrl) {
  const out = [];
  if (hubConfig.disableDevCatalogDefine)
    out.push(cmakeDefine(hubConfig.disableDevCatalogDefine, 'ON'));
  if (hubConfig.demoManifestUrlDefine)
    out.push(cmakeDefine(
      hubConfig.demoManifestUrlDefine,
      `${baseUrl}/${requiredString(requiredObject(config, 'demoApp'), 'manifestName', 'demoApp.manifestName')}`,
    ));
  if (hubConfig.manifestUrlDefine)
    out.push(cmakeDefine(hubConfig.manifestUrlDefine, `${baseUrl}/${requiredString(hubConfig, 'manifestName', 'hub.manifestName')}`));
  return out;
}

function pathParts(value, label) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split('/');
  throw new Error(`Publish config requires path: ${label}`);
}

function requiredObject(parent, key, label = key) {
  const value = parent?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Publish config requires object: ${label}`);
  }
  return value;
}

function requiredString(parent, key, label = key) {
  const value = parent?.[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Publish config requires string: ${label}`);
  }
  return value.trim();
}

function envString(name, fallback) {
  const value = env(name);
  return value && value.trim() ? value : fallback;
}
