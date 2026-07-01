import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { capture, fileExists, repoRoot, requireEnv, requireMacOS, run } from './cli.mjs';

export const remoteDemoKeychainPath = join(
  homedir(),
  'Library',
  'Keychains',
  'tamber-eacp-remote-demo.keychain-db',
);

export const jobBlessKeychainPath = join(
  homedir(),
  'Library',
  'Keychains',
  'tamber-eacp-jobbless-demo.keychain-db',
);

const keychainPassword = 'tamber-eacp-remote-demo-local';

export function ensureTamberSigningIdentity(keychainPath = remoteDemoKeychainPath) {
  requireMacOS('Tamber Developer ID signing');
  requireEnv(
    ['APPLE_SIGNING_IDENTITY'],
    'Tamber Developer ID signing',
  );

  if (!fileExists(keychainPath)) {
    run('security', ['create-keychain', '-p', keychainPassword, keychainPath]);
  }

  run('security', ['unlock-keychain', '-p', keychainPassword, keychainPath]);
  run('security', ['set-keychain-settings', '-lut', '21600', keychainPath]);
  ensureKeychainSearchList(keychainPath);

  if (!hasSigningIdentity(keychainPath)) {
    requireEnv(
      ['APPLE_DEVELOPER_CERTIFICATE_BASE64', 'APPLE_DEVELOPER_CERTIFICATE_PASSWORD'],
      'Tamber Developer ID certificate import',
    );

    const tempDir = mkdtempSync(join(tmpdir(), 'eacp-codesign-'));
    const p12 = join(tempDir, 'cert.p12');
    try {
      writeFileSync(
        p12,
        Buffer.from(process.env.APPLE_DEVELOPER_CERTIFICATE_BASE64, 'base64'),
        { mode: 0o600 },
      );
      run('security', [
        'import',
        p12,
        '-k',
        keychainPath,
        '-P',
        process.env.APPLE_DEVELOPER_CERTIFICATE_PASSWORD,
        '-T',
        '/usr/bin/codesign',
        '-T',
        '/usr/bin/security',
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  importCertificateIfNeeded({
    identity: process.env.APPLE_INSTALLER_SIGNING_IDENTITY,
    certificateBase64: process.env.APPLE_INSTALLER_CERTIFICATE_BASE64,
    certificatePassword: process.env.APPLE_INSTALLER_CERTIFICATE_PASSWORD,
    keychainPath,
    label: 'Apple installer certificate import',
  });

  run('security', [
    'set-key-partition-list',
    '-S',
    'apple-tool:,apple:,codesign:',
    '-s',
    '-k',
    keychainPassword,
    keychainPath,
  ]);

  if (!hasSigningIdentity(keychainPath)) {
    throw new Error(`Signing identity not found after import: ${process.env.APPLE_SIGNING_IDENTITY}`);
  }
}

export function signPath(path, keychainPath = remoteDemoKeychainPath) {
  const timestampArgs = process.env.APPLE_CODESIGN_TIMESTAMP === '1'
    ? ['--timestamp']
    : [];

  run('codesign', [
    '--force',
    ...timestampArgs,
    '--options',
    'runtime',
    '--keychain',
    keychainPath,
    '--sign',
    process.env.APPLE_SIGNING_IDENTITY,
    path,
  ]);
  verifyCodeSignature(path);
}

export function verifyCodeSignature(path) {
  run('codesign', ['--verify', '--strict', '--verbose=2', path]);
}

export function notarizeAndStapleApps(appBundles) {
  requireMacOS('Apple notarization');
  if (appBundles.length === 0) {
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'eacp-notary-'));
  const payloadDir = join(tempDir, 'payload');
  const archive = join(tempDir, 'notary-payload.zip');
  const notaryKey = writeNotaryKeyIfNeeded(tempDir);

  try {
    run('mkdir', ['-p', payloadDir]);
    for (const appBundle of appBundles) {
      verifyCodeSignature(appBundle);
      run('ditto', [appBundle, join(payloadDir, basename(appBundle))]);
    }

    run('ditto', ['-c', '-k', '--keepParent', payloadDir, archive]);
    run('xcrun', ['notarytool', 'submit', archive, ...notaryAuthArgs(notaryKey), '--wait']);

    for (const appBundle of appBundles) {
      run('xcrun', ['stapler', 'staple', appBundle]);
      validateStapledApp(appBundle);
      verifyGatekeeperApp(appBundle);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function buildSignedComponentPkg({
  component,
  installLocation = '/Applications',
  output,
  keychainPath = remoteDemoKeychainPath,
}) {
  requireMacOS('Apple package signing');
  requireEnv(['APPLE_INSTALLER_SIGNING_IDENTITY'], 'Apple package signing');
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'eacp-component-pkg-'));
  const rootDir = join(tempDir, 'root');
  const componentName = basename(component);
  const stagedComponent = join(rootDir, componentName);
  const componentPlist = join(tempDir, 'components.plist');
  const unsignedComponentPkg = join(tempDir, 'component.pkg');
  const bundleId = readBundlePlistValue(component, 'CFBundleIdentifier');
  const bundleVersion =
    readBundlePlistValue(component, 'CFBundleShortVersionString')
    || readBundlePlistValue(component, 'CFBundleVersion')
    || '1.0.0';

  try {
    mkdirSync(rootDir, { recursive: true });
    cpSync(component, stagedComponent, {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    writeFileSync(
      componentPlist,
      appBundleComponentPlist(componentName),
    );

    run('pkgbuild', [
      '--identifier',
      bundleId,
      '--version',
      bundleVersion,
      '--root',
      rootDir,
      '--install-location',
      installLocation,
      '--component-plist',
      componentPlist,
      unsignedComponentPkg,
    ]);

    run('productbuild', [
      '--package',
      unsignedComponentPkg,
      '--sign',
      process.env.APPLE_INSTALLER_SIGNING_IDENTITY,
      '--keychain',
      keychainPath,
      output,
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  verifyPkgSignature(output);
}

function readBundlePlistValue(bundle, key) {
  const result = capture('/usr/libexec/PlistBuddy', [
    '-c',
    `Print ${key}`,
    join(bundle, 'Contents', 'Info.plist'),
  ], { check: false });
  return result.status === 0 ? result.stdout.trim() : '';
}

function appBundleComponentPlist(rootRelativeBundlePath) {
  return readFileSync(
    join(repoRoot, 'Scripts', 'resources', 'app-bundle-component.plist.in'),
    'utf8',
  ).replaceAll(
    '@ROOT_RELATIVE_BUNDLE_PATH@',
    escapePlistString(rootRelativeBundlePath),
  );
}

function escapePlistString(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function notarizeAndStaplePkgs(pkgs) {
  requireMacOS('Apple package notarization');
  if (pkgs.length === 0) {
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'eacp-pkg-notary-'));
  const notaryKey = writeNotaryKeyIfNeeded(tempDir);

  try {
    for (const pkg of pkgs) {
      verifyPkgSignature(pkg);
      run('xcrun', ['notarytool', 'submit', pkg, ...notaryAuthArgs(notaryKey), '--wait']);
      run('xcrun', ['stapler', 'staple', pkg]);
      validateStapledApp(pkg);
      verifyGatekeeperPkg(pkg);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function validateStapledApp(path) {
  run('xcrun', ['stapler', 'validate', path]);
}

export function verifyGatekeeperApp(path) {
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', path]);
}

export function verifyGatekeeperPkg(path) {
  run('spctl', ['--assess', '--type', 'install', '--verbose=4', path]);
}

export function verifyPkgSignature(path) {
  run('pkgutil', ['--check-signature', path]);
}

export function verifyMachODeploymentTargetAtMost(path, maximumVersion) {
  const result = capture('otool', ['-l', path]);
  const match = result.stdout.match(/^\s*minos\s+([0-9]+(?:\.[0-9]+)*)$/m);
  if (!match) {
    throw new Error(`Could not read Mach-O deployment target for ${path}`);
  }

  if (compareVersions(match[1], maximumVersion) > 0) {
    throw new Error(
      `${basename(path)} targets macOS ${match[1]}, expected ${maximumVersion} or older`,
    );
  }
}

export function adHocSignPath(path) {
  run('codesign', ['--force', '--deep', '--sign', '-', path]);
}

function hasSigningIdentity(keychainPath) {
  const result = capture('security', ['find-identity', '-v', '-p', 'codesigning', keychainPath], {
    check: false,
  });
  return result.stdout.includes(`"${process.env.APPLE_SIGNING_IDENTITY}"`);
}

function importCertificateIfNeeded({
  identity,
  certificateBase64,
  certificatePassword,
  keychainPath,
  label,
}) {
  if (!identity || hasSpecificSigningIdentity(keychainPath, identity)) {
    return;
  }
  if (!certificateBase64 || !certificatePassword) {
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'eacp-codesign-extra-'));
  const p12 = join(tempDir, 'cert.p12');
  try {
    writeFileSync(p12, Buffer.from(certificateBase64, 'base64'), { mode: 0o600 });
    run('security', [
      'import',
      p12,
      '-k',
      keychainPath,
      '-P',
      certificatePassword,
      '-T',
      '/usr/bin/productbuild',
      '-T',
      '/usr/bin/pkgbuild',
      '-T',
      '/usr/bin/security',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (!hasSpecificSigningIdentity(keychainPath, identity)) {
    throw new Error(`${label}: signing identity not found after import: ${identity}`);
  }
}

function hasSpecificSigningIdentity(keychainPath, identity) {
  const result = capture('security', ['find-identity', '-v', keychainPath], {
    check: false,
  });
  if (result.stdout.includes(`"${identity}"`)) {
    return true;
  }

  const certResult = capture('security', ['find-certificate', '-c', identity, keychainPath], {
    check: false,
  });
  return certResult.status === 0;
}

function writeNotaryKeyIfNeeded(tempDir) {
  if (process.env.APPLE_NOTARY_KEYCHAIN_PROFILE) {
    return undefined;
  }

  if (!usesApiKeyNotarization()) {
    return undefined;
  }

  requireEnv(['APPLE_NOTARY_KEY_ID', 'APPLE_NOTARY_ISSUER_ID'], 'Apple notarization');

  const keyText = process.env.APPLE_NOTARY_KEY
    ?? (process.env.APPLE_NOTARY_KEY_BASE64
      ? Buffer.from(process.env.APPLE_NOTARY_KEY_BASE64, 'base64').toString('utf8')
      : undefined);

  if (!keyText) {
    throw new Error(
      'Apple notarization: missing APPLE_NOTARY_KEY_BASE64, APPLE_NOTARY_KEY, or APPLE_NOTARY_KEYCHAIN_PROFILE',
    );
  }

  const keyPath = join(tempDir, 'notary-key.p8');
  writeFileSync(keyPath, keyText, { mode: 0o600 });
  return keyPath;
}

function notaryAuthArgs(notaryKey) {
  if (process.env.APPLE_NOTARY_KEYCHAIN_PROFILE) {
    return ['--keychain-profile', process.env.APPLE_NOTARY_KEYCHAIN_PROFILE];
  }

  if (usesApiKeyNotarization()) {
    return [
      '--key',
      notaryKey,
      '--key-id',
      process.env.APPLE_NOTARY_KEY_ID,
      '--issuer',
      process.env.APPLE_NOTARY_ISSUER_ID,
    ];
  }

  requireEnv(
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PWD'],
    'Apple notarization',
  );

  return [
    '--apple-id',
    process.env.APPLE_ID,
    '--password',
    process.env.APPLE_APP_SPECIFIC_PWD,
    '--team-id',
    process.env.APPLE_NOTARY_TEAM_ID
      ?? process.env.APPLE_TEAM_ID
      ?? process.env.APPLE_DEVELOPER_TEAM_ID
      ?? 'MBHR5VAUVQ',
  ];
}

function usesApiKeyNotarization() {
  return Boolean(
    process.env.APPLE_NOTARY_KEY_ID
      || process.env.APPLE_NOTARY_ISSUER_ID
      || process.env.APPLE_NOTARY_KEY
      || process.env.APPLE_NOTARY_KEY_BASE64,
  );
}

function compareVersions(left, right) {
  const l = left.split('.').map((part) => Number.parseInt(part, 10));
  const r = right.split('.').map((part) => Number.parseInt(part, 10));
  const count = Math.max(l.length, r.length);
  for (let index = 0; index < count; index += 1) {
    const lv = l[index] ?? 0;
    const rv = r[index] ?? 0;
    if (lv < rv) return -1;
    if (lv > rv) return 1;
  }
  return 0;
}

function ensureKeychainSearchList(keychainPath) {
  const listed = capture('security', ['list-keychains', '-d', 'user']);
  const current = listed.stdout
    .split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);

  if (current.includes(keychainPath)) {
    return;
  }

  run('security', ['list-keychains', '-d', 'user', '-s', ...current, keychainPath]);
}
