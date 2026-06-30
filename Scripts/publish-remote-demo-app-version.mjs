#!/usr/bin/env node

import { join } from 'node:path';

import {
  eacpSourceDir,
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
  ensureTamberSigningIdentity,
  notarizeAndStapleApps,
  signPath,
  validateStapledApp,
  verifyCodeSignature,
  verifyGatekeeperApp,
  verifyMachODeploymentTargetAtMost,
} from './lib/macos-signing.mjs';

const version = env('VERSION', '2.0.0');
const releaseTag = env('RELEASE_TAG', 'remote-demo-v1');
const releaseBaseUrl = env(
  'RELEASE_BASE_URL',
  `https://github.com/Tamber-Inc/eacp-updater/releases/download/${releaseTag}`,
);
const outDir = env('OUT_DIR', join(repoRoot, 'dist', 'remote-demo-app-update'));
const buildDir = env('BUILD_DIR', join(repoRoot, `build-remote-demo-app-update-${version}`));
const macOSDeploymentTarget = env('EACP_MACOS_DEPLOYMENT_TARGET', '11.0');

const demoAppName = 'Tamber Local Update Demo.app';
const demoBinaryName = 'Tamber Local Update Demo';
const demoZip = `TamberLocalUpdateDemo-${version}.app.zip`;
const productId = 'com.tamber.RealUpdateDemo';

requireMacOS('Remote demo app update publishing');

log('Import Tamber Developer ID signing identity');
ensureTamberSigningIdentity();

log(`Configure Demo App ${version}`);
run('cmake', [
  '-S',
  repoRoot,
  '-B',
  buildDir,
  `-DEACP_SOURCE_DIR=${eacpSourceDir()}`,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_DEPLOYMENT_TARGET=${macOSDeploymentTarget}`,
  `-DEACP_REAL_UPDATE_DEMO_VERSION=${version}`,
]);

log(`Build Demo App ${version}`);
run('cmake', ['--build', buildDir, '--target', 'RealUpdateDemo']);

const demoApp = join(buildDir, 'Demos', 'RealUpdateDemo', demoAppName);

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

log('Update release manifest and app artifact');
run('gh', [
  'release',
  'upload',
  releaseTag,
  join(outDir, demoZip),
  join(outDir, 'manifest.json'),
  '--repo',
  'Tamber-Inc/eacp-updater',
  '--clobber',
]);

log(`Published Demo App ${version}`);
console.log(JSON.stringify(manifest, null, 2));
