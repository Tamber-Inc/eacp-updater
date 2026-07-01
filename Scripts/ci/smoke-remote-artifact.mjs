#!/usr/bin/env node

import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  cleanDir,
  log,
  readText,
  requireMacOS,
  run,
} from '../lib/cli.mjs';
import {
  configuredRelease,
  configuredVersion,
  loadPublishConfig,
  templateName,
} from '../lib/apphub-publish-config.mjs';

const { options } = parseArgs(process.argv.slice(2));
const mode = options.mode;
if (mode !== 'demo' && mode !== 'hub') {
  throw new Error('Usage: smoke-remote-artifact.mjs --mode demo|hub --config <path>');
}

requireMacOS('Remote artifact smoke verification');

const config = loadPublishConfig(options.config);
const release = configuredRelease(config);
const version = configuredVersion(options.version);
const workDir = mkdtempSync(join(tmpdir(), 'eacp-smoke-remote-'));

if (mode === 'hub') {
  smokeHub();
} else {
  smokeDemoApp();
}

function smokeDemoApp() {
  const app = requiredObject(config, 'demoApp');
  const manifestName = requiredString(app, 'manifestName', 'demoApp.manifestName');
  const manifest = downloadManifest(`${release.baseUrl}/${manifestName}`, manifestName);
  if (manifest.version !== version) {
    throw new Error(`Unexpected ${manifestName} version ${manifest.version}; expected ${version}`);
  }

  const zipPath = join(workDir, templateName(requiredString(app, 'zipNameTemplate', 'demoApp.zipNameTemplate'), {
    name: requiredString(app, 'name', 'demoApp.name'),
    productId: requiredString(app, 'productId', 'demoApp.productId'),
    version,
  }));
  downloadArtifact(manifest, zipPath);

  const unpackDir = join(workDir, 'unpacked-demo');
  cleanDir(unpackDir);
  run('ditto', ['-x', '-k', zipPath, unpackDir]);

  const appBundle = join(unpackDir, requiredString(app, 'bundleName', 'demoApp.bundleName'));
  verifyAppBundle(appBundle);

  const executable = join(appBundle, 'Contents', 'MacOS', requiredString(app, 'binaryName', 'demoApp.binaryName'));
  const appVersion = runVersion(executable);
  if (appVersion !== version) {
    throw new Error(`Unexpected app version ${appVersion}; expected ${version}`);
  }
  log(`Verified remote signed ${app.name} ${appVersion}`);
}

function smokeHub() {
  const hub = requiredObject(config, 'hub');
  const manifestName = requiredString(hub, 'manifestName', 'hub.manifestName');
  const manifest = downloadManifest(`${release.baseUrl}/${manifestName}`, manifestName);

  const zipPath = join(workDir, templateName(requiredString(hub, 'zipNameTemplate', 'hub.zipNameTemplate'), {
    name: requiredString(hub, 'name', 'hub.name'),
    productId: requiredString(hub, 'productId', 'hub.productId'),
    version,
  }));
  downloadArtifact(manifest, zipPath);

  const unpackDir = join(workDir, 'unpacked-hub');
  cleanDir(unpackDir);
  run('ditto', ['-x', '-k', zipPath, unpackDir]);

  const appBundle = join(unpackDir, requiredString(hub, 'bundleName', 'hub.bundleName'));
  verifyAppBundle(appBundle);
  if (hub.helperRelativePath) {
    verifyCodeSignature(join(appBundle, ...pathParts(hub.helperRelativePath, 'hub.helperRelativePath')));
  }

  const executable = join(appBundle, 'Contents', 'MacOS', requiredString(hub, 'binaryName', 'hub.binaryName'));
  runWithTimeout(60, 'sudo', [executable, 'bless-helper']);
  if (hub.privilegedHelperPath) {
    verifyCodeSignature(hub.privilegedHelperPath);
  }

  run(executable, [
    '--root',
    join(workDir, 'hub-state'),
    'remote-install',
    '--manifest-url',
    `${release.baseUrl}/${manifestName}`,
  ]);

  const installedExecutable = requiredString(hub, 'installedExecutable', 'hub.installedExecutable');
  const installedVersion = runVersion(installedExecutable);
  if (installedVersion !== version) {
    throw new Error(`Unexpected installed hub version ${installedVersion}; expected ${version}`);
  }

  const installedBundle = requiredString(hub, 'installedBundle', 'hub.installedBundle');
  verifyAppBundle(installedBundle);
  log(`Installed remote signed ${hub.name} ${installedVersion}`);
}

function downloadManifest(url, fileName) {
  const path = join(workDir, fileName);
  run('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    url,
    '--output',
    path,
  ]);
  return JSON.parse(readText(path));
}

function downloadArtifact(manifest, destination) {
  if (!manifest.artifact?.url) {
    throw new Error('Manifest is missing artifact.url');
  }
  run('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    manifest.artifact.url,
    '--output',
    destination,
  ]);
}

function verifyAppBundle(path) {
  verifyCodeSignature(path);
  run('xcrun', ['stapler', 'validate', path]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', path]);
}

function verifyCodeSignature(path) {
  run('codesign', ['--verify', '--strict', '--verbose=2', path]);
}

function runVersion(executable) {
  const result = run(executable, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return String(result.stdout ?? '').trim();
}

function runWithTimeout(seconds, command, args) {
  run('/usr/bin/perl', [
    '-e',
    'alarm shift; exec @ARGV',
    String(seconds),
    command,
    ...args,
  ]);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--config') {
      options.config = args[++i];
    } else if (args[i] === '--mode') {
      options.mode = args[++i];
    } else if (args[i] === '--version') {
      options.version = args[++i];
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
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
