#!/usr/bin/env node

import { join } from 'node:path';

import {
  eacpSourceDir,
  capture,
  cleanDir,
  env,
  log,
  readText,
  repoRoot,
  requireMacOS,
  run,
  sha256File,
  writeJson,
} from './lib/cli.mjs';
import {
  ensureTamberSigningIdentity,
  signPath,
  verifyMachODeploymentTargetAtMost,
} from './lib/macos-signing.mjs';
import {
  catalogProducts,
  makeProduct,
  replaceCatalogProduct,
} from './lib/apphub-catalog.mjs';

const version = env('VERSION', '2.0.0');
const releaseTag = env('RELEASE_TAG', 'remote-demo-v1');
const releaseBaseUrl = env(
  'RELEASE_BASE_URL',
  `https://github.com/Tamber-Inc/eacp-updater/releases/download/${releaseTag}`,
);
const appName = env('APPHUB_CATALOG_APP', 'maze').toLowerCase();
const outDir = env('OUT_DIR', join(repoRoot, `dist/remote-catalog-${appName}-${version}`));
const buildDir = env('BUILD_DIR', join(repoRoot, `build-remote-catalog-${appName}-${version}`));
const macOSDeploymentTarget = env('EACP_MACOS_DEPLOYMENT_TARGET', '11.0');
const releaseRepo = env('GITHUB_REPOSITORY', 'Tamber-Inc/eacp-updater');

const product = catalogProducts[appName];
if (!product || product.kind !== 'App') {
  throw new Error(`APPHUB_CATALOG_APP must be one of: maze, teapot`);
}

const appZip = `${product.target}-${version}.app.zip`;

requireMacOS(`Remote ${product.name} update publishing`);

log('Import Tamber Developer ID signing identity');
ensureTamberSigningIdentity();

log(`Configure ${product.name} ${version}`);
run('cmake', [
  '-S',
  repoRoot,
  '-B',
  buildDir,
  `-DEACP_SOURCE_DIR=${eacpSourceDir()}`,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_DEPLOYMENT_TARGET=${macOSDeploymentTarget}`,
]);

log(`Build ${product.name} ${version}`);
run('cmake', ['--build', buildDir, '--target', product.target]);

const appBundle = join(buildDir, ...product.appPath);

log(`Sign ${product.name} ${version}`);
signPath(appBundle);
verifyMachODeploymentTargetAtMost(
  join(appBundle, 'Contents', 'MacOS', product.binaryName),
  macOSDeploymentTarget,
);

log(`Package ${product.name} ${version}`);
cleanDir(outDir);
run('ditto', ['-c', '-k', '--keepParent', appBundle, join(outDir, appZip)]);

const appSha = sha256File(join(outDir, appZip));
const productEntry = makeProduct({
  ...product,
  version,
  url: `${releaseBaseUrl}/${appZip}`,
  sha256: appSha,
  dependencies: [catalogProducts.runtime.id, catalogProducts.model.id],
});

log('Download current AppHub catalog');
const catalogPath = join(outDir, 'apphub-catalog.json');
const catalogResult = capture('gh', [
  'release',
  'download',
  releaseTag,
  '--repo',
  releaseRepo,
  '--pattern',
  'apphub-catalog.json',
  '--dir',
  outDir,
], { check: false });
if (catalogResult.status !== 0) {
  throw new Error('Cannot publish an independent app update before apphub-catalog.json exists');
}

const catalog = JSON.parse(readText(catalogPath));
const nextCatalog = replaceCatalogProduct(catalog, productEntry);
nextCatalog.catalogVersion = Math.max(
  Number(nextCatalog.catalogVersion) || 0,
  Number.parseInt(version.split('.')[0], 10) || 1,
);
writeJson(catalogPath, nextCatalog);

log(`Upload ${product.name} ${version} and updated catalog`);
run('gh', [
  'release',
  'upload',
  releaseTag,
  join(outDir, appZip),
  catalogPath,
  '--repo',
  releaseRepo,
  '--clobber',
]);

log(`Published ${product.name} ${version}`);
console.log(JSON.stringify(productEntry, null, 2));
