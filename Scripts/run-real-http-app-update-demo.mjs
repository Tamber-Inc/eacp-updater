#!/usr/bin/env node

import { join } from 'node:path';
import { accessSync, constants } from 'node:fs';

import {
  eacpSourceDir,
  capture,
  cleanDir,
  env,
  fileExists,
  log,
  readText,
  remove,
  repoRoot,
  requireMacOS,
  run,
  say,
  sha256File,
  start,
  writeJson,
} from './lib/cli.mjs';
import { adHocSignPath, ensureTamberSigningIdentity, remoteDemoKeychainPath, signPath } from './lib/macos-signing.mjs';

const appName = 'Tamber Local Update Demo.app';
const productId = 'com.tamber.RealUpdateDemo';
const port = env('PORT', '8765');
const workRoot = env('WORK_ROOT', '/private/tmp/eacp-real-http-update-demo');
const serverRoot = join(workRoot, 'server');
const downloadRoot = join(workRoot, 'downloads');
const installPath = join('/Applications', appName);
const rollbackPath = join('/Applications', `${appName}.rollback`);
const delay = Number(env('DEMO_DELAY', '1.0'));

let server = null;

requireMacOS('The real HTTP app update demo');

process.on('exit', () => {
  if (server) {
    server.kill();
  }
});

function sudoIfNeeded(command, args) {
  try {
    accessSync('/Applications', constants.W_OK);
    run(command, args);
  } catch {
    run('sudo', [command, ...args]);
  }
}

function installedVersion() {
  const executable = join(installPath, 'Contents', 'MacOS', 'Tamber Local Update Demo');
  if (!fileExists(executable)) {
    return 'not installed';
  }
  return capture(executable, ['--version']).stdout.trim();
}

function showInstalledState() {
  console.log(`\nInstalled app: ${installPath}`);
  console.log(`Installed version: ${installedVersion()}`);
  const plist = join(installPath, 'Contents', 'Info.plist');
  if (fileExists(plist)) {
    const version = capture('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      plist,
    ]).stdout.trim();
    console.log(`Bundle version: ${version}`);
  }
}

function signAppBundle(app) {
  if (env('USE_TAMBER_SIGNING', '0') === '1') {
    ensureTamberSigningIdentity(remoteDemoKeychainPath);
    signPath(app, remoteDemoKeychainPath);
  } else {
    adHocSignPath(app);
  }
}

function buildVersion(version) {
  const buildDir = join(workRoot, `build-${version}`);
  const publishDir = join(serverRoot, version);
  const appPath = join(buildDir, 'Demos', 'RealUpdateDemo', appName);
  const zipPath = join(publishDir, `TamberLocalUpdateDemo-${version}.app.zip`);

  say(`Build ${appName} ${version} from source.`, delay);
  run('cmake', [
    '-S',
    repoRoot,
    '-B',
    buildDir,
    `-DEACP_SOURCE_DIR=${eacpSourceDir()}`,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DEACP_REAL_UPDATE_DEMO_VERSION=${version}`,
  ]);
  run('cmake', ['--build', buildDir, '--target', 'RealUpdateDemo']);

  signAppBundle(appPath);
  cleanDir(publishDir);

  say(`Package ${version} as the update artifact.`, delay);
  run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);

  const hash = sha256File(zipPath);
  const zipName = `TamberLocalUpdateDemo-${version}.app.zip`;
  const manifest = {
    productId,
    name: 'Tamber Local Update Demo',
    version,
    bundleName: appName,
    artifact: {
      url: `http://127.0.0.1:${port}/${version}/${zipName}`,
      sha256: hash,
    },
  };

  writeJson(join(serverRoot, `manifest-${version}.json`), manifest);
  writeJson(join(serverRoot, 'manifest.json'), manifest);
  console.log(hash);
}

function startServer() {
  say(`Start a local HTTP update server at http://127.0.0.1:${port}/.`, delay);
  server = start('python3', ['-m', 'http.server', port, '--bind', '127.0.0.1'], {
    cwd: serverRoot,
    stdio: 'ignore',
  });
  run(process.execPath, ['-e', 'setTimeout(()=>{}, 1000)']);
}

function downloadCurrentManifestAndArtifact(label) {
  const manifestPath = join(downloadRoot, `${label}-manifest.json`);
  const artifactPath = join(downloadRoot, `${label}.app.zip`);
  cleanDir(downloadRoot);

  say('Download the current manifest over HTTP.', delay);
  run('curl', [
    '--fail',
    '--silent',
    '--show-error',
    `http://127.0.0.1:${port}/manifest.json`,
    '--output',
    manifestPath,
  ]);
  console.log(readText(manifestPath));

  const manifest = JSON.parse(readText(manifestPath));
  say('Download the app artifact from the manifest URL.', delay);
  run('curl', ['--fail', '--silent', '--show-error', manifest.artifact.url, '--output', artifactPath]);

  const actual = sha256File(artifactPath);
  console.log(`Expected SHA-256: ${manifest.artifact.sha256}`);
  console.log(`Actual SHA-256:   ${actual}`);
  if (actual !== manifest.artifact.sha256) {
    throw new Error('Downloaded artifact hash mismatch.');
  }

  return artifactPath;
}

function installDownloadedArtifact(artifactPath) {
  const unpackRoot = join(workRoot, 'unpack');
  const unpackedApp = join(unpackRoot, appName);

  cleanDir(unpackRoot);
  say('Unpack the downloaded artifact.', delay);
  run('ditto', ['-x', '-k', artifactPath, unpackRoot]);

  if (!fileExists(unpackedApp)) {
    throw new Error(`Expected unpacked app missing: ${unpackedApp}`);
  }

  say(`Install to ${installPath}, preserving a rollback copy if one exists.`, delay);
  sudoIfNeeded('/bin/rm', ['-rf', rollbackPath]);
  if (fileExists(installPath)) {
    sudoIfNeeded('/bin/mv', [installPath, rollbackPath]);
  }
  sudoIfNeeded('/usr/bin/ditto', [unpackedApp, installPath]);
}

say('Prepare a clean local update workspace.', delay);
remove(workRoot);
cleanDir(serverRoot);
cleanDir(downloadRoot);

startServer();

buildVersion('1.0.0');
installDownloadedArtifact(downloadCurrentManifestAndArtifact('v1'));
showInstalledState();

say('Now publish a real update: rebuild the app as version 2.0.0 and update the manifest.', delay);
buildVersion('2.0.0');
run('curl', [
  '--fail',
  '--silent',
  '--show-error',
  `http://127.0.0.1:${port}/manifest.json`,
  '--output',
  join(downloadRoot, 'published-v2-manifest.json'),
]);
console.log(readText(join(downloadRoot, 'published-v2-manifest.json')));

installDownloadedArtifact(downloadCurrentManifestAndArtifact('v2'));
showInstalledState();

say('Done. The installed /Applications app was downloaded over local HTTP and updated from 1.0.0 to 2.0.0.', delay);
