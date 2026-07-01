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
  configuredRelease,
  configuredVersion,
  loadPublishConfig,
  templateName,
} from './lib/apphub-publish-config.mjs';
import {
  ensureTamberSigningIdentity,
  notarizeAndStapleApps,
  signPath,
  validateStapledApp,
  verifyCodeSignature,
  verifyGatekeeperApp,
  verifyMachODeploymentTargetAtMost,
} from './lib/macos-signing.mjs';

const { options } = parseArgs(process.argv.slice(2));
const config = loadPublishConfig(options.config);
const app = requiredObject(config, 'demoApp');
const version = configuredVersion();
const release = configuredRelease(config);
const outDir = envString('OUT_DIR', join(repoRoot, 'dist', 'remote-demo-app-update'));
const buildDir = envString('BUILD_DIR', join(repoRoot, `build-remote-demo-app-update-${version}`));
const macOSDeploymentTarget = envString(
  'EACP_MACOS_DEPLOYMENT_TARGET',
  requiredString(config, 'macOSDeploymentTarget', 'macOSDeploymentTarget'),
);

const demoAppName = requiredString(app, 'bundleName', 'demoApp.bundleName');
const demoBinaryName = requiredString(app, 'binaryName', 'demoApp.binaryName');
const demoZip = templateName(requiredString(app, 'zipNameTemplate', 'demoApp.zipNameTemplate'), {
  name: requiredString(app, 'name', 'demoApp.name'),
  productId: requiredString(app, 'productId', 'demoApp.productId'),
  version,
});
const manifestName = requiredString(app, 'manifestName', 'demoApp.manifestName');

requireMacOS('Remote demo app update publishing');

log('Import Tamber Developer ID signing identity');
ensureTamberSigningIdentity();

log(`Configure Demo App ${version}`);
run('cmake', [
  '-S',
  repoRoot,
  '-B',
  buildDir,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_DEPLOYMENT_TARGET=${macOSDeploymentTarget}`,
  `-D${requiredString(app, 'versionDefine', 'demoApp.versionDefine')}=${version}`,
]);

log(`Build Demo App ${version}`);
run('cmake', ['--build', buildDir, '--target', requiredString(app, 'cmakeTarget', 'demoApp.cmakeTarget')]);

const demoApp = join(buildDir, ...pathParts(app.buildRelativePath, 'demoApp.buildRelativePath'));

log(`Sign Demo App ${version}`);
signPath(demoApp);
verifyMachODeploymentTargetAtMost(
  join(demoApp, 'Contents', 'MacOS', demoBinaryName),
  macOSDeploymentTarget,
);

log(`Notarize and staple Demo App ${version}`);
notarizeAndStapleApps([demoApp]);

log('Verify Demo App version');
run(join(demoApp, 'Contents', 'MacOS', demoBinaryName), ['--version']);

log(`Package Demo App ${version}`);
cleanDir(outDir);
run('ditto', ['-c', '-k', '--keepParent', demoApp, join(outDir, demoZip)]);

log(`Verify packaged Demo App ${version}`);
const packagedVerifyDir = join(buildDir, 'packaged-demo-verify');
cleanDir(packagedVerifyDir);
run('ditto', ['-x', '-k', join(outDir, demoZip), packagedVerifyDir]);
const packagedDemoApp = join(packagedVerifyDir, demoAppName);
verifyCodeSignature(packagedDemoApp);
validateStapledApp(packagedDemoApp);
verifyGatekeeperApp(packagedDemoApp);

const demoSha = sha256File(join(outDir, demoZip));
const manifest = {
  productId: requiredString(app, 'productId', 'demoApp.productId'),
  name: requiredString(app, 'name', 'demoApp.name'),
  version,
  bundleName: demoAppName,
  artifact: {
    url: `${release.baseUrl}/${demoZip}`,
    sha256: demoSha,
  },
};
writeJson(join(outDir, manifestName), manifest);

log('Update release manifest and app artifact');
run('gh', [
  'release',
  'upload',
  release.tag,
  join(outDir, demoZip),
  join(outDir, manifestName),
  '--repo',
  release.repo,
  '--clobber',
]);

log(`Published Demo App ${version}`);
console.log(JSON.stringify(manifest, null, 2));

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--config') {
      options.config = args[++i];
    }
  }
  return { options };
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
