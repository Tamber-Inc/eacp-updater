#!/usr/bin/env node

import { join } from 'node:path';

import {
  cleanDir,
  env,
  log,
  readText,
  remove,
  repoRoot,
  requireMacOS,
  run,
  sha256File,
  start,
  writeJson,
} from './lib/cli.mjs';
import { adHocSignPath, verifyCodeSignature } from './lib/macos-signing.mjs';

const port = env('PORT', '8766');
const installedVersion = env('INSTALLED_VERSION', '5.0.5');
const remoteVersion = env('REMOTE_VERSION', '5.0.6');
const workRoot = env('WORK_ROOT', '/private/tmp/eacp-apphub-self-update-demo');
const serverRoot = join(workRoot, 'server');
const buildDir = join(workRoot, `build-local-manifest-${installedVersion}`);
const remoteBuildDir = join(workRoot, `build-remote-${remoteVersion}`);
const manifestUrl = `http://127.0.0.1:${port}/hub-manifest.json`;

const appHubAppName = 'AppHub.app';
const appHubZip = `AppHub-${remoteVersion}.app.zip`;

let server = null;

requireMacOS('The local AppHub self-update demo');

process.on('exit', () => {
  if (server) {
    server.kill();
  }
});

function appBundle(build) {
  return join(build, 'Demos', 'AppHub', appHubAppName);
}

function appBinary(app) {
  return join(app, 'Contents', 'MacOS', 'AppHub');
}

function helperBinary(app) {
  return join(
    app,
    'Contents',
    'Library',
    'LaunchServices',
    'com.tamber.AppHub.PrivilegedHelper',
  );
}

function buildAppHub(version, build, extraDefs = []) {
  log(`Configure AppHub ${version}`);
  run('cmake', [
    '-S',
    repoRoot,
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DEACP_APPHUB_VERSION=${version}`,
    ...extraDefs,
  ]);

  log(`Build AppHub ${version}`);
  run('cmake', ['--build', build, '--target', 'AppHub']);

  const app = appBundle(build);
  adHocSignPath(helperBinary(app));
  adHocSignPath(app);
  verifyCodeSignature(app);
  run(appBinary(app), ['--version']);
  return app;
}

function startServer() {
  log(`Start local update server at http://127.0.0.1:${port}`);
  server = start('python3', ['-m', 'http.server', port, '--bind', '127.0.0.1'], {
    cwd: serverRoot,
    stdio: 'ignore',
  });
  run(process.execPath, ['-e', 'setTimeout(()=>{}, 1000)']);
}

remove(workRoot);
cleanDir(serverRoot);

const remoteApp = buildAppHub(remoteVersion, remoteBuildDir);

log(`Package remote AppHub ${remoteVersion}`);
const remoteZipPath = join(serverRoot, appHubZip);
run('ditto', ['-c', '-k', '--keepParent', remoteApp, remoteZipPath]);
const remoteSha = sha256File(remoteZipPath);

writeJson(join(serverRoot, 'hub-manifest.json'), {
  productId: 'com.tamber.AppHub',
  name: 'AppHub',
  version: remoteVersion,
  bundleName: appHubAppName,
  artifact: {
    url: `http://127.0.0.1:${port}/${appHubZip}`,
    sha256: remoteSha,
  },
});

const localApp = buildAppHub(installedVersion, buildDir, [
  `-DEACP_APPHUB_MANIFEST_URL=${manifestUrl}`,
]);

startServer();

log('Verify local manifest and artifact over HTTP');
run('curl', [
  '--fail',
  '--silent',
  '--show-error',
  manifestUrl,
  '--output',
  join(workRoot, 'downloaded-hub-manifest.json'),
]);
console.log(readText(join(workRoot, 'downloaded-hub-manifest.json')));
run('curl', [
  '--fail',
  '--silent',
  '--show-error',
  `http://127.0.0.1:${port}/${appHubZip}`,
  '--output',
  join(workRoot, 'downloaded-apphub.zip'),
]);
const downloadedSha = sha256File(join(workRoot, 'downloaded-apphub.zip'));
if (downloadedSha !== remoteSha) {
  throw new Error(`Downloaded SHA mismatch: ${downloadedSha} != ${remoteSha}`);
}

log('Launch local AppHub UI against the local manifest');
console.log(`Installed /Applications/AppHub.app should be ${installedVersion}.`);
console.log(`The local manifest serves AppHub ${remoteVersion}.`);
console.log('Click "Check updates"; Latest should stay at the remote version and Update Hub should remain enabled.');
console.log('Press Ctrl+C here when done; the local HTTP server will be stopped.');
run('/usr/bin/open', ['-n', localApp]);

setInterval(() => {}, 1000);
