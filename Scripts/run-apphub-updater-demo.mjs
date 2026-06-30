#!/usr/bin/env node

import { join } from 'node:path';

import { env, fileExists, readText, repoRoot, run, say } from './lib/cli.mjs';

const demoRoot = process.argv[2] ?? '/private/tmp/eacp-apphub-story-demo';
const delay = Number(env('DEMO_DELAY', '1.5'));

function resolveAppHub() {
  const macBundle = join(repoRoot, 'build', 'Demos', 'AppHub', 'AppHub.app', 'Contents', 'MacOS', 'AppHub');
  const plain = join(repoRoot, 'build', 'Demos', 'AppHub', process.platform === 'win32' ? 'AppHub.exe' : 'AppHub');

  if (fileExists(macBundle)) {
    return macBundle;
  }
  if (fileExists(plain)) {
    return plain;
  }
  throw new Error('Could not find built AppHub executable.');
}

function payload(productId) {
  const path = join(demoRoot, 'Applications', productId, 'artifact.bin');
  if (fileExists(path)) {
    console.log(`${productId} payload: ${readText(path).trim()}`);
  } else {
    console.log(`${productId} payload: not installed`);
  }
}

function receipt(productId) {
  const path = join(demoRoot, 'receipts', `${productId}.json`);
  console.log(`\n${productId} receipt:`);
  if (fileExists(path)) {
    console.log(readText(path));
  } else {
    console.log('not installed');
  }
}

function showProof() {
  console.log('\nInstalled payload proof:');
  payload('shared.onnxruntime');
  payload('shared.clap');
  payload('tamber.editor');
  payload('tamber.capture');
  receipt('shared.clap');
  receipt('tamber.editor');
}

say('Build the AppHub demo binary.', delay);
run('cmake', ['--build', 'build', '--target', 'AppHub']);
const apphub = resolveAppHub();

say('The macOS production hook is now present too: AppHub embeds a JobBless helper in its app bundle.', delay);
say('This script does not run bless-helper by default because real blessing requires signing and an admin authorization prompt.', delay);
if (env('RUN_BLESS', '0') === '1') {
  run(apphub, ['bless-helper']);
}

say('User opens Tamber App Hub for the first time. There is a catalog, but nothing is installed yet.', delay);
run(apphub, ['--root', demoRoot, 'reset']);
run(apphub, ['--root', demoRoot, 'list']);

say('User chooses to install Example Editor.', delay);
say('The hub plans the app plus its shared resources: ONNX Runtime and the CLAP model.', delay);
run(apphub, ['--root', demoRoot, 'install', 'tamber.editor']);
run(apphub, ['--root', demoRoot, 'list']);
showProof();

say('User also installs Example Capture from the same hub.', delay);
say('The shared resources are already present, so both apps can share them instead of duplicating blobs.', delay);
run(apphub, ['--root', demoRoot, 'install', 'tamber.capture']);
run(apphub, ['--root', demoRoot, 'list']);
showProof();

say('User launches the installed apps.', delay);
run(apphub, ['--root', demoRoot, 'open', 'tamber.editor']);
run(apphub, ['--root', demoRoot, 'open', 'tamber.capture']);
run(apphub, ['--root', demoRoot, 'list']);

say('A new update is published while the user is working.', delay);
say('The feed now has Example Editor v2 and CLAP Model v2.', delay);
run(apphub, ['--root', demoRoot, 'publish-update']);
run(apphub, ['--root', demoRoot, 'list']);

say('The hub checks for updates while the apps are still running.', delay);
say('Correct behavior: it sees the update, but waits instead of replacing files under a running app.', delay);
run(apphub, ['--root', demoRoot, 'update']);
showProof();

say('The user closes the apps.', delay);
run(apphub, ['--root', demoRoot, 'close', 'tamber.capture']);
run(apphub, ['--root', demoRoot, 'close', 'tamber.editor']);
run(apphub, ['--root', demoRoot, 'list']);

say('The hub applies the pending update through the mocked privileged helper.', delay);
run(apphub, ['--root', demoRoot, 'update']);

say('Now the user-visible state is correct: Editor and the shared CLAP model are updated, Capture remains installed at v1.', delay);
run(apphub, ['--root', demoRoot, 'list']);
showProof();

say(`The story is complete. All mocked protected writes stayed under ${demoRoot}.`, delay);
