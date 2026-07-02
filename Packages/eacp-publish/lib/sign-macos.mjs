// macOS Developer ID signing + notarization. Credentials come from the
// environment (the `op run --env-file` pattern), never from config:
//   APPLE_SIGNING_IDENTITY, APPLE_DEVELOPER_CERTIFICATE_BASE64,
//   APPLE_DEVELOPER_CERTIFICATE_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PWD,
//   APPLE_NOTARY_TEAM_ID

import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { capture, run } from './exec.mjs';
import { fail, info } from './ui.mjs';

const keychainPath = join(homedir(), 'Library', 'Keychains', 'eacp-publish.keychain-db');
const keychainPassword = 'eacp-publish-local';

export function ensureSigningIdentity() {
  requireEnv(['APPLE_SIGNING_IDENTITY'],
    'signing needs APPLE_SIGNING_IDENTITY — run under `op run --env-file=<signing env>`');

  if (!existsSync(keychainPath)) {
    run('security', ['create-keychain', '-p', keychainPassword, keychainPath], { quiet: true });
  }
  run('security', ['unlock-keychain', '-p', keychainPassword, keychainPath], { quiet: true });
  run('security', ['set-keychain-settings', '-lut', '21600', keychainPath], { quiet: true });
  ensureKeychainSearchList();

  if (!hasSigningIdentity()) {
    requireEnv(
      ['APPLE_DEVELOPER_CERTIFICATE_BASE64', 'APPLE_DEVELOPER_CERTIFICATE_PASSWORD'],
      'certificate import',
    );
    const tempDir = mkdtempSync(join(tmpdir(), 'eacp-publish-cert-'));
    try {
      const p12 = join(tempDir, 'cert.p12');
      writeFileSync(p12,
        Buffer.from(process.env.APPLE_DEVELOPER_CERTIFICATE_BASE64, 'base64'),
        { mode: 0o600 });
      run('security', ['import', p12, '-k', keychainPath,
        '-P', process.env.APPLE_DEVELOPER_CERTIFICATE_PASSWORD,
        '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], { quiet: true });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
    '-s', '-k', keychainPassword, keychainPath], { quiet: true });

  if (!hasSigningIdentity()) {
    fail(`signing identity not found after import: ${process.env.APPLE_SIGNING_IDENTITY}`);
  }
}

export function signBundle(bundlePath) {
  run('codesign', ['--force', '--timestamp', '--options', 'runtime',
    '--keychain', keychainPath,
    '--sign', process.env.APPLE_SIGNING_IDENTITY, bundlePath], { quiet: true });
  run('codesign', ['--verify', '--strict', bundlePath], { quiet: true });
}

export function notarizeAndStaple(bundlePaths) {
  requireEnv(['APPLE_ID', 'APPLE_APP_SPECIFIC_PWD', 'APPLE_NOTARY_TEAM_ID'], 'notarization');

  const tempDir = mkdtempSync(join(tmpdir(), 'eacp-publish-notary-'));
  try {
    const payloadDir = join(tempDir, 'payload');
    const archive = join(tempDir, 'payload.zip');
    run('mkdir', ['-p', payloadDir], { quiet: true });
    for (const bundle of bundlePaths) {
      run('ditto', [bundle, join(payloadDir, basename(bundle))], { quiet: true });
    }
    run('ditto', ['-c', '-k', '--keepParent', payloadDir, archive], { quiet: true });

    info('waiting on Apple notary service (usually 1-5 minutes)...');
    run('xcrun', ['notarytool', 'submit', archive,
      '--apple-id', process.env.APPLE_ID,
      '--password', process.env.APPLE_APP_SPECIFIC_PWD,
      '--team-id', process.env.APPLE_NOTARY_TEAM_ID,
      '--wait'], { quiet: true });

    for (const bundle of bundlePaths) {
      run('xcrun', ['stapler', 'staple', bundle], { quiet: true });
      run('spctl', ['--assess', '--type', 'execute', bundle], { quiet: true });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function hasSigningIdentity() {
  const result = capture('security',
    ['find-identity', '-v', '-p', 'codesigning', keychainPath], { check: false });
  return result.stdout?.includes(`"${process.env.APPLE_SIGNING_IDENTITY}"`);
}

function ensureKeychainSearchList() {
  const listed = capture('security', ['list-keychains', '-d', 'user']);
  const current = listed.stdout.split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  if (!current.includes(keychainPath)) {
    run('security', ['list-keychains', '-d', 'user', '-s', ...current, keychainPath],
      { quiet: true });
  }
}

function requireEnv(names, help) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) fail(`${help}: missing ${missing.join(', ')}`);
}
