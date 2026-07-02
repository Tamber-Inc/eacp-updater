import { join } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';

import { loadConfig, publishUnits, readTargetMetadata, findUpdaterTool } from '../config.mjs';
import { createBackend } from '../hosting.mjs';
import { cleanDir, run, sha256File, writeJson, writeText, capture } from '../exec.mjs';
import { ensureSigningIdentity, notarizeAndStaple, signBundle } from '../sign-macos.mjs';
import { banner, fail, info, ok, step, table, warn, dim } from '../ui.mjs';

export async function release(args) {
  const started = Date.now();
  const version = args.positionals[0];
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
    fail('usage: eacp-publish release <version> [--channel <name>] [--no-notarize] [--dry-run]');
  }

  const config = loadConfig();
  const channel = args.options.channel ?? config.channels.default;
  const notarize = !args.options['no-notarize']
    && process.env.SKIP_NOTARIZE !== '1'
    && (config.signing.macos?.notarize ?? true);
  const dryRun = Boolean(args.options['dry-run']);
  const units = publishUnits(config);

  banner(`Releasing ${version} to '${channel}' (${units.length} apps)${dryRun ? ' — dry run' : ''}`);

  step('Configure + build');
  const buildDir = args.options['build-dir'] ?? join(config.root, `build-publish-${version}`);
  const cmakeArgs = [
    '-S', config.root, '-B', buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DEACP_PUBLISH_VERSION=${version}`,
    ...(config.build.macOSDeploymentTarget
      ? [`-DCMAKE_OSX_DEPLOYMENT_TARGET=${config.build.macOSDeploymentTarget}`] : []),
    ...(config.build.cmakeArgs ?? []),
    ...(args.options['cmake-arg'] ? [].concat(args.options['cmake-arg']) : []),
  ];
  run('cmake', cmakeArgs, { quiet: true });
  run('cmake', ['--build', buildDir, '--target',
    ...units.map((unit) => unit.target), 'eacp-updater-tool', '-j'], { quiet: true });
  ok(`built ${units.map((unit) => unit.target).join(', ')} + eacp-updater-tool`);

  // Facts come from the build, not from config: eacp_updater_add_app() emitted
  // them per target.
  const apps = units.map((unit) => {
    const metadata = readTargetMetadata(buildDir, unit.target);
    if (metadata.version !== version) {
      fail(`target ${unit.target} built as ${metadata.version}, expected ${version}`);
    }
    const reported = capture(metadata.executable, ['--version']).stdout.trim();
    if (reported !== version) {
      fail(`${metadata.name} reports --version '${reported}', expected '${version}'`);
    }
    return { ...unit, ...metadata };
  });
  ok(`all ${apps.length} apps report --version ${version}`);

  step('Sign');
  ensureSigningIdentity();
  for (const app of apps) {
    signBundle(app.bundleDir);
    ok(`${app.name} signed`);
  }

  if (notarize) {
    step('Notarize + staple');
    notarizeAndStaple(apps.map((app) => app.bundleDir));
    ok('accepted by Apple notary service');
  } else {
    warn('skipping notarization');
  }

  step('Package');
  const outDir = join(config.root, 'dist', `${version}-${channel.replaceAll('/', '-')}`);
  cleanDir(outDir);
  const tree = join(outDir, 'tree');
  for (const app of apps) {
    app.zipName = `${app.name.replaceAll(/\s+/g, '')}-${version}.app.zip`;
    app.object = `channels/${channel}/artifacts/${app.zipName}`;
    const zipPath = join(tree, app.object);
    mkdirSync(join(tree, `channels/${channel}/artifacts`), { recursive: true });
    run('ditto', ['-c', '-k', '--keepParent', app.bundleDir, zipPath], { quiet: true });
    app.sha256 = sha256File(zipPath);
    app.url = `${config.hosting.publicRoot}/${app.object}`;
    ok(`${app.zipName}  ${dim(app.sha256.slice(0, 12))}`);
  }

  step('Emit + validate channel metadata (eacp-updater-tool)');
  const backend = await createBackend(config);
  const existingIndex = await backend.fetchText('index.json');
  const existingIndexPath = join(outDir, 'existing-index.json');
  if (existingIndex) writeText(existingIndexPath, existingIndex);

  const spec = {
    channel,
    channelName: args.options['channel-name'] ?? channel,
    defaultChannel: config.channels.default,
    publicRoot: config.hosting.publicRoot,
    existingIndexPath: existingIndex ? existingIndexPath : '',
    products: apps.map((app) => ({
      id: app.productId,
      name: app.name,
      bundleName: app.bundleName,
      version,
      kind: 'app',
      role: app.role,
      dependencies: [],
      artifacts: [{
        platform: 'macos',
        architecture: 'universal',
        url: app.url,
        sha256: app.sha256,
        signature: '',
      }],
    })),
  };
  const specPath = join(outDir, 'spec.json');
  writeJson(specPath, spec);
  run(findUpdaterTool(buildDir), ['emit', '--spec', specPath, '--out', tree], { quiet: true });
  ok('metadata round-trips through the library parsers');

  if (dryRun) {
    banner(`Dry run complete — inspect ${tree}`);
    return;
  }

  step(`Upload to ${backend.name}`);
  const objects = collectObjects(tree);
  for (const object of objects) {
    backend.upload(join(tree, object), object, { json: object.endsWith('.json') });
    info(object);
  }
  ok(`${objects.length} objects uploaded`);

  const seconds = Math.round((Date.now() - started) / 1000);
  banner(`Released ${version} to '${channel}' in ${seconds}s 🚀`);
  table(apps.map((app) => [app.productId, app.role, version, app.url]));
  console.log(`\n  index    ${config.hosting.publicRoot}/index.json`);
  console.log(`  catalog  ${config.hosting.publicRoot}/channels/${channel}/catalog.json`);
}

function collectObjects(dir, prefix = '') {
  const objects = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const object = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) objects.push(...collectObjects(join(dir, entry.name), object));
    else objects.push(object);
  }
  return objects;
}
