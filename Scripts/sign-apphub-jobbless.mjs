#!/usr/bin/env node

import { join } from 'node:path';

import { env, log, repoRoot, requireMacOS, run } from './lib/cli.mjs';
import { ensureTamberSigningIdentity, jobBlessKeychainPath, signPath } from './lib/macos-signing.mjs';

const buildDir = env('BUILD_DIR', join(repoRoot, 'build'));
const helperLabel = env('EACP_APPHUB_HELPER_LABEL', 'com.tamber.AppHub.PrivilegedHelper');
const appRequirement = env(
  'EACP_APPHUB_APP_SIGNING_REQUIREMENT',
  'identifier "com.tamber.AppHub" and anchor apple generic',
);
const helperRequirement = env(
  'EACP_APPHUB_HELPER_SIGNING_REQUIREMENT',
  `identifier "${helperLabel}" and anchor apple generic`,
);
const appBundle = join(buildDir, 'Demos', 'AppHub', 'AppHub.app');
const helperInBundle = join(
  appBundle,
  'Contents',
  'Library',
  'LaunchServices',
  helperLabel,
);

requireMacOS('AppHub JobBless signing');

log('Import Tamber Developer ID signing identity');
ensureTamberSigningIdentity(jobBlessKeychainPath);

log('Build AppHub and the embedded privileged helper');
run('cmake', ['--build', buildDir, '--target', 'AppHub']);

log('Verify helper contains embedded JobBless plists');
const otool = run('otool', ['-l', helperInBundle], { stdio: 'pipe' });
const loadCommands = otool.stdout ?? '';
if (!loadCommands.includes('__info_plist')) {
  throw new Error('Helper is missing embedded __TEXT,__info_plist section.');
}
if (!loadCommands.includes('__launchd_plist')) {
  throw new Error('Helper is missing embedded __TEXT,__launchd_plist section.');
}

log('Sign embedded privileged helper');
signPath(helperInBundle, jobBlessKeychainPath);

log('Sign AppHub bundle');
signPath(appBundle, jobBlessKeychainPath);

log('Verify signatures and designated requirements');
run('codesign', ['--verify', '--strict', '--verbose=4', helperInBundle]);
run('codesign', ['--verify', '--strict', '--verbose=4', appBundle]);
run('codesign', ['--verify', '--strict', '--verbose=4', '--requirements', `=${helperRequirement}`, helperInBundle]);
run('codesign', ['--verify', '--strict', '--verbose=4', '--requirements', `=${appRequirement}`, appBundle]);

log('Show signed requirements');
run('codesign', ['-d', '--requirements', '-', helperInBundle]);
run('codesign', ['-d', '--requirements', '-', appBundle]);

log('Signed AppHub JobBless artifacts');
console.log(`App:    ${appBundle}`);
console.log(`Helper: ${helperInBundle}`);
console.log(`Identity: ${process.env.APPLE_SIGNING_IDENTITY}`);
